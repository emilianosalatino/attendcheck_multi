import { NextRequest, NextResponse } from 'next/server'
import { loginAndSetCookie } from '@/lib/session'

/**
 * POST /api/auth/login
 * Body: { username: string, password: string }
 * Retorna: { user: { userId, username, role, name } } + setea cookie JWT
 *
 * Nota: por compatibilidad con formularios legacy, si llega "email" en el body
 * lo tratamos como "username".
 */
export async function POST(req: NextRequest) {
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
