import { NextRequest, NextResponse } from 'next/server'
import { db } from './db'
import { signJWT, verifyJWT, JWT_COOKIE_NAME, JWT_MAX_AGE } from './jwt'
import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'crypto'

/**
 * Sesiones del sistema.
 * El admin se identifica via env vars (ADMIN_USERNAME + ADMIN_PASSWORD).
 *   - Por compatibilidad con despliegues anteriores, tambien aceptamos
 *     ADMIN_EMAIL (legacy) si ADMIN_USERNAME no esta seteado.
 * Los profesores se identifican via la tabla User (username + passwordHash bcrypt).
 *
 * Ambos obtienen un JWT cookie HTTP-only valido por 7 dias.
 *
 * Seguridad:
 *   - La comparacion de la password del admin usa timingSafeEqual para evitar
 *     timing attacks que podrian revelar bytes de la password esperada via el
 *     tiempo de respuesta.
 *   - Los JWTs se firman con JWT_SECRET (o ADMIN_PASSWORD como fallback).
 *     Si no hay NINGUN secret disponible, el servidor lanza error al firmar
 *     (mejor romper que usar un secreto publico hardcoded).
 */

export type CurrentUser = {
  userId: string
  username: string
  role: 'ADMIN' | 'TEACHER'
  name: string
}

/**
 * Comparacion de strings constant-time (anti timing-attack).
 * Retorna false rapido solo si las longitudes difieren, lo cual NO filtra
 * informacion sobre la password esperada (el atacante ya sabe la longitud
 * de su intento, no la del expected).
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

/**
 * Obtiene el usuario actual desde el cookie JWT.
 * Retorna null si no hay sesion o es invalida.
 *
 * Seguridad de revocación (CWE-613):
 *   - Verifica la firma del JWT (HMAC).
 *   - Verifica expiración (7 días).
 *   - Para usuarios en la tabla User (NO admin-root): consulta la DB para
 *     confirmar que el usuario sigue existiendo Y que passwordChangedAt
 *     sea <= iat del JWT. Si el admin cambió la password del usuario o lo
 *     borró, el JWT se invalida inmediatamente.
 *   - El admin-root (env vars) no se puede invalidar via DB porque no
 *     está en la tabla. Para invalidar sus sesiones, hay que cambiar
 *     JWT_SECRET en env vars (eso invalida todos los JWTs, no solo los
 *     del admin).
 *
 * Nota: el JWT de sesiones viejas trae campo "email" en lugar de "username".
 * Siempre exponemos "username" al consumidor; si viene del campo legacy,
 * lo copiamos.
 */
export async function getCurrentUser(req: NextRequest): Promise<CurrentUser | null> {
  const cookie = req.cookies.get(JWT_COOKIE_NAME)?.value
  if (!cookie) return null
  const payload = verifyJWT(cookie)
  if (!payload) return null
  // Soporte legacy: JWTs firmados antes de v12 traen "email" en vez de "username"
  const username = (payload as any).username || (payload as any).email || ''
  // Admin root: no consultar DB. La revocación se hace via cambio de JWT_SECRET.
  if (payload.userId === 'admin-root') {
    return {
      userId: payload.userId,
      username,
      role: payload.role as 'ADMIN' | 'TEACHER',
      name: payload.name,
    }
  }
  // Usuarios de la tabla User: consultar DB para verificar vigencia.
  // Si el user fue borrado o cambió su password después de emitirse el JWT,
  // passwordChangedAt > payload.iat → rechazamos.
  try {
    const dbUser = await db.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, username: true, name: true, role: true, passwordChangedAt: true },
    })
    if (!dbUser) {
      // User fue borrado: JWT ya no válido
      return null
    }
    if (dbUser.passwordChangedAt && payload.iat < dbUser.passwordChangedAt.getTime()) {
      // Password cambió después de firmado el JWT: invalidar
      return null
    }
    return {
      userId: dbUser.id,
      username: dbUser.username,
      role: dbUser.role as 'ADMIN' | 'TEACHER',
      name: dbUser.name,
    }
  } catch {
    // Si falla la consulta a DB (por ej. offline), mejor no dejar pasar
    // un token no verificado. Returning null fuerza re-login.
    return null
  }
}

/**
 * Hace login: recibe username + password, valida, y setea el cookie JWT.
 * Retorna el usuario + una response con el cookie seteado.
 */
export async function loginAndSetCookie(
  username: string,
  password: string
): Promise<{ user: CurrentUser | null; response: NextResponse }> {
  const response = NextResponse.json({}, { status: 200 })

  // 1. Verificar si es el admin root (env vars)
  //    ADMIN_USERNAME es lo nuevo; ADMIN_EMAIL se acepta por compatibilidad con v11.
  const adminUsername = process.env.ADMIN_USERNAME || process.env.ADMIN_EMAIL
  const adminPassword = process.env.ADMIN_PASSWORD || process.env.TEACHER_PASSWORD

  if (adminUsername && adminPassword && safeEqual(username.toLowerCase(), adminUsername.toLowerCase())) {
    if (safeEqual(password, adminPassword)) {
      const user: CurrentUser = {
        userId: 'admin-root',
        username: adminUsername,
        role: 'ADMIN',
        name: 'Administrador',
      }
      const token = signJWT(user)
      response.cookies.set(JWT_COOKIE_NAME, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: JWT_MAX_AGE / 1000,
        path: '/',
      })
      return { user, response }
    }
    return { user: null, response }
  }

  // 2. Buscar en la tabla User por username (case-insensitive via lowercase)
  const normalized = username.toLowerCase()
  const dbUser = await db.user.findUnique({
    where: { username: normalized },
  })
  if (!dbUser) return { user: null, response }

  const valid = await bcrypt.compare(password, dbUser.passwordHash)
  if (!valid) return { user: null, response }

  const user: CurrentUser = {
    userId: dbUser.id,
    username: dbUser.username,
    role: dbUser.role as 'ADMIN' | 'TEACHER',
    name: dbUser.name,
  }
  const token = signJWT(user)
  response.cookies.set(JWT_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: JWT_MAX_AGE / 1000,
    path: '/',
  })
  return { user, response }
}

/**
 * Limpia el cookie JWT (logout).
 */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete(JWT_COOKIE_NAME)
}

/**
 * Middleware de auth: obtiene el usuario actual.
 * Si no hay sesion, retorna 401.
 */
export async function requireAuth(req: NextRequest): Promise<CurrentUser | null> {
  return getCurrentUser(req)
}

/**
 * Requiere rol ADMIN. Si no es admin, retorna 403.
 */
export function isAdmin(user: CurrentUser | null): boolean {
  return user?.role === 'ADMIN'
}
