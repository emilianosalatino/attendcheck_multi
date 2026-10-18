import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/subjects
 * Lista materias. Admin ve todas, profesor solo las suyas.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const where = isAdmin(user) ? {} : { ownerId: user.userId }
  const subjects = await db.subject.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { sessions: true } },
      owner: isAdmin(user) ? { select: { id: true, name: true, username: true } } : false,
    },
  })
  return NextResponse.json({ subjects, user })
}

/**
 * POST /api/subjects
 * Crea una materia. El ownerId se setea al usuario actual.
 * Solo profesores y admin pueden crear.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').replace(/<[^>]*>/g, '').trim().slice(0, 200)
  const color = String(body.color || '0f766e').replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || '0f766e'

  if (!name) {
    return NextResponse.json({ error: 'El nombre de la materia es obligatorio' }, { status: 400 })
  }

  // Si es admin, puede especificar a qué profesor asignar la materia
  // Si es profesor, se asigna a sí mismo
  let ownerId: string | null = null
  if (isAdmin(user)) {
    // Admin: si especifica teacherId, usarlo; si no, dejar sin asignar
    ownerId = body.teacherId ? String(body.teacherId).replace(/[^a-zA-Z0-9_-]/g, '') : null
    // Validar que el teacher exista si se especifica
    if (ownerId) {
      const teacher = await db.user.findUnique({ where: { id: ownerId }, select: { id: true } })
      if (!teacher) {
        return NextResponse.json({ error: 'Profesor no encontrado' }, { status: 400 })
      }
    }
  } else {
    ownerId = user.userId
  }

  const subject = await db.subject.create({
    data: {
      name,
      color,
      ownerId,
    },
  })
  return NextResponse.json({ subject }, { status: 201 })
}
