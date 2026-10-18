import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/sessions/[token]/attendance
 * Lista asistencias. Requiere auth del dueno de la materia o admin.
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
    select: { id: true, subject: { select: { ownerId: true } } },
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
  return NextResponse.json({ attendances })
}
