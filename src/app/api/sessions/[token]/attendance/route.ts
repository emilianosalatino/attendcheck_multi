import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin, type CurrentUser } from '@/lib/session'

/**
 * Helper: igual que en /api/sessions/[token]/route.ts
 * (duplicado para mantener cada archivo self-contained)
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
 * GET /api/sessions/[token]/attendance
 * Lista asistencias. Requiere ser el creador de la sesion, o dueno de la
 * materia (legacy), o admin.
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
    select: {
      id: true,
      subject: { select: { ownerId: true } },
      createdByUserId: true,
    },
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
  return NextResponse.json({ attendances })
}
