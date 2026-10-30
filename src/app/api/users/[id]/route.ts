import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * DELETE /api/users/[id]
 * Borra un profesor (solo admin). Las materias quedan sin ownerId.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (!isAdmin(user)) {
    return NextResponse.json({ error: 'Solo el admin puede borrar usuarios' }, { status: 403 })
  }
  const { id } = await params
  try {
    await db.user.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }
}

/**
 * PATCH /api/users/[id]
 * Actualiza nombre o password de un profesor (solo admin).
 * Body: { name?: string, password?: string }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const currentUser = await getCurrentUser(req)
  if (!currentUser) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (!isAdmin(currentUser)) {
    return NextResponse.json({ error: 'Solo el admin puede editar usuarios' }, { status: 403 })
  }
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const data: { name?: string; passwordHash?: string; passwordChangedAt?: Date } = {}

  if (body.name !== undefined) {
    data.name = String(body.name).replace(/<[^>]*>/g, '').trim().slice(0, 200)
    if (data.name.length < 2) {
      return NextResponse.json({ error: 'Nombre invalido' }, { status: 400 })
    }
  }
  if (body.password) {
    const newPw = String(body.password)
    if (newPw.length < 6) {
      return NextResponse.json(
        { error: 'La nueva contraseña debe tener al menos 6 caracteres' },
        { status: 400 }
      )
    }
    const bcrypt = await import('bcryptjs')
    data.passwordHash = await bcrypt.hash(newPw, 10)
    // Invalidar JWTs viejos: si el admin resetea la password de un profesor,
    // cualquier sesión activa del profesor se cae inmediatamente.
    data.passwordChangedAt = new Date()
  }

  try {
    const updated = await db.user.update({
      where: { id },
      data,
      select: { id: true, username: true, name: true, role: true },
    })
    return NextResponse.json({ user: updated })
  } catch {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }
}
