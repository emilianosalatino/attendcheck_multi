import { createHmac, timingSafeEqual } from 'crypto'

/**
 * JWT simple usando HMAC-SHA256 (sin dependencias externas).
 * Formato: base64(payload).base64(signature)
 *
 * El payload contiene: { userId, username, role, name, iat }
 *
 * SEGURIDAD ESTRICTA (v16.1+):
 *   - El secreto HMAC se obtiene de JWT_SECRET (env var) UNICAMENTE.
 *   - NO hay fallback a ADMIN_PASSWORD ni a ningún otro env var.
 *   - Si JWT_SECRET no está seteado (o es < 32 chars), el servidor THROW.
 *   - Mejor romper que ser vulnerable: si JWT_SECRET falta, nadie puede
 *     firmar JWTs — ni el admin legítimo ni un atacante.
 *
 * Razón: si el fallback fuera a ADMIN_PASSWORD, un atacante que descubra
 * la password de un profesor podría firmar JWTs con role:ADMIN. Con
 * JWT_SECRET dedicado, conocer passwords de usuarios no sirve para
 * forjar tokens.
 */

const COOKIE_NAME = 'checador_session'
const MAX_AGE = 7 * 24 * 60 * 60 * 1000 // 7 dias en ms
const MIN_JWT_SECRET_LENGTH = 32 // mínimo recomendado para HMAC-SHA256

let cachedSecret: string | null = null
function getSecret(): string {
  if (cachedSecret) return cachedSecret
  const s = process.env.JWT_SECRET
  if (!s || s.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET no configurado o demasiado corto (mínimo ${MIN_JWT_SECRET_LENGTH} caracteres). ` +
        'Setealo en Render → Environment Variables. ' +
        'Generá uno con: openssl rand -hex 32  (o node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"). ' +
        'NO hay fallback — mejor romper que permitir forjar JWTs.'
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
