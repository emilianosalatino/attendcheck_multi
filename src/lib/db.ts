import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'

/**
 * Cliente Prisma singleton.
 *
 * Funciona con:
 *   - SQLite local:      DATABASE_URL="file:/ruta/a/local.db"
 *   - Turso en produccion: DATABASE_URL="libsql://..." (mas DATABASE_AUTH_TOKEN)
 *
 * El adapter PrismaLibSql recibe la CONFIG (url + authToken), no un client ya creado.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('Falta DATABASE_URL en variables de entorno')
  }
  const adapter = new PrismaLibSql({
    url,
    authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
  })
  return new PrismaClient({ adapter })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
