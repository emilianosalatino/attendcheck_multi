import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/stats/subject/[id]
 * Estadisticas por materia. Requiere ser dueno de la materia o admin.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  const { id } = await params
  const subject = await db.subject.findUnique({
    where: { id },
    select: { id: true, name: true, color: true, createdAt: true, ownerId: true },
  })
  if (!subject) {
    return NextResponse.json({ error: 'Materia no encontrada' }, { status: 404 })
  }
  if (!isAdmin(user) && subject.ownerId !== user.userId) {
    return NextResponse.json({ error: 'No tienes permiso sobre esta materia' }, { status: 403 })
  }

  const sessions = await db.classSession.findMany({
    where: { subjectId: id },
    orderBy: { startsAt: 'desc' },
    include: { _count: { select: { attendances: true } } },
  })

  const sessionIds = sessions.map((s) => s.id)
  const attendances = await db.attendance.findMany({
    where: { sessionId: { in: sessionIds } },
    select: {
      studentId: true,
      studentGivenNames: true,
      studentPaternalSurname: true,
      studentMaternalSurname: true,
      submittedAt: true,
      sessionId: true,
      flagged: true,
    },
  })

  const studentsMap = new Map<string, {
    studentId: string
    studentGivenNames: string
    studentPaternalSurname: string
    studentMaternalSurname: string | null
    attendanceCount: number
    flaggedCount: number
    firstSeen: Date
    lastSeen: Date
  }>()

  attendances.forEach((a) => {
    const existing = studentsMap.get(a.studentId)
    if (existing) {
      existing.attendanceCount++
      if (a.flagged) existing.flaggedCount++
      if (a.submittedAt < existing.firstSeen) existing.firstSeen = a.submittedAt
      if (a.submittedAt > existing.lastSeen) existing.lastSeen = a.submittedAt
    } else {
      studentsMap.set(a.studentId, {
        studentId: a.studentId,
        studentGivenNames: a.studentGivenNames,
        studentPaternalSurname: a.studentPaternalSurname,
        studentMaternalSurname: a.studentMaternalSurname,
        attendanceCount: 1,
        flaggedCount: a.flagged ? 1 : 0,
        firstSeen: a.submittedAt,
        lastSeen: a.submittedAt,
      })
    }
  })

  const students = Array.from(studentsMap.values())
    .sort((a, b) => a.studentPaternalSurname.localeCompare(b.studentPaternalSurname))
    .map((s) => ({
      ...s,
      totalSessions: sessions.length,
      percent: sessions.length > 0 ? Math.round((s.attendanceCount / sessions.length) * 100) : 0,
    }))

  return NextResponse.json({
    subject: { id: subject.id, name: subject.name, color: subject.color, createdAt: subject.createdAt },
    sessions: sessions.map((s) => ({
      id: s.id,
      name: s.name,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      isActive: s.isActive,
      expectedStudents: s.expectedStudents,
      attendanceCount: s._count.attendances,
      token: s.token,
    })),
    students,
    totals: {
      totalSesiones: sessions.length,
      totalAlumnosUnicos: students.length,
      totalAsistencias: attendances.length,
      promedioAsistencia:
        students.length > 0 && sessions.length > 0
          ? Math.round((attendances.length / (students.length * sessions.length)) * 100)
          : null,
    },
  })
}
