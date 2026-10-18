import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/stats/session/[token]
 * Estadisticas de una sesion. Requiere ser dueno de la materia o admin.
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
  if (!isAdmin(user) && session.subject?.ownerId !== user.userId) {
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
