import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'
import bcrypt from 'bcryptjs'

/**
 * GET /api/users
 * Lista todos los profesores (solo admin).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'Solo el admin puede ver usuarios' }, { status: 403 })
  }
  const users = await db.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      username: true,
      name: true,
      role: true,
      createdAt: true,
      _count: { select: { subjects: true } },
    },
  })
  return NextResponse.json({ users })
}

/**
 * POST /api/users
 * Crea un nuevo profesor (solo admin).
 * Body: { username, name, password, role?: "TEACHER" | "ADMIN" }
 *
 * El username es un identificador libre (no email): minimo 3 caracteres,
 * alfanumerico + guion/guion_bajo. Se guarda en lowercase para que el login
 * sea case-insensitive.
 */
export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser(req)
  if (!currentUser) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (!isAdmin(currentUser)) {
    return NextResponse.json({ error: 'Solo el admin puede crear usuarios' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  // Aceptamos tanto `username` (nuevo) como `email` (legacy) para que el
  // formulario v11 todavia funcione si no se ha actualizado.
  const rawUsername = String(body.username || body.email || '').trim()
  // Solo permitimos letras, numeros, guion, guion bajo, punto.
  // NO requerimos formato de email.
  const username = rawUsername.toLowerCase().replace(/[^a-z0-9_.-]/g, '')
  const name = String(body.name || '').trim().replace(/<[^>]*>/g, '').slice(0, 200)
  const password = String(body.password || '')
  const role = body.role === 'ADMIN' ? 'ADMIN' : 'TEACHER'

  if (!username || username.length < 3) {
    return NextResponse.json({ error: 'Nombre de usuario invalido (minimo 3 caracteres)' }, { status: 400 })
  }
  if (username.length > 30) {
    return NextResponse.json({ error: 'Nombre de usuario demasiado largo (maximo 30 caracteres)' }, { status: 400 })
  }
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'Nombre invalido (minimo 2 caracteres)' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password debe tener al menos 6 caracteres' }, { status: 400 })
  }

  // Verificar username no duplicado
  const existing = await db.user.findUnique({ where: { username } })
  if (existing) {
    return NextResponse.json({ error: 'Ya existe un usuario con ese nombre de usuario' }, { status: 409 })
  }

  const passwordHash = await bcrypt.hash(password, 10)
  const newUser = await db.user.create({
    data: { username, name, passwordHash, role },
    select: { id: true, username: true, name: true, role: true, createdAt: true },
  })

  return NextResponse.json({ user: newUser }, { status: 201 })
}
