import { createHmac, timingSafeEqual } from 'crypto'

/**
 * JWT simple usando HMAC-SHA256 (sin dependencias externas).
 * Formato: base64(payload).base64(signature)
 *
 * El payload contiene: { userId, username, role, name, iat }
 *
 * Nota sobre seguridad del SECRET:
 *   - Si JWT_SECRET esta seteado, lo usamos.
 *   - Si no, intentamos con ADMIN_PASSWORD (que SI o SI debe estar).
 *   - Si NINGUNO de los dos esta, THROW. Preferimos romper el server
 *     a usar un secreto hardcoded publico que cualquiera podria adivinar
 *     para forjar JWTs de admin.
 *
 * En versiones anteriores (v1..v12) habia un fallback a 'fallback-secret-change-me'
 * que era un string HARDCODED PUBLICO en el codigo fuente -> cualquier atacante
 * podria forjar cookies de admin. ESTO YA NO ES EL CASO.
 */

const COOKIE_NAME = 'checador_session'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 dias en ms

let cachedSecret: string | null = null
function getSecret(): string {
  if (cachedSecret) return cachedSecret
  const s =
    process.env.JWT_SECRET ||
    process.env.ADMIN_PASSWORD ||
    process.env.TEACHER_PASSWORD
  if (!s || s.length < 6) {
    throw new Error(
      'JWT_SECRET no configurado. Setea JWT_SECRET (o al menos ADMIN_PASSWORD) en las variables de entorno. ' +
        'Sin esto, no podemos firmar cookies de sesion de forma segura.'
    )
  }
  cachedSecret = s
  return s
}

function base64Encode(obj: any): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function base64Decode<T>(str: string): T | null {
  try {
    return JSON.parse(Buffer.from(str, 'base64url').toString('utf8')) as T
  } catch {
    return null
  }
}

type JWTPayload = {
  userId: string
  username: string
  role: string
  name: string
  iat: number
  // Campo legacy: presentes en JWTs firmados antes de v12. Los ignoramos al
  // volver a firmar, pero los toleramos al verificar (getCurrentUser mapea).
  email?: string
}

export function signJWT(payload: Omit<JWTPayload, 'iat' | 'email'>): string {
  const fullPayload: JWTPayload = {
    ...payload,
    iat: Date.now(),
  }
  const payloadB64 = base64Encode(fullPayload)
  const signature = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url')
  return `${payloadB64}.${signature}`
}

export function verifyJWT(token: string): JWTPayload | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadB64, signature] = parts
  const expectedSig = createHmac('sha256', getSecret()).update(payloadB64).digest('base64url')
  // Comparacion constant-time para evitar timing attacks que revelen informacion
  // sobre el secret via tiempo de respuesta.
  if (!safeEqualStrings(signature, expectedSig)) return null
  const payload = base64Decode<JWTPayload>(payloadB64)
  if (!payload) return null
  // Verificar expiracion
  if (Date.now() - payload.iat > MAX_AGE) return null
  return payload
}

function safeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

export const JWT_COOKIE_NAME = COOKIE_NAME
export const JWT_MAX_AGE = MAX_AGE
