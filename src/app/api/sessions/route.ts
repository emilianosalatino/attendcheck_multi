import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * GET /api/sessions
 * Lista sesiones. Admin ve todas. Profesor ve SOLO las que el creo
 * (via createdByUserId) O las legacy asignadas a sus materias (subject.ownerId).
 *
 * El filtro legacy por subject.ownerId se mantiene para no romper sesiones
 * viejas creadas antes de v14 (que no tienen createdByUserId).
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // Si es admin, ve todas. Si es profesor, solo las suyas (con fallback legacy).
  const where = isAdmin(user)
    ? {}
    : {
        OR: [
          { createdByUserId: user.userId },
          { subject: { ownerId: user.userId } },
        ],
      }

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

  const durationMin = Math.max(1, Math.min(1440, Number(body.durationMin) || 15))
  const expectedStudents = Math.max(0, Math.min(500, Number(body.expectedStudents) || 0))
  const subjectId = body.subjectId
    ? String(body.subjectId).replace(/[^a-zA-Z0-9_-]/g, '')
    : null

  // NUEVO v14.3: si el cliente manda `endsAt` (ISO string), lo usamos para
  // fijar una fecha/hora de cierre exacta en lugar del calculo startsAt + duration.
  // Esto permite al maestro elegir tipo "cierra mañana a las 18:00".
  // Validamos que sea una fecha valida y este en el futuro.
  let customEndsAt: Date | null = null
  if (body.endsAt) {
    const parsed = new Date(String(body.endsAt))
    if (!Number.isNaN(parsed.getTime())) {
      customEndsAt = parsed
    }
  }

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
  // Si el maestro fijo fecha/hora de cierre, usamos esa. Si no, calculamos
  // desde durationMin. Tambien validamos que endsAt > startsAt (al menos 1 min).
  let endsAt: Date
  let finalDurationMin = durationMin
  if (customEndsAt) {
    const minEnd = new Date(startsAt.getTime() + 60_000) // minimo 1 minuto
    if (customEndsAt <= minEnd) {
      return NextResponse.json(
        { error: 'La fecha de cierre debe ser al menos 1 minuto despues de ahora' },
        { status: 400 }
      )
    }
    // Limitar a maximo 7 dias desde ahora (no tiene sentido mas)
    const maxEnd = new Date(startsAt.getTime() + 7 * 24 * 60 * 60_000)
    if (customEndsAt > maxEnd) {
      return NextResponse.json(
        { error: 'La fecha de cierre no puede ser mas de 7 dias en el futuro' },
        { status: 400 }
      )
    }
    endsAt = customEndsAt
    // Recalcular durationMin para que sea consistente (para cuando se reabra)
    finalDurationMin = Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 60_000))
  } else {
    endsAt = new Date(startsAt.getTime() + durationMin * 60_000)
  }

  const session = await db.classSession.create({
    data: {
      name,
      token,
      subjectId: subjectId || null,
      // El admin tambien queda como creador; como el admin ve todo, esto no le
      // afecta en el filtro. Para profesores, este campo es el que garantiza
      // que ven/editan/borran SOLO sus propias sesiones.
      createdByUserId: user.userId === 'admin-root' ? null : user.userId,
      startsAt,
      endsAt,
      durationMin: finalDurationMin,
      expectedStudents,
      isActive: true,
    },
    include: {
      subject: { select: { id: true, name: true, color: true } },
    },
  })

  return NextResponse.json({ session }, { status: 201 })
}
