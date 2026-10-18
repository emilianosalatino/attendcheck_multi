/**
 * Inicializa el schema de la base de datos en Turso (o SQLite local).
 *
 * Por que NO usamos `prisma db push` en produccion:
 *   - Prisma CLI con provider="sqlite" rechaza URLs tipo "libsql://..."
 *   - Por eso este script aplica el schema via @libsql/client, que SI acepta
 *     tanto URLs "file:" como "libsql://".
 *
 * Uso:
 *   DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." node scripts/init-db.js
 *   o
 *   DATABASE_URL="file:./db/custom.db" node scripts/init-db.js
 */
import { createClient } from '@libsql/client'

const SCHEMA_SQL = `
-- Tabla de usuarios (admin root o profesores)
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'TEACHER',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "User_username_key" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");

-- Migracion: si la tabla User ya existe con columna "email" (versiones v11 y anteriores),
-- renombrarla a "username" para que coincida con el schema Prisma actual.
-- Si la columna ya se llama "username", esto falla y lo ignoramos.
-- Si la tabla es nueva (recien creada arriba), esto tambien falla y lo ignoramos.
ALTER TABLE "User" RENAME COLUMN "email" TO "username";

-- Migracion: si existia un indice unico sobre "email", recrearlo sobre "username".
-- (No se puede renombrar el indice, asi que lo dropeamos y creamos uno nuevo.)
DROP INDEX IF EXISTS "User_email_key";

-- Tabla de materias/grupos (Fase 3)
CREATE TABLE IF NOT EXISTS "Subject" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '0f766e',
    "ownerId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS "Subject_createdAt_idx" ON "Subject"("createdAt");

-- Migracion: si Subject ya existe sin ownerId, lo agrega ANTES del indice
ALTER TABLE "Subject" ADD COLUMN "ownerId" TEXT REFERENCES "User"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "Subject_ownerId_idx" ON "Subject"("ownerId");

-- Tabla de sesiones de clase
CREATE TABLE IF NOT EXISTS "ClassSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "subjectId" TEXT,
    "startsAt" DATETIME NOT NULL,
    "endsAt" DATETIME NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "expectedStudents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL
);

-- Tabla de registros de asistencia
CREATE TABLE IF NOT EXISTS "Attendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentGivenNames" TEXT NOT NULL DEFAULT '',
    "studentPaternalSurname" TEXT NOT NULL DEFAULT '',
    "studentMaternalSurname" TEXT,
    "deviceFp" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "flagged" BOOLEAN NOT NULL DEFAULT 0,
    "flagReason" TEXT,
    FOREIGN KEY ("sessionId") REFERENCES "ClassSession"("id") ON DELETE CASCADE
);

-- Migracion: si la tabla ClassSession ya existe sin las columnas nuevas, las agrega
ALTER TABLE "ClassSession" ADD COLUMN "subjectId" TEXT REFERENCES "Subject"("id") ON DELETE SET NULL;
ALTER TABLE "ClassSession" ADD COLUMN "expectedStudents" INTEGER NOT NULL DEFAULT 0;

-- Migracion: columnas de nombre (Fase 1)
ALTER TABLE "Attendance" ADD COLUMN "studentGivenNames" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Attendance" ADD COLUMN "studentPaternalSurname" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Attendance" ADD COLUMN "studentMaternalSurname" TEXT;

-- Indices para busquedas rapidas
CREATE UNIQUE INDEX IF NOT EXISTS "ClassSession_token_key" ON "ClassSession"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "Attendance_sessionId_studentId_key" ON "Attendance"("sessionId", "studentId");
CREATE INDEX IF NOT EXISTS "Attendance_sessionId_idx" ON "Attendance"("sessionId");
CREATE INDEX IF NOT EXISTS "Attendance_deviceFp_idx" ON "Attendance"("deviceFp");
CREATE INDEX IF NOT EXISTS "Attendance_studentId_idx" ON "Attendance"("studentId");
CREATE INDEX IF NOT EXISTS "ClassSession_subjectId_idx" ON "ClassSession"("subjectId");
`

async function main() {
  const url = process.env.DATABASE_URL
  const token = process.env.DATABASE_AUTH_TOKEN || undefined

  if (!url) {
    console.error('ERROR: Falta DATABASE_URL en variables de entorno')
    process.exit(1)
  }

  console.log('Conectando a:', url.replace(/\/\/.*@/, '//***@'))
  const client = createClient({ url, authToken: token })

  // Ejecutamos cada statement por separado porque libsql no soporta
  // multiples sentencias en una sola llamada a execute()
  const statements = SCHEMA_SQL.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  let count = 0
  for (const stmt of statements) {
    try {
      await client.execute(stmt)
      count++
      const preview = stmt.replace(/\s+/g, ' ').slice(0, 60)
      console.log('  OK:', preview, '...')
    } catch (err) {
      const msg = err.message || ''
      // Ignorar errores comunes de migraciones idempotentes:
      //   - "already exists"            -> CREATE IF NOT EXISTS ya creado, UNIQUE constraint ya creado
      //   - "duplicate column name"     -> ALTER TABLE ADD COLUMN con columna ya existente
      //   - "no such column"            -> ALTER TABLE RENAME COLUMN de columna ya renombrada
      //   - "no such table"             -> DROP INDEX de indice ya borrado
      //   - "no such index"             -> DROP INDEX de indice ya borrado
      if (msg.includes('already exists') ||
          msg.includes('UNIQUE constraint') ||
          msg.includes('duplicate column name') ||
          msg.includes('no such column') ||
          msg.includes('no such table') ||
          msg.includes('no such index')) {
        continue
      }
      console.error('  ERROR:', msg)
      throw err
    }
  }

  console.log('\nOK: Schema aplicado.', count, 'sentencias ejecutadas.')
  process.exit(0)
}

main().catch((err) => {
  console.error('\nERROR: Falló la inicializacion del schema:')
  console.error(err)
  process.exit(1)
})
