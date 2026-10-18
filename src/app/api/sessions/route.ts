import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/sessions
 * Lista sesiones. Admin ve todas, profesor solo las de sus materias.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // Si es admin, ve todas. Si es profesor, solo las de sus materias.
  const where = isAdmin(user)
    ? {}
    : { subject: { ownerId: user.userId } }

  const sessions = await db.classSession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      subject: {
        select: {
          id: true,
          name: true,
          color: true,
          ownerId: true,
          owner: isAdmin(user) ? { select: { id: true, name: true, username: true } } : false,
        },
      },
      _count: { select: { attendances: true } },
    },
  })
  return NextResponse.json({ sessions, user })
}

/**
 * POST /api/sessions
 * Crea una sesion. El subjectId debe pertenecer al profesor actual (o ser admin).
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const { randomBytes } = await import('crypto')
  const body = await req.json().catch(() => ({}))
  const rawName = String(body.name || '').trim()
  const name = rawName
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 200)

  const durationMin = Math.max(1, Math.min(480, Number(body.durationMin) || 15))
  const expectedStudents = Math.max(0, Math.min(500, Number(body.expectedStudents) || 0))
  const subjectId = body.subjectId
    ? String(body.subjectId).replace(/[^a-zA-Z0-9_-]/g, '')
    : null

  if (!name) {
    return NextResponse.json({ error: 'El nombre de la sesion es obligatorio' }, { status: 400 })
  }

  // Si subjectId viene, validar que exista Y que pertenezca al profesor
  if (subjectId) {
    const sub = await db.subject.findUnique({
      where: { id: subjectId },
      select: { id: true, ownerId: true },
    })
    if (!sub) {
      return NextResponse.json({ error: 'Materia no encontrada' }, { status: 400 })
    }
    // Si no es admin, verificar ownership
    if (!isAdmin(user) && sub.ownerId !== user.userId) {
      return NextResponse.json({ error: 'No tienes permiso sobre esa materia' }, { status: 403 })
    }
  }

  const token = randomBytes(16).toString('hex')
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000)

  const session = await db.classSession.create({
    data: {
      name,
      token,
      subjectId: subjectId || null,
      startsAt,
      endsAt,
      durationMin,
      expectedStudents,
      isActive: true,
    },
    include: {
      subject: { select: { id: true, name: true, color: true } },
    },
  })

  return NextResponse.json({ session }, { status: 201 })
}
