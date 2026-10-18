import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * PATCH /api/subjects/[id]
 * Edita materia. Requiere ser dueno o admin.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const { id } = await params

  // Verificar ownership
  const subject = await db.subject.findUnique({ where: { id }, select: { ownerId: true } })
  if (!subject) {
    return NextResponse.json({ error: 'Materia no encontrada' }, { status: 404 })
  }
  if (!isAdmin(user) && subject.ownerId !== user.userId) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta materia' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const data: { name?: string; color?: string } = {}
  if (body.name !== undefined) {
    data.name = String(body.name).replace(/<[^>]*>/g, '').trim().slice(0, 200)
    if (!data.name) {
      return NextResponse.json({ error: 'Nombre invalido' }, { status: 400 })
    }
  }
  if (body.color !== undefined) {
    data.color = String(body.color).replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || '0f766e'
  }
  try {
    const subject = await db.subject.update({ where: { id }, data })
    return NextResponse.json({ subject })
  } catch {
    return NextResponse.json({ error: 'Materia no encontrada' }, { status: 404 })
  }
}

/**
 * DELETE /api/subjects/[id]
 * Borra materia. Sesiones quedan sin subjectId (SetNull). Requiere ser dueno o admin.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const { id } = await params

  // Verificar ownership
  const subject = await db.subject.findUnique({ where: { id }, select: { ownerId: true } })
  if (!subject) {
    return NextResponse.json({ error: 'Materia no encontrada' }, { status: 404 })
  }
  if (!isAdmin(user) && subject.ownerId !== user.userId) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta materia' }, { status: 403 })
  }

  try {
    await db.subject.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Materia no encontrada' }, { status: 404 })
  }
}
