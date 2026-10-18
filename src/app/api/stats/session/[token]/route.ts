import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin, type CurrentUser } from '@/lib/session'

/**
 * Helper: puede el usuario ver stats de esta sesion?
 * Mismo criterio que /api/sessions/[token]/route.ts (PATCH/DELETE).
 */
type SessionOwnership = {
  subject: { ownerId: string | null } | null
  createdByUserId: string | null
}
function canViewSession(user: CurrentUser, session: SessionOwnership): boolean {
  if (isAdmin(user)) return true
  if (session.createdByUserId && session.createdByUserId === user.userId) return true
  if (session.subject?.ownerId && session.subject.ownerId === user.userId) return true
  return false
}

/**
 * GET /api/stats/session/[token]
 * Estadisticas de una sesion. Requiere ser el creador, o dueno de la materia
 * (legacy), o admin.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const { token } = await params
  const session = await db.classSession.findUnique({
    where: { token },
    include: { subject: { select: { id: true, name: true, color: true, ownerId: true } } },
  })
  if (!session) {
    return NextResponse.json({ error: 'Sesion no encontrada' }, { status: 404 })
  }
  if (!canViewSession(user, session)) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta sesion' }, { status: 403 })
  }
  const attendances = await db.attendance.findMany({
    where: { sessionId: session.id },
    orderBy: { submittedAt: 'asc' },
  })

  const total = attendances.length
  const sospechosas = attendances.filter((a) => a.flagged).length
  const limpias = total - sospechosas
  const expected = session.expectedStudents || 0
  const percent = expected > 0 ? Math.round((total / expected) * 100) : null

  return NextResponse.json({
    session: {
      id: session.id,
      name: session.name,
      startsAt: session.startsAt,
      endsAt: session.endsAt,
      isActive: session.isActive,
      expectedStudents: session.expectedStudents,
      subject: session.subject
        ? { id: session.subject.id, name: session.subject.name, color: session.subject.color }
        : null,
    },
    attendances: attendances.map((a) => ({
      id: a.id,
      studentId: a.studentId,
      studentGivenNames: a.studentGivenNames,
      studentPaternalSurname: a.studentPaternalSurname,
      studentMaternalSurname: a.studentMaternalSurname,
      submittedAt: a.submittedAt,
      flagged: a.flagged,
      flagReason: a.flagReason,
      ip: a.ip,
    })),
    stats: { total, limpias, sospechosas, expected, percent },
  })
}
