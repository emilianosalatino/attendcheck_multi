import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  computeServerFingerprint,
  getOrCreateTrackingUuid,
} from '@/lib/server-fingerprint'
import { rateLimit } from '@/lib/rate-limit'

/**
 * POST /api/attendance
 * Registra la asistencia de un alumno.
 *
 * ESTE ENDPOINT ES PUBLICO: el alumno lo necesita.
 *
 * Body (lo que el cliente envia):
 *   {
 *     token: string                  // token de la sesion (del QR)
 *     studentId: string              // matricula o numero de control
 *     studentGivenNames?: string     // nombre(s) del alumno
 *     studentPaternalSurname?: string // apellido paterno
 *     studentMaternalSurname?: string // apellido materno (opcional)
 *   }
 *
 * Lo que el servidor calcula (NO confia en el cliente):
 *   - deviceFp:   SHA-256 de (User-Agent + Accept-Language + sec-ch-ua + IP)
 *   - trackingUuid: UUID de la cookie HTTP-only firmada (asist_track)
 *
 * Anti-trampa (varias capas):
 *   1. La sesion debe existir y estar dentro de su ventana de tiempo.
 *   2. La misma matricula no puede registrar dos veces la misma sesion (unique constraint).
 *   3. Si el mismo deviceFp (server-side) ya registro con OTRA matricula -> flag.
 *   4. Si el mismo trackingUuid (cookie firmada) ya registro con otra matricula -> flag.
 *   5. Si la ventana ya cerro -> rechazar con error.
 *
 * IMPORTANTE: el cliente ya NO envia deviceFp. El servidor lo calcula.
 * Si el cliente intenta mandar un deviceFp en el body, se IGNORA.
 */
