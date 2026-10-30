import { NextRequest, NextResponse } from 'next/server'
import { loginAndSetCookie } from '@/lib/session'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * Retorna: { user: { userId, username, role, name } } + setea cookie JWT
 *
 * Nota: por compatibilidad con formularios legacy, si llega "email" en el body
 * lo tratamos como "username".
 *
 * Rate limiting: 10 intentos por IP por minuto. Si se supera, 429.
 * Esto mitiga fuerza bruta de passwords.
 */
export async function POST(req: NextRequest) {
  // Rate limit: 10 intentos de login por IP por minuto.
  const limited = rateLimit(req, { key: 'login', max: 10, windowMs: 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  // Aceptamos tanto `username` (nuevo) como `email` (legacy)
  const username = String(body.username || body.email || '').trim()
  const password = String(body.password || '')

  if (!username || !password) {
    return NextResponse.json(
      { error: 'Usuario y password son obligatorios' },
      { status: 400 }
    )
  }

  const { user, response } = await loginAndSetCookie(username, password)
  if (!user) {
    return NextResponse.json(
      { error: 'Credenciales invalidas' },
      { status: 401 }
    )
  }

  return NextResponse.json(
    { user },
    {
      status: 200,
      headers: response.headers, // incluye Set-Cookie
    }
  )
}
