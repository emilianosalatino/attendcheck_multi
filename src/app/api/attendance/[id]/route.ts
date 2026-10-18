import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser, isAdmin } from '@/lib/session'

/**
 * DELETE /api/attendance/[id]
 * Borra un registro individual. Requiere ser dueno de la sesion o admin.
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
        },
      },
    },
  })
  if (!attendance) {
    return NextResponse.json({ error: 'Registro no encontrado' }, { status: 404 })
  }
  if (!isAdmin(user) && attendance.session?.subject?.ownerId !== user.userId) {
    return NextResponse.json({ error: 'No tienes permiso sobre este registro' }, { status: 403 })
  }

  try {
    await db.attendance.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'No se pudo borrar el registro' }, { status: 404 })
  }
}
