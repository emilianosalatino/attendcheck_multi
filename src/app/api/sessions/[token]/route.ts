import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin, type CurrentUser } from '@/lib/session'

/**
 * Helper: puede el usuario modificar esta sesion?
 *   - Admin: SI
 *   - Creador directo (createdByUserId): SI
 *   - Dueno del subject (legacy, para sesiones viejas sin createdByUserId): SI
 *
 *Esto permite que un maestro cierre/borre SUS sesiones (creadas por el)
 *incluso si la sesion no tiene materia asignada.
 */
type SessionOwnership = {
  subject: { ownerId: string | null } | null
  createdByUserId: string | null
}
function canModifySession(user: CurrentUser, session: SessionOwnership): boolean {
  if (isAdmin(user)) return true
  if (session.createdByUserId && session.createdByUserId === user.userId) return true
  if (session.subject?.ownerId && session.subject.ownerId === user.userId) return true
  return false
}

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
 * Cierra/reabre sesion. Requiere ser el creador de la sesion (createdByUserId),
 * o el dueno de la materia (legacy si la sesion tiene subject), o admin.
 *
 * Al reabrir:
 *   - Si body.durationMin viene, se usa esa cantidad de minutos NUEVOS desde ahora.
 *   - Si no, se usa la durationMin original de la sesion.
 *   Esto permite al maestro elegir "reabrir por X minutos" en vez de
 *   siempre la duracion original (v14.3).
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
    select: {
      id: true,
      subject: { select: { ownerId: true } },
      createdByUserId: true,
      durationMin: true,
    },
  })
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada' }, { status: 404 })
  }
  if (!canModifySession(user, session)) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta sesion' }, { status: 403 })
  }

  const now = new Date()
  const updateData: { isActive: boolean; endsAt?: Date; startsAt?: Date; durationMin?: number } = {
    isActive,
  }

  if (isActive) {
    // Determinar duracion: si body.durationMin viene y es valido, usarlo.
    // Si no, usar la durationMin guardada en la sesion.
    let dur = session.durationMin
    if (body.durationMin !== undefined) {
      const candidate = Number(body.durationMin)
      if (!Number.isFinite(candidate) || candidate < 1 || candidate > 1440) {
        return NextResponse.json(
          { error: 'La duracion debe ser un numero entre 1 y 1440 minutos' },
          { status: 400 }
        )
      }
      dur = Math.floor(candidate)
    }
    updateData.durationMin = dur
    updateData.endsAt = new Date(now.getTime() + dur * 60_000)
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
 * Borra sesion (cascade). Requiere ser el creador, o dueno de la materia, o admin.
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
    select: { id: true, subject: { select: { ownerId: true } }, createdByUserId: true },
  })
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada' }, { status: 404 })
  }
  if (!canModifySession(user, session)) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta sesion' }, { status: 403 })
  }

  try {
    await db.classSession.delete({ where: { token } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'No se pudo borrar la sesion' }, { status: 404 })
  }
}
