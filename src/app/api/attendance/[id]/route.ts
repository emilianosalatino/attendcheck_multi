import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin, type CurrentUser } from '@/lib/session'

/**
 * Helper: puede el usuario modificar/borrar un registro de asistencia?
 * Mismo criterio que /api/sessions/[token]/route.ts (PATCH/DELETE):
 *   - Admin: SI
 *   - Creador de la sesion (createdByUserId): SI
 *   - Dueno del subject (legacy): SI
 */
type SessionOwnership = {
  subject: { ownerId: string | null } | null
  createdByUserId: string | null
}
function canModifyAttendance(user: CurrentUser, session: SessionOwnership): boolean {
  if (isAdmin(user)) return true
  if (session.createdByUserId && session.createdByUserId === user.userId) return true
  if (session.subject?.ownerId && session.subject.ownerId === user.userId) return true
  return false
}

/**
 * DELETE /api/attendance/[id]
 * Borra un registro individual. Requiere ser el creador de la sesion, o
 * dueno de la materia (legacy), o admin.
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

  // Verificar ownership via session -> subject -> ownerId
  const attendance = await db.attendance.findUnique({
    where: { id },
    select: {
      id: true,
      session: {
        select: {
          subject: { select: { ownerId: true } },
          createdByUserId: true,
        },
      },
    },
  })
  if (!attendance) {
    return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })
  }
  if (!canModifyAttendance(user, attendance.session)) {
    return NextResponse.json({ error: 'No tienes permiso sobre este registro' }, { status: 403 })
  }

  try {
    await db.attendance.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'No se pudo borrar el registro' }, { status: 404 })
  }
}
