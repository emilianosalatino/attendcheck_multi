import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/session'

/**
 * GET /api/auth/me
 * Retorna el usuario actual (del cookie JWT).
 * Si no hay sesion, retorna 401.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json(
      { error: 'No autenticado' },
      { status: 401 }
    )
  }
  return NextResponse.json({ user })
}