export async function POST(req: NextRequest) {
  try {
    // Rate limit: 30 registros por IP por minuto. Mitiga saturación/spam.
    // Es menos restrictivo que login porque los alumnos reales lo necesitan,
    // pero alcanza para frenar a un script que quiera inyectar miles.
    const limited = rateLimit(req, { key: 'attendance', max: 30, windowMs: 60_000 })
    if (limited) return limited

    const body = await req.json().catch(() => ({}))
    const token = String(body.token || '').trim()
    const studentId = String(body.studentId || '').trim().toUpperCase()
    // Nombres del alumno (Fase 1). El form los envia; los sanitamos y guardamos.
    // Anti-inyección de fórmulas Excel (CWE-1236): si el nombre empieza con
    // = + - @ \t \r, lo rechazamos de entrada. La UI también hace sanitize
    // al exportar, pero defensa en profundidad — mejor no guardar nombres que
    // claramente son intentos de inyección.
    const studentGivenNames = String(body.studentGivenNames || '').trim().slice(0, 100)
    const studentPaternalSurname = String(body.studentPaternalSurname || '').trim().slice(0, 100)
    const studentMaternalSurname = String(body.studentMaternalSurname || '').trim().slice(0, 100)

    const formulaPattern = /^[=+\-@\t\r]/
    if (formulaPattern.test(studentGivenNames) ||
        formulaPattern.test(studentPaternalSurname) ||
        formulaPattern.test(studentMaternalSurname)) {
      return NextResponse.json(
        { error: 'Los nombres no pueden empezar con = + - @' },
        { status: 400 }
      )
    }

    if (!token || !studentId) {
      return NextResponse.json(
        { error: 'Faltan datos (token o matricula)' },
        { status: 400 }
      )
    }
    // Validacion de formato de matricula: 2-15 alfanumerico
    if (!/^[A-Z0-9]{2,15}$/.test(studentId)) {
      return NextResponse.json(
        { error: 'Matricula con formato invalido (solo letras y numeros, 2-15 caracteres)' },
        { status: 400 }
      )
    }

    const session = await db.classSession.findUnique({
      where: { token },
    })
    if (!session) {
      return NextResponse.json(
        { error: 'Sesion no encontrada o QR invalido' },
        { status: 404 }
      )
    }

    const now = new Date()
    if (!session.isActive) {
      return NextResponse.json(
        { error: 'La sesion fue cerrada por el maestro' },
        { status: 403 }
      )
    }
    if (now < session.startsAt) {
      return NextResponse.json(
        { error: 'La sesion aun no abre' },
        { status: 403 }
      )
    }
    if (now > session.endsAt) {
      return NextResponse.json(
        { error: 'El QR ya caduco. Pide a tu maestro generar uno nuevo.' },
        { status: 403 }
      )
    }

    // === FINGERPRINT SERVER-SIDE (NO confia en el cliente) ===
    const deviceFp = computeServerFingerprint(req)

    // Creamos o leemos la cookie firmada HTTP-only.
    // Importante: creamos la response primero para poder setear la cookie.
    const response = NextResponse.json({}, { status: 200 })
    const trackingUuid = getOrCreateTrackingUuid(req, response)

    // IP y User-Agent del cliente (para auditoria)
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'unknown'
    const userAgent = req.headers.get('user-agent') || ''

    // Anti-trampa 1: esta matricula ya registro?
    const existingMat = await db.attendance.findUnique({
      where: { sessionId_studentId: { sessionId: session.id, studentId } },
    })
    if (existingMat) {
      return NextResponse.json(
        {
          error:
            'Tu matricula ya fue registrada en esta sesion. No puedes registrar dos veces.',
          duplicate: true,
        },
        { status: 409 }
      )
    }

    // Anti-trampa 2: mismo deviceFp (server-side) con otra matricula?
    const sameDeviceDiffMat = await db.attendance.findFirst({
      where: {
        sessionId: session.id,
        deviceFp,
        NOT: { studentId },
      },
    })

    // Anti-trampa 3: mismo trackingUuid con otra matricula?
    const sameUuidDiffMat = await db.attendance.findFirst({
      where: {
        sessionId: session.id,
        userAgent: { contains: `uuid:${trackingUuid}` },
        NOT: { studentId },
      },
    })

    let flagged = false
    let flagReason: string | null = null
    if (sameDeviceDiffMat) {
      flagged = true
      flagReason = `Mismo dispositivo (huella server-side) registro antes con la matricula ${sameDeviceDiffMat.studentId}`
    } else if (sameUuidDiffMat) {
      flagged = true
      flagReason = `Mismo dispositivo (cookie de tracking) registro antes con la matricula ${sameUuidDiffMat.studentId}`
    }

    // Guardamos el trackingUuid codificado en el userAgent (mantenemos schema ligero)
    const uaWithUuid = `${userAgent}||uuid:${trackingUuid}`

    let attendance
    try {
      attendance = await db.attendance.create({
        data: {
          sessionId: session.id,
          studentId,
          studentGivenNames,
          studentPaternalSurname,
          studentMaternalSurname: studentMaternalSurname || null,
          deviceFp,
          ip,
          userAgent: uaWithUuid,
          flagged,
          flagReason,
        },
      })
    } catch (err: any) {
      // Si es violacion de unique constraint (matricula duplicada por race condition)
      if (err?.code === 'P2002') {
        return NextResponse.json(
          {
            error:
              'Tu matricula ya fue registrada en esta sesion. No puedes registrar dos veces.',
            duplicate: true,
          },
          { status: 409 }
        )
      }
      // Otro error de BD: loguear server-side, NO exponer detalle al cliente
      // (los mensajes de Prisma pueden revelar nombres de tablas/columnas)
      console.error('[attendance] Error al crear registro:', err)
      return NextResponse.json(
        {
          error: 'No se pudo guardar el registro. Intenta de nuevo o avisa a tu maestro.',
        },
        { status: 500 }
      )
    }

    // Devolvemos la response CON la cookie seteada (si es nueva)
    const studentName = [studentGivenNames, studentPaternalSurname, studentMaternalSurname]
      .filter(Boolean)
      .join(' ')

    return NextResponse.json(
      {
        ok: true,
        attendance: {
          id: attendance.id,
          studentId: attendance.studentId,
          studentName,
          submittedAt: attendance.submittedAt,
          flagged: attendance.flagged,
          flagReason: attendance.flagReason,
        },
      },
      {
        status: 201,
        headers: response.headers, // incluye Set-Cookie
      }
    )
  } catch (err: any) {
    // Catch-all: cualquier error inesperado del handler.
    // Sin esto, Next.js devuelve una pagina HTML 500 y el alumno ve
    // "El servidor tuvo un problema" sin mas contexto.
    // NO exponer el mensaje de error original al cliente (puede contener
    // info sensible: rutas, secretos en stack traces, nombres de columnas, etc.).
    console.error('[attendance] Error inesperado:', err)
    return NextResponse.json(
      {
        error: 'Error interno del servidor. Intenta de nuevo o avisa a tu maestro.',
      },
      { status: 500 }
    )
  }
}
