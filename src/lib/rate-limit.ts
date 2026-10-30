import { NextRequest, NextResponse } from 'next/server'

/**
 * Rate limiter simple in-memory por IP/cliente.
 *
 * No es perfecto (en multi-servidor cada uno tiene su contador) pero para
 * Render Free con un solo servidor funciona. Para producción con varios
 * servidores hay que migrar a Redis (upstash-ratelimit o similar).
 *
 * Algoritmo: fixed window. Cada ventana dura `windowMs` y permite `max`
 * intentos por IP. Cuando se supera, se rechaza con 429.
 *
 * Uso típico:
 *   const limited = rateLimit(req, { key: 'login', max: 10, windowMs: 60_000 })
 *   if (limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
 */

type Bucket = { count: number; resetAt: number }

// Mapa: key → Bucket
const buckets = new Map<string, Bucket>()

// Limpieza periódica para que el mapa no crezca indefinidamente.
// Cada 5 minutos, borra las entradas expiradas.
const CLEANUP_INTERVAL = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  if (Date.now() - lastCleanup < CLEANUP_INTERVAL) return
  const now = Date.now()
  for (const [k, b] of buckets.entries()) {
    if (b.resetAt <= now) {
      buckets.delete(k)
    }
  }
  lastCleanup = now
}

type RateLimitOptions = {
  /** Identificador del endpoint (ej. 'login', 'attendance'). */
  key: string
  /** Número máximo de peticiones permitidas en la ventana. */
  max: number
  /** Duración de la ventana en milisegundos. */
  windowMs: number
}

/**
 * Verifica si la IP del cliente superó el límite.
 * Retorna `null` si está OK (puede continuar), o un NextResponse 429 si
 * está bloqueado.
 *
 * No borrar el bucket al detectar bloqueo — así sigue contando y evita
 * que un atacante renueve su ventana con cada intento.
 */
export function rateLimit(
  req: NextRequest,
  opts: RateLimitOptions
): NextResponse | null {
  cleanup()
  const ip = getClientIp(req)
  const bucketKey = `${opts.key}:${ip}`
  const now = Date.now()
  let bucket = buckets.get(bucketKey)
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + opts.windowMs }
    buckets.set(bucketKey, bucket)
  }
  bucket.count++
  if (bucket.count > opts.max) {
    const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000)
    return NextResponse.json(
      {
        error: `Demasiadas peticiones. Intenta de nuevo en ${retryAfterSec} segundos.`,
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSec),
          'X-RateLimit-Limit': String(opts.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(bucket.resetAt / 1000)),
        },
      }
    )
  }
  return null
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  )
}
