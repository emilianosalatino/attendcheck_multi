import { NextRequest, NextResponse } from 'next/server'
import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

/**
 * Huella de dispositivo calculada en el SERVIDOR (no en el cliente).
 *
 * El problema de la version anterior:
 *   - El cliente calculaba su propia huella y la enviaba al server.
 *   - El server confiaba ciegamente en lo recibido.
 *   - Un alumno con curl podia enviar cualquier "deviceFp" inventado
 *     y bypasear totalmente el anti-trampa.
 *
 * La nueva version:
 *   - El servidor combina headers HTTP que el navegador envia automaticamente
 *     (User-Agent, Accept-Language, sec-ch-ua, IP) y los hashea con SHA-256.
 *   - El cliente NO puede forjar estos headers desde una pestana normal
 *     del navegador (necesitaria extensiones o DevTools avanzadas).
 *   - Adicionalmente, el servidor setea una cookie HTTP-only firmada con
 *     un secreto, que persiste entre sesiones del navegador.
 *
 * Limitacion honesta: un alumno tecnico podria:
 *   1. Cambiar de navegador (UA distinto, cookie distinta) -> otra huella.
 *   2. Usar curl/Postman con headers custom -> bypasea esto.
 *   3. Limpiar cookies -> genera nueva cookie.
 *
 * Ningun sistema web es 100% anti-trampa. Esto eleva la barrera
 * de "mandar un curl con datos falsos" a "configurar extensiones de
 * navegador o usar varios navegadores", que ya es mucho trabajo.
 */

function sha256(input: string): string {
  return createHmac('sha256', 'fp-static-key-v1').update(input).digest('hex')
}

export function computeServerFingerprint(req: NextRequest): string {
  const parts: string[] = []

  // User-Agent (navegador + SO)
  parts.push('ua:' + (req.headers.get('user-agent') || ''))

  // Idiomas
  parts.push('al:' + (req.headers.get('accept-language') || ''))
  parts.push('ae:' + (req.headers.get('accept-encoding') || ''))

  // Client Hints (Chrome moderno)
  parts.push('cu:' + (req.headers.get('sec-ch-ua') || ''))
  parts.push('cp:' + (req.headers.get('sec-ch-ua-platform') || ''))

  // IP (proxy-aware)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    ''
  parts.push('ip:' + ip)

  return sha256(parts.join('|'))
}

/**
 * Cookie HTTP-only firmada que persiste entre sesiones.
 *
 * La cookie tiene la forma: <uuid>.<hmac-sha256(uuid, secret)>.
 * El alumno no puede forjarla sin conocer TRACKING_SECRET (env var).
 * Si borra las cookies -> nueva cookie -> se podria detectar como
 * "dispositivo nuevo" pero la huella de headers seguira siendo la misma
 * (si usa el mismo navegador y dispositivo).
 */
const COOKIE_NAME = 'asist_track'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365 // 1 año

function getTrackingSecret(): string {
  // SEGURIDAD ESTRICTA (v16.1+): TRACKING_SECRET es obligatorio. NO hay
  // fallback a ADMIN_PASSWORD. Si un atacante conociera la password del
  // admin, no debería poder forjar cookies de tracking — eso requeriría
  // conocer TRACKING_SECRET, que es distinto.
  const s = process.env.TRACKING_SECRET
  if (!s || s.length < 32) {
    throw new Error(
      'TRACKING_SECRET no configurado o demasiado corto (mínimo 32 caracteres). ' +
        'Setealo en Render → Environment Variables (debe ser DISTINTO de JWT_SECRET). ' +
        'Generá uno con: openssl rand -hex 32.'
    )
  }
  return s
}

export function getOrCreateTrackingUuid(
  req: NextRequest,
  res?: NextResponse
): string {
  const cookie = req.cookies.get(COOKIE_NAME)?.value

  if (cookie) {
    // Validar firma
    const [uuid, sig] = cookie.split('.')
    if (uuid && sig) {
      const expectedSig = createHmac('sha256', getTrackingSecret())
        .update(uuid)
        .digest('hex')
      // Comparacion constant-time (anti timing-attack, CWE-208).
      // Antes usabamos === que permitia a un atacante medir el tiempo de
      // respuesta para deducir byte a byte el signature esperado.
      if (sig.length === expectedSig.length && safeEqual(sig, expectedSig)) {
        return uuid
      }
    }
  }

  // No hay cookie o es invalida -> generar nueva
  const newUuid = randomBytes(16).toString('hex')
  const newSig = createHmac('sha256', getTrackingSecret())
    .update(newUuid)
    .digest('hex')
  const newCookie = `${newUuid}.${newSig}`

  if (res) {
    res.cookies.set(COOKIE_NAME, newCookie, {
      httpOnly: true, // JS no la puede leer -> mas seguro
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })
  }

  return newUuid
}

/**
 * Comparacion constant-time (anti timing-attack).
 * Retorna false rapido solo si las longitudes difieren.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}

export const TRACKING_COOKIE_NAME = COOKIE_NAME
