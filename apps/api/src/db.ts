import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, type SQL } from 'drizzle-orm';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
export const db = drizzle(pool);
export type Executor = Pick<typeof db, 'execute'>;
export async function rows<T = Record<string, unknown>>(executor: Executor, query: SQL): Promise<T[]> {
  return (await executor.execute(query)).rows as T[];
}
export async function one<T = Record<string, unknown>>(executor: Executor, query: SQL): Promise<T | undefined> { return (await rows<T>(executor, query))[0]; }
export { sql };
