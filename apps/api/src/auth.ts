import type { FastifyInstance, FastifyReply } from 'fastify';
import argon2 from 'argon2';
import { z } from 'zod';
import { credentials, registration, invitationInput, id } from '@lav/shared';
import { db, sql, one, rows } from './db.js';
import { authenticate, tenant, token, hash, assert, audit, sendLink } from './security.js';

const cookie = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 60 * 60 * 24 * 7 };
async function session(userId: string, reply: FastifyReply) {
  const value = token();
  await db.execute(sql`INSERT INTO sessions(token,user_id,expires_at) VALUES (${hash(value)},${userId},now()+interval '7 days')`);
  reply.setCookie('session', value, cookie);
}
export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/register', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = registration.parse(request.body);
    const password = await argon2.hash(input.password, { type: argon2.argon2id });
    const user = await db.transaction(async tx => {
      const user = (await one<{ id: string }>(tx, sql`INSERT INTO users(name,email,password) VALUES (${input.name},${input.email},${password}) RETURNING id`))!;
      const company = (await one<{ id: string }>(tx, sql`INSERT INTO companies(name) VALUES (${input.company}) RETURNING id`))!;
      await tx.execute(sql`INSERT INTO memberships(company_id,user_id,role) VALUES (${company.id},${user.id},'owner')`);
      await tx.execute(sql`INSERT INTO branches(company_id,name) VALUES (${company.id},'Principal')`);
      await tx.execute(sql`INSERT INTO services(company_id,name,unit,price,minimum) VALUES (${company.id},'Lavado de ropa','kg',600,3),(${company.id},'Edredón','piece',2500,1),(${company.id},'Lavado en seco','piece',1500,1)`);
      await audit(tx, user.id, company.id, 'company.registered', company.id);
      return user;
    });
    await session(user.id, reply);
    return reply.code(201).send({ ok: true });
  });
  app.post('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const input = credentials.parse(request.body);
    const user = await one<{ id: string; password: string }>(db, sql`SELECT id,password FROM users WHERE email=${input.email}`);
    // Hash on an unknown account too, avoiding a fast account-existence timing path.
    const valid = user ? await argon2.verify(user.password, input.password) : (await argon2.hash(input.password), false);
    assert(user && valid, 401, 'Correo o contraseña incorrectos');
    await session(user.id, reply); return { ok: true };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    if (request.cookies.session) await db.execute(sql`DELETE FROM sessions WHERE token=${hash(request.cookies.session)}`);
    reply.clearCookie('session', { path: '/' }); return { ok: true };
  });
  app.get('/api/auth/me', async request => {
    const user = await authenticate(request);
    const memberships = await rows(db, sql`SELECT m.company_id AS "companyId",c.name AS "companyName",m.role FROM memberships m JOIN companies c ON c.id=m.company_id WHERE m.user_id=${user.id} ORDER BY c.name`);
    return { ...user, memberships };
  });
  app.post('/api/auth/forgot', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async request => {
    const { email } = z.object({ email: z.email().toLowerCase() }).parse(request.body);
    const user = await one(db, sql`SELECT id FROM users WHERE email=${email}`);
    if (user) {
      const value = token();
      await db.execute(sql`INSERT INTO tokens(token,kind,email,expires_at) VALUES (${hash(value)},'reset',${email},now()+interval '30 minutes')`);
      await sendLink(email, 'Restablecer contraseña', `/?reset=${value}`);
    }
    return { ok: true };
  });
  app.post('/api/auth/reset', async request => {
    const input = z.object({ token: z.string().length(64), password: credentials.shape.password }).parse(request.body);
    const password = await argon2.hash(input.password);
    await db.transaction(async tx => {
      const entry = await one<{ email: string }>(tx, sql`DELETE FROM tokens WHERE token=${hash(input.token)} AND kind='reset' AND expires_at>now() RETURNING email`);
      assert(entry, 400, 'Enlace inválido o vencido');
      const user = (await one<{ id: string }>(tx, sql`UPDATE users SET password=${password} WHERE email=${entry.email} RETURNING id`))!;
      await tx.execute(sql`DELETE FROM sessions WHERE user_id=${user.id}`);
      await tx.execute(sql`DELETE FROM tokens WHERE email=${entry.email} AND kind='reset'`);
      await audit(tx, user.id, null, 'password.reset', user.id);
    }); return { ok: true };
  });
  app.get('/api/team', async request => {
    const ctx = await tenant(request, ['owner', 'manager']);
    return rows(db, sql`SELECT u.id,u.name,u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.company_id=${ctx.companyId} ORDER BY u.name`);
  });
  app.post('/api/team/invite', async request => {
    const ctx = await tenant(request, ['owner']); const input = invitationInput.parse(request.body); const value = token();
    await db.transaction(async tx => {
      await tx.execute(sql`INSERT INTO tokens(token,kind,email,company_id,role,expires_at) VALUES (${hash(value)},'invite',${input.email},${ctx.companyId},${input.role},now()+interval '2 days')`);
      await audit(tx, ctx.actor.id, ctx.companyId, 'team.invited', null, input);
    });
    await sendLink(input.email, 'Invitación a tu lavandería', `/?invite=${value}`); return { ok: true };
  });
  app.post('/api/auth/accept', async (request, reply) => {
    const input = credentials.extend({ token: z.string().length(64), name: z.string().trim().min(2).max(120) }).parse(request.body);
    const userId = await db.transaction(async tx => {
      const entry = await one<{ email: string; companyId: string; role: string }>(tx, sql`SELECT email,company_id AS "companyId",role FROM tokens WHERE token=${hash(input.token)} AND kind='invite' AND expires_at>now() FOR UPDATE`);
      assert(entry && entry.email === input.email, 400, 'Invitación inválida o vencida');
      let user = await one<{ id: string; password: string }>(tx, sql`SELECT id,password FROM users WHERE email=${entry.email}`);
      if (user) assert(await argon2.verify(user.password, input.password), 401, 'Usa la contraseña de tu cuenta existente');
      else user = (await one<{ id: string; password: string }>(tx, sql`INSERT INTO users(name,email,password) VALUES (${input.name},${input.email},${await argon2.hash(input.password)}) RETURNING id,password`))!;
      await tx.execute(sql`INSERT INTO memberships(company_id,user_id,role) VALUES (${entry.companyId},${user.id},${entry.role}) ON CONFLICT DO NOTHING`);
      await tx.execute(sql`DELETE FROM tokens WHERE token=${hash(input.token)}`);
      await audit(tx, user.id, entry.companyId, 'team.accepted', user.id);
      return user.id;
    }); await session(userId, reply); return { ok: true };
  });
  app.delete('/api/team/:id', async request => {
    const ctx = await tenant(request, ['owner']); const userId = id.parse((request.params as { id: string }).id);
    await db.transaction(async tx => {
      const removed = await one(tx, sql`DELETE FROM memberships WHERE company_id=${ctx.companyId} AND user_id=${userId} AND role<>'owner' RETURNING user_id`);
      assert(removed, 404, 'Miembro no encontrado o es propietario');
      await audit(tx, ctx.actor.id, ctx.companyId, 'team.removed', userId);
    }); return { ok: true };
  });
}
