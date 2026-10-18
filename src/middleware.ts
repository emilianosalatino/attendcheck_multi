import { NextRequest, NextResponse } from 'next/server'

/**
 * Middleware global para setear cabeceras de seguridad.
 *
 * - X-Frame-Options: DENY  -> evita clickjacking (no se puede embeber en iframe)
 * - X-Content-Type-Options: nosniff  -> evita MIME-sniffing
 * - Referrer-Policy: no-referrer  -> no filtra el token del QR en Referer
 * - Strict-Transport-Security  -> fuerza HTTPS
 * - Permissions-Policy  -> desactiva APIs que no usamos (camara, mic, etc.)
 *
 * Nota: NO incluimos CSP estricta porque Tailwind usa estilos inline.
 * Si en el futuro quieres CSP, hay que generar nonce por request.
 */
export function middleware(_req: NextRequest) {
  const response = NextResponse.next()

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains'
  )
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()'
  )

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
