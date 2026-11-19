import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';

/** One place that knows how to build a client: used by PrismaService, the seed and DB tests. */
export function createPrismaClient(connectionString: string) {
  // Serverless instances multiply: keep each one's pool tiny so the database pooler isn't exhausted.
  const max = Number(process.env.DB_POOL_MAX) || (process.env.VERCEL ? 3 : 10);
  return new PrismaClient({ adapter: new PrismaPg({ connectionString, max }) });
}

export type Db = ReturnType<typeof createPrismaClient>;
