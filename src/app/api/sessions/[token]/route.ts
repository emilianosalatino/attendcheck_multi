import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/sessions/[token]
 * Devuelve info de una sesion para mostrar al alumno. PUBLICO.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const session = await db.classSession.findUnique({
    where: { token },
    select: {
      id: true,
      name: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
    },
  })
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada o QR invalido' }, { status: 404 })
  }
  const now = new Date()
  const isWindowOpen = session.isActive && now >= session.startsAt && now <= session.endsAt
  return NextResponse.json({
    session: {
      id: session.id,
      name: session.name,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      isActive: session.isActive,
      isWindowOpen,
    },
  })
}

/**
 * PATCH /api/sessions/[token]
 * Cierra/reabre sesion. Requiere auth del dueno de la materia o admin.
 * Al reabrir, se extiende endsAt por la duracion original.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const { token } = await params
  const body = await req.json().catch(() => ({}))
  const isActive = Boolean(body.isActive)

  // Verificar ownership
  const session = await db.classSession.findUnique({
    where: { token },
    select: { id: true, subject: { select: { ownerId: true } } },
  })
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada' }, { status: 404 })
  }
  if (!isAdmin(user) && session.subject?.ownerId !== user.userId) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta sesion' }, { status: 403 })
  }

  const now = new Date()
  const updateData: { isActive: boolean; endsAt?: Date; startsAt?: Date } = { isActive }

  if (isActive) {
    const existing = await db.classSession.findUnique({
      where: { token },
      select: { durationMin: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Sesion no encontrada' }, { status: 404 })
    }
    updateData.endsAt = new Date(now.getTime() + existing.durationMin * 60_000)
    updateData.startsAt = now
  }

  const updated = await db.classSession.update({
    where: { token },
    data: updateData,
  })
  return NextResponse.json({ session: updated })
}

/**
 * DELETE /api/sessions/[token]
 * Borra sesion (cascade). Requiere auth del dueno de la materia o admin.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const { token } = await params

  // Verificar ownership
  const session = await db.classSession.findUnique({
    where: { token },
    select: { id: true, subject: { select: { ownerId: true } } },
  })
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada' }, { status: 404 })
  }
  if (!isAdmin(user) && session.subject?.ownerId !== user.userId) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta sesion' }, { status: 403 })
  }

  try {
    await db.classSession.delete({ where: { token } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'No se pudo borrar la sesion' }, { status: 404 })
  }
}
