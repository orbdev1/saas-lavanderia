import { db, sql, one, pool } from './db.js';
const email = process.argv[2]?.toLowerCase();
if (!email) throw new Error('Uso: pnpm admin correo@ejemplo.com (cuenta existente)');
const user = await one(db, sql`UPDATE users SET platform_admin=true WHERE email=${email} RETURNING id,email`);
if (!user) throw new Error('Primero registra la cuenta');
console.log('Administrador de plataforma habilitado:', user);
await pool.end();
