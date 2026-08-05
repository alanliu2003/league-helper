import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from './config.js';

let prismaClient: PrismaClient | undefined;

/**
 * Lazily create a PrismaClient owned by the worker process.
 * Requires DATABASE_URL. Generate the client from the API schema:
 *   pnpm --filter @league-helper/worker prisma:generate
 * or root `pnpm db:generate`.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    // Ensure DATABASE_URL is present before Prisma connects.
    getDatabaseUrl();
    prismaClient = new PrismaClient();
  }
  return prismaClient;
}

export async function disconnectPrisma(): Promise<void> {
  if (!prismaClient) {
    return;
  }
  await prismaClient.$disconnect();
  prismaClient = undefined;
}
