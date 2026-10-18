import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/session'
import bcrypt from 'bcryptjs'
import { timingSafeEqual } from 'crypto'

/**
 * POST /api/auth/change-password
 *
 * Permite al usuario logueado cambiar SU PROPIA contraseña.
 * Valida la contraseña actual antes de permitir el cambio.
 *
 * Body: { currentPassword: string, newPassword: string }
 *
 * Casos:
 *   - Admin (env-var, no esta en DB): valida contra ADMIN_PASSWORD env var.
 *     Si la cambias, NO se persiste (sigue siendo la de la env var). El endpoint
 *     solo se usa para validar que la sabes — para cambiar la del admin tenes
 *     que editar la env var en Render.
 *   - Profesor (DB): valida con bcrypt.compare contra passwordHash. Si OK,
 *     hashea la nueva y actualiza la DB.
 *
 * Reglas:
 *   - newPassword >= 6 caracteres
 *   - newPassword != currentPassword (no cambiar a la misma)
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser(req)
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const currentPassword = String(body.currentPassword || '')
  const newPassword = String(body.newPassword || '')

  if (!currentPassword || !newPassword) {
    return NextResponse.json(
      { error: 'Faltan datos: currentPassword y newPassword son obligatorios' },
      { status: 400 }
    )
  }
  if (newPassword.length < 6) {
    return NextResponse.json(
      { error: 'La nueva contraseña debe tener al menos 6 caracteres' },
      { status: 400 }
    )
  }
  if (newPassword === currentPassword) {
    return NextResponse.json(
      { error: 'La nueva contraseña debe ser distinta a la actual' },
      { status: 400 }
    )
  }

  // === Admin root (env vars) ===
  // No podemos cambiar la contraseña del admin via DB porque no esta en la DB.
  // Solo validamos que sepa la actual. Para cambiarla, el admin debe editar
  // la env var ADMIN_PASSWORD en Render.
  if (user.userId === 'admin-root') {
    const adminPassword =
      process.env.ADMIN_PASSWORD || process.env.TEACHER_PASSWORD
    if (!adminPassword) {
      return NextResponse.json(
        { error: 'No hay ADMIN_PASSWORD configurada en el servidor' },
        { status: 500 }
      )
    }
    // timing-safe compare
    const ok =
      currentPassword.length === adminPassword.length &&
      safeEqual(currentPassword, adminPassword)
    if (!ok) {
      return NextResponse.json(
        { error: 'Contraseña actual incorrecta' },
        { status: 401 }
      )
    }
    return NextResponse.json({
      ok: true,
      notice:
        'El admin root se autentica via env var ADMIN_PASSWORD. Para cambiar la contraseña, editala en Render → Environment. La DB no la guarda.',
    })
  }

  // === Profesor (DB) ===
  const dbUser = await db.user.findUnique({
    where: { id: user.userId },
    select: { id: true, passwordHash: true },
  })
  if (!dbUser) {
    return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })
  }

  const valid = await bcrypt.compare(currentPassword, dbUser.passwordHash)
  if (!valid) {
    return NextResponse.json(
      { error: 'Contraseña actual incorrecta' },
      { status: 401 }
    )
  }

  const newHash = await bcrypt.hash(newPassword, 10)
  await db.user.update({
    where: { id: dbUser.id },
    data: { passwordHash: newHash },
  })

  return NextResponse.json({ ok: true })
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
  } catch {
    return false
  }
}
