'use client'

import { useEffect, useState, useCallback, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { QRCodeSVG } from 'qrcode.react'
import {
  Clock,
  Copy,
  Download,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  StopCircle,
  Play,
  CheckCircle2,
  AlertTriangle,
  Users,
  Calendar,
  Trash2,
  BarChart3,
  BookOpen,
  Plus,
  Edit3,
  KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'

import { useAuth, type AuthUser } from '@/hooks/use-auth'

// ============================================================
// Helpers de seguridad para exports Excel/CSV
// ============================================================

/**
 * Sanitiza un valor de celda para prevenir inyección de fórmulas en Excel/CSV
 * (CWE-1236). Si el string empieza con =, +, -, @, \t o \r, le antepone un
 * apóstrofe ' para que Excel lo trate como texto literal en vez de fórmula.
 *
 * Casos típicos:
 *   "=cmd|'/C calc'!A0"        → "'=cmd|'/C calc'!A0"
 *   "+1+1"                     → "'+1+1"
 *   "@SUM(A1:A2)"              → "'@SUM(A1:A2)"
 *   "Juan Pérez"               → "Juan Pérez"  (sin cambio)
 */
function sanitizeCell(v: unknown): string | number | null {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 'SÍ' : 'NO'
  let s = String(v)
  // Si empieza con caracter peligroso, anteponer apóstrofe
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s
  }
  // Eliminar caracteres de control que podrían romper CSV/Excel
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  return s
}

/**
 * Aplica sanitizeCell a una matriz 2D (array of arrays) antes de pasarla
 * a XLSX.utils.aoa_to_sheet. Mantiene números y strings seguros.
 */
function sanitizeMatrix(m: (string | number | null)[][]): (string | number | null)[][] {
  return m.map((row) => row.map(sanitizeCell))
}

type SessionInfo = {
  id: string
  name: string
  token: string
  startsAt: string
  endsAt: string
  durationMin: number
  isActive: boolean
  expectedStudents?: number
  subjectId?: string | null
  subject?: { id: string; name: string; color: string; owner?: { id: string; name: string; username: string } | null } | null
  _count?: { attendances: number }
  createdAt: string
}

type SubjectInfo = {
  id: string
  name: string
  color: string
  ownerId?: string | null
  owner?: { id: string; name: string; username: string } | null
  createdAt: string
  _count?: { sessions: number }
}

type StudentSessionInfo = {
  id: string
  name: string
  startsAt: string
  endsAt: string
  isActive: boolean
  isWindowOpen: boolean
}

type AttendanceRow = {
  id: string
  studentId: string
  studentGivenNames: string
  studentPaternalSurname: string
  studentMaternalSurname: string | null
  deviceFp: string
  ip: string | null
  userAgent: string | null
  submittedAt: string
  flagged: boolean
  flagReason: string | null
}

function LoadingView() {
  return (
    <div className="grid place-items-center min-h-[60vh]">
      <Loader2 className="size-6 animate-spin text-zinc-400" />
    </div>
  )
}

function HomeInner() {
  // useSearchParams es la forma SSR-safe de leer query params en Next.js 16.
  // El componente padre (Home) lo envuelve en <Suspense> para evitar
  // el error de hydration mismatch.
  const searchParams = useSearchParams()
  const qrToken = searchParams.get('t')
  const view: 'teacher' | 'student' = qrToken ? 'student' : 'teacher'

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900">
      <Toaster richColors position="top-center" />
      <header className="border-b bg-white">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-lg bg-emerald-600 text-white grid place-items-center">
              <QrCode className="size-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Checador de Asistencia</div>
              <div className="text-[11px] text-zinc-500">
                
              </div>
            </div>
          </div>
          {qrToken && (
            <a
              href="/"
              className="text-[11px] text-zinc-500 hover:text-zinc-900"
            >
              Vista de maestro
            </a>
          )}
        </div>
      </header>

      <main className="flex-1">
        {view === 'teacher' && <TeacherDashboard />}
        {view === 'student' && qrToken && (
          <StudentAttendanceForm token={qrToken} />
        )}
      </main>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={<LoadingView />}>
      <HomeInner />
    </Suspense>
  )
}

/* -------------------------- VISTA: PROFESOR -------------------------- */

function TeacherDashboard() {
  const { user, ready, login, logout, authedFetch } = useAuth()
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwChecking, setPwChecking] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [subjects, setSubjects] = useState<SubjectInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [duration, setDuration] = useState(15)
  const [expectedStudents, setExpectedStudents] = useState(0)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('')
  // v14.3: fecha/hora de cierre opcional (datetime-local string, formato HTML: yyyy-MM-ddTHH:mm)
  const [endsAtLocal, setEndsAtLocal] = useState<string>('')
  const [creating, setCreating] = useState(false)
  const [qrSession, setQrSession] = useState<SessionInfo | null>(null)

  // Login con username + password via JWT
  const tryLogin = async () => {
    setPwChecking(true)
    setPwError(null)
    try {
      const ok = await login(loginUsername.trim(), loginPassword)
      if (!ok) {
        setPwError('Credenciales invalidas')
        return
      }
      toast.success(`Bienvenido/a`)
      // Cargar datos iniciales
      const [resSes, resSub] = await Promise.all([
        authedFetch('/api/sessions'),
        authedFetch('/api/subjects'),
      ])
      if (resSes.ok) {
        const d = await resSes.json()
        setSessions(d.sessions || [])
      }
      if (resSub.ok) {
        const d = await resSub.json()
        setSubjects(d.subjects || [])
      }
    } catch {
      setPwError('Error de red')
    } finally {
      setPwChecking(false)
    }
  }

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [resSes, resSub] = await Promise.all([
        authedFetch('/api/sessions'),
        authedFetch('/api/subjects'),
      ])
      if (resSes.status === 401 || resSub.status === 401) {
        toast.error('Tu sesion expiro. Vuelve a loguearte.')
        return
      }
      const dataSes = await resSes.json()
      const dataSub = await resSub.json()
      setSessions(dataSes.sessions || [])
      setSubjects(dataSub.subjects || [])
    } catch (e) {
      toast.error('No se pudieron cargar las sesiones')
    } finally {
      setLoading(false)
    }
  }, [user, authedFetch])

  useEffect(() => {
    if (ready && user) {
      load()
      const id = setInterval(load, 15_000)
      return () => clearInterval(id)
    }
    setLoading(false)
  }, [ready, user, load])

  const createSession = async () => {
    if (!name.trim()) {
      toast.error('Escribe el nombre de la clase')
      return
    }
    setCreating(true)
    try {
      // Convertir endsAtLocal (formato HTML datetime-local: "yyyy-MM-ddTHH:mm")
      // a ISO string. Si el usuario no seteo fecha, mandamos solo durationMin
      // y el server calcula startsAt+durationMin.
      const body: Record<string, unknown> = {
        name: name.trim(),
        durationMin: duration,
        subjectId: selectedSubjectId || null,
        expectedStudents,
      }
      if (endsAtLocal) {
        // El navegador no incluye timezone en datetime-local. Lo parseamos
        // como local time y lo convertimos a ISO con la TZ del cliente.
        const parsed = new Date(endsAtLocal)
        if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > Date.now()) {
          body.endsAt = parsed.toISOString()
        } else {
          toast.error('La fecha/hora de cierre debe ser valida y en el futuro')
          setCreating(false)
          return
        }
      }
      const res = await authedFetch('/api/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al crear sesion')
      }
      const data = await res.json()
      setName('')
      setDuration(15)
      setExpectedStudents(0)
      setSelectedSubjectId('')
      setEndsAtLocal('')
      await load()
      setQrSession(data.session as SessionInfo)
      toast.success('Sesion creada. Muestra el QR a tus alumnos.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  // ====== Reabrir sesion con minutos custom (v14.3) ======
  // Al reabrir, en vez de siempre usar la duracion original, le preguntamos al
  // maestro cuantos minutos quiere. Si cancela el dialogo, no hace nada.
  const [reopenSession, setReopenSession] = useState<SessionInfo | null>(null)
  const [reopenMinutes, setReopenMinutes] = useState<number>(15)

  const toggleActive = async (s: SessionInfo) => {
    const next = !s.isActive
    if (!next) {
      // Cerrar: directo, sin dialogo
      try {
        await authedFetch(`/api/sessions/${s.token}`, {
          method: 'PATCH',
          body: JSON.stringify({ isActive: false }),
        })
        await load()
        toast.success('Sesion cerrada')
      } catch {
        toast.error('No se pudo cerrar la sesion')
      }
      return
    }
    // Reabrir: abrir dialogo para elegir minutos (default = duracion original)
    setReopenSession(s)
    setReopenMinutes(s.durationMin || 15)
  }

  const confirmReopen = async () => {
    if (!reopenSession) return
    if (reopenMinutes < 1 || reopenMinutes > 1440) {
      toast.error('Los minutos deben estar entre 1 y 1440')
      return
    }
    try {
      const res = await authedFetch(`/api/sessions/${reopenSession.token}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: true, durationMin: reopenMinutes }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'No se pudo reabrir')
      }
      await load()
      toast.success(`Sesion reabierta por ${reopenMinutes} minutos`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReopenSession(null)
    }
  }

  const deleteSession = async (s: SessionInfo) => {
    try {
      const res = await authedFetch(`/api/sessions/${s.token}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'No se pudo borrar la sesion')
      }
      await load()
      toast.success('Sesion eliminada (y todas sus asistencias)')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ====== CRUD de materias ======
  const [newSubjectName, setNewSubjectName] = useState('')
  const [newSubjectColor, setNewSubjectColor] = useState('0f766e')
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>('')
  const [creatingSubject, setCreatingSubject] = useState(false)
  const [editingSubject, setEditingSubject] = useState<SubjectInfo | null>(null)
  const [statsSubject, setStatsSubject] = useState<SubjectInfo | null>(null)
  const [statsSession, setStatsSession] = useState<SessionInfo | null>(null)

  const createSubject = async () => {
    if (!newSubjectName.trim()) {
      toast.error('Escribe el nombre de la materia')
      return
    }
    setCreatingSubject(true)
    try {
      const res = await authedFetch('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({
          name: newSubjectName.trim(),
          color: newSubjectColor,
          teacherId: selectedTeacherId || undefined,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al crear materia')
      }
      setNewSubjectName('')
      setNewSubjectColor('0f766e')
      await load()
      toast.success('Materia creada')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreatingSubject(false)
    }
  }

  const updateSubject = async (id: string, data: { name?: string; color?: string }) => {
    try {
      const res = await authedFetch(`/api/subjects/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al actualizar materia')
      }
      setEditingSubject(null)
      await load()
      toast.success('Materia actualizada')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const deleteSubject = async (s: SubjectInfo) => {
    try {
      const res = await authedFetch(`/api/subjects/${s.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'No se pudo borrar la materia')
      }
      await load()
      toast.success('Materia eliminada (las sesiones quedan sin materia asociada)')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // ====== CRUD de profesores (solo admin) ======
  const [users, setUsers] = useState<any[]>([])
  const [newUserUsername, setNewUserUsername] = useState('')
  const [newUserName, setNewUserName] = useState('')
  const [newUserPassword, setNewUserPassword] = useState('')
  const [creatingUser, setCreatingUser] = useState(false)

  // ====== Cambio de contraseña ======
  // - changingOwnPassword: cualquier usuario logueado puede cambiar SU contraseña
  // - resetUser: el admin resetea la contraseña de un profesor (no pide current pw)
  const [ownPwOpen, setOwnPwOpen] = useState(false)
  const [ownCurrent, setOwnCurrent] = useState('')
  const [ownNew, setOwnNew] = useState('')
  const [ownConfirm, setOwnConfirm] = useState('')
  const [ownPwBusy, setOwnPwBusy] = useState(false)

  const [resetUser, setResetUser] = useState<any | null>(null)
  const [resetNew, setResetNew] = useState('')
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  const changeOwnPassword = async () => {
    if (!ownCurrent || !ownNew || !ownConfirm) {
      toast.error('Completa todos los campos')
      return
    }
    if (ownNew !== ownConfirm) {
      toast.error('La nueva contraseña y su confirmacion no coinciden')
      return
    }
    if (ownNew.length < 6) {
      toast.error('La nueva contraseña debe tener al menos 6 caracteres')
      return
    }
    if (ownNew === ownCurrent) {
      toast.error('La nueva contraseña debe ser distinta a la actual')
      return
    }
    setOwnPwBusy(true)
    try {
      const res = await authedFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: ownCurrent,
          newPassword: ownNew,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'No se pudo cambiar la contraseña')
      }
      // Si hay `notice` (caso admin root), NO mostrar "Contraseña cambiada"
      // porque no se cambió nada — la API solo validó que sepas la actual.
      // Para cambiar la del admin hay que editar la env var en Render.
      if (data.notice) {
        toast.warning(data.notice, { duration: 10000 })
      } else {
        toast.success('Contraseña cambiada. Recorda usar la nueva la proxima vez.')
      }
      setOwnPwOpen(false)
      setOwnCurrent('')
      setOwnNew('')
      setOwnConfirm('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setOwnPwBusy(false)
    }
  }

  const resetUserPassword = async () => {
    if (!resetUser) return
    if (!resetNew || !resetConfirm) {
      toast.error('Completa todos los campos')
      return
    }
    if (resetNew !== resetConfirm) {
      toast.error('La nueva contraseña y su confirmacion no coinciden')
      return
    }
    if (resetNew.length < 6) {
      toast.error('La contraseña debe tener al menos 6 caracteres')
      return
    }
    setResetBusy(true)
    try {
      const res = await authedFetch(`/api/users/${resetUser.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: resetNew }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'No se pudo cambiar la contraseña')
      }
      toast.success(`Contraseña de ${resetUser.name} actualizada`)
      setResetUser(null)
      setResetNew('')
      setResetConfirm('')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setResetBusy(false)
    }
  }

  const loadUsers = useCallback(async () => {
    try {
      const res = await authedFetch('/api/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data.users || [])
      }
    } catch {
      // ignore
    }
  }, [authedFetch])

  useEffect(() => {
    if (user?.role === 'ADMIN') {
      loadUsers()
    }
  }, [user, loadUsers])

  const createUser = async () => {
    if (!newUserUsername.trim() || !newUserName.trim() || newUserPassword.length < 6) {
      toast.error('Completa todos los campos (password minimo 6 caracteres)')
      return
    }
    setCreatingUser(true)
    try {
      const res = await authedFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: newUserUsername.trim().toLowerCase(),
          name: newUserName.trim(),
          password: newUserPassword,
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Error al crear profesor')
      }
      setNewUserUsername('')
      setNewUserName('')
      setNewUserPassword('')
      await loadUsers()
      toast.success('Profesor creado')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreatingUser(false)
    }
  }

  const deleteUser = async (id: string) => {
    try {
      const res = await authedFetch(`/api/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        throw new Error('No se pudo borrar')
      }
      await loadUsers()
      toast.success('Profesor eliminado')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  // --- Pantalla de login ---
  if (ready && !user) {
    return (
      <div className="mx-auto max-w-md px-4 py-12 w-full">
        <Card className="border-emerald-200">
          <CardHeader>
            <div className="flex items-center gap-2 mb-1">
              <div className="size-9 rounded-lg bg-emerald-600 text-white grid place-items-center">
                <QrCode className="size-5" />
              </div>
              <CardTitle className="text-base">Acceso al sistema</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="username">Usuario</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                placeholder="ej. profe_maria"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') document.getElementById('pw')?.focus()
                }}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pw">Contraseña</Label>
              <Input
                id="pw"
                type="password"
                placeholder="Tu contraseña"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') tryLogin()
                }}
              />
            </div>
            {pwError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
                {pwError}
              </div>
            )}
            <Button
              onClick={tryLogin}
              disabled={pwChecking || !loginUsername || !loginPassword}
              className="bg-emerald-600 hover:bg-emerald-700 text-white w-full"
            >
              {pwChecking ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Entrar
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // --- Boton de logout arriba a la derecha ---
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 w-full relative">
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
        <span className="text-xs text-zinc-500 hidden sm:inline">
          {user?.name} ({user?.role === 'ADMIN' ? 'Admin' : 'Maestro'})
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setOwnPwOpen(true)}
          title="Cambiar mi contraseña"
        >
          <KeyRound className="size-4 mr-1" />
          <span className="hidden sm:inline">Mi contraseña</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            logout()
            toast.success('Sesion cerrada')
          }}
          title="Cerrar sesion"
        >
          Salir
        </Button>
      </div>

      {/* Dialog: Cambiar mi propia contraseña (cualquier usuario logueado) */}
      <Dialog open={ownPwOpen} onOpenChange={setOwnPwOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar mi contraseña</DialogTitle>
            <DialogDescription>
              Te pedimos la contraseña actual por seguridad. La nueva debe tener
              al menos 6 caracteres y ser distinta.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="own_current">Contraseña actual</Label>
              <Input
                id="own_current"
                type="password"
                value={ownCurrent}
                onChange={(e) => setOwnCurrent(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="own_new">Nueva contraseña</Label>
              <Input
                id="own_new"
                type="password"
                value={ownNew}
                onChange={(e) => setOwnNew(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="own_confirm">Repetir nueva contraseña</Label>
              <Input
                id="own_confirm"
                type="password"
                value={ownConfirm}
                onChange={(e) => setOwnConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !ownPwBusy) changeOwnPassword()
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={ownPwBusy}>Cancelar</Button>
            </DialogClose>
            <Button
              onClick={changeOwnPassword}
              disabled={ownPwBusy || !ownCurrent || !ownNew || !ownConfirm}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {ownPwBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Cambiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Admin resetea contraseña de un profesor */}
      <Dialog
        open={!!resetUser}
        onOpenChange={(o) => { if (!o) { setResetUser(null); setResetNew(''); setResetConfirm('') } }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar contraseña de {resetUser?.name}</DialogTitle>
            <DialogDescription>
              Como admin, no necesitas saber la contraseña actual. Solo definí
              la nueva (mínimo 6 caracteres). Avisale al profesor.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-2">
              <Label htmlFor="reset_new">Nueva contraseña</Label>
              <Input
                id="reset_new"
                type="password"
                value={resetNew}
                onChange={(e) => setResetNew(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="reset_confirm">Repetir contraseña</Label>
              <Input
                id="reset_confirm"
                type="password"
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !resetBusy) resetUserPassword()
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={resetBusy}>Cancelar</Button>
            </DialogClose>
            <Button
              onClick={resetUserPassword}
              disabled={resetBusy || !resetNew || !resetConfirm}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {resetBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Cambiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Reabrir sesion con minutos custom (v14.3) */}
      <Dialog
        open={!!reopenSession}
        onOpenChange={(o) => { if (!o) setReopenSession(null) }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reabrir sesión</DialogTitle>
            <DialogDescription>
              {reopenSession ? (
                <>
                  Vas a reabrir <strong className="text-zinc-900">{reopenSession.name}</strong>.
                  Elegí por cuántos minutos dejarla activa. El contador arranca ahora mismo.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="reopen_min">Minutos de apertura</Label>
            <Input
              id="reopen_min"
              type="number"
              min={1}
              max={1440}
              value={reopenMinutes}
              onChange={(e) => setReopenMinutes(Number(e.target.value) || 15)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirmReopen()
              }}
            />
            <p className="text-[11px] text-zinc-500">
              Máximo 1440 (24 hs). La duración original era {reopenSession?.durationMin ?? '?'} min.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancelar</Button>
            </DialogClose>
            <Button
              onClick={confirmReopen}
              disabled={reopenMinutes < 1 || reopenMinutes > 1440}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <Play className="size-4" />
              Reabrir {reopenMinutes || 0} min
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs defaultValue="sesiones" className="w-full">
        <TabsList className={`grid w-full max-w-md mb-4 ${user?.role === 'ADMIN' ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <TabsTrigger value="sesiones">
            <Calendar className="size-4 mr-1" /> Sesiones
          </TabsTrigger>
          <TabsTrigger value="materias">
            <BookOpen className="size-4 mr-1" /> Materias
          </TabsTrigger>
          {user?.role === 'ADMIN' && (
            <TabsTrigger value="profesores">
              <Users className="size-4 mr-1" /> Profesores
            </TabsTrigger>
          )}
        </TabsList>

        {/* ====== TAB: Sesiones ====== */}
        <TabsContent value="sesiones" className="space-y-4">
          {/* Hero / nueva sesion */}
          <Card className="border-emerald-200 bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="size-5 text-emerald-600" />
                Crear nueva sesion de clase
              </CardTitle>
              <CardDescription>
                Genera un QR con vigencia limitada. Tus alumnos lo escanean y
                registran su matricula. Detectamos trampa si el mismo dispositivo
                intenta registrar con otra matricula.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Nombre de la sesion</Label>
                <Input
                  id="name"
                  placeholder="Ej. Sesion del 15 oct - Repaso parcial"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createSession()
                  }}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="subj">Materia (opcional)</Label>
                  <select
                    id="subj"
                    value={selectedSubjectId}
                    onChange={(e) => setSelectedSubjectId(e.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Sin materia</option>
                    {subjects.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {sub.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="exp">Alumnos esperados</Label>
                  <Input
                    id="exp"
                    type="number"
                    min={0}
                    max={500}
                    value={expectedStudents}
                    onChange={(e) =>
                      setExpectedStudents(Number(e.target.value) || 0)
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="dur">Vigencia (min)</Label>
                  <Input
                    id="dur"
                    type="number"
                    min={1}
                    max={1440}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value) || 15)}
                  />
                </div>
              </div>
              {/* Fecha/hora de cierre opcional. Si se setea, overridea Vigencia. */}
              <div className="grid gap-2">
                <Label htmlFor="endsat" className="flex items-center gap-1">
                  Cerrar a fecha/hora exacta
                  <span className="text-[10px] text-zinc-400 font-normal">
                    (opcional — si lo seteas, ignora la vigencia en minutos)
                  </span>
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="endsat"
                    type="datetime-local"
                    value={endsAtLocal}
                    onChange={(e) => setEndsAtLocal(e.target.value)}
                    className="flex-1 min-w-[200px]"
                  />
                  {endsAtLocal && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setEndsAtLocal('')}
                    >
                      Limpiar
                    </Button>
                  )}
                </div>
              </div>
              <Button
                onClick={createSession}
                disabled={creating}
                className="bg-emerald-600 hover:bg-emerald-700 text-white w-full sm:w-auto sm:self-start"
              >
                {creating ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <QrCode className="size-4" />
                )}
                Generar QR
              </Button>
            </CardContent>
          </Card>

          {/* Lista de sesiones */}
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zinc-700 flex items-center gap-2">
              <Users className="size-4" /> Sesiones recientes
            </h2>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
              Refrescar
            </Button>
          </div>

          {loading && sessions.length === 0 ? (
            <div className="grid place-items-center py-12">
              <Loader2 className="size-5 animate-spin text-zinc-400" />
            </div>
          ) : sessions.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-zinc-500">
                No hay sesiones todavia. Crea una arriba para empezar.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {sessions.map((s) => (
                <SessionRow
                  key={s.id}
                  s={s}
                  onShowQR={() => setQrSession(s)}
                  onToggle={() => toggleActive(s)}
                  onDelete={() => deleteSession(s)}
                  onStats={() => setStatsSession(s)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ====== TAB: Materias ====== */}
        <TabsContent value="materias" className="space-y-4">
          <Card className="border-emerald-200 bg-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="size-5 text-emerald-600" />
                Crear nueva materia
              </CardTitle>
              <CardDescription>
                Las materias agrupan sesiones. Crea una por clase que impartas.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
              <div className="grid gap-2">
                <Label htmlFor="subjname">Nombre</Label>
                <Input
                  id="subjname"
                  placeholder="Ej. Calculo Diferencial - Grupo A"
                  value={newSubjectName}
                  onChange={(e) => setNewSubjectName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createSubject()
                  }}
                />
                {user?.role === 'ADMIN' && users.length > 0 && (
                  <select
                    value={selectedTeacherId}
                    onChange={(e) => setSelectedTeacherId(e.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  >
                    <option value="">Sin asignar</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="subjcolor">Color</Label>
                <div className="flex items-center gap-2">
                  <input
                    id="subjcolor"
                    type="color"
                    value={'#' + newSubjectColor}
                    onChange={(e) =>
                      setNewSubjectColor(
                        e.target.value.replace('#', '').slice(0, 6)
                      )
                    }
                    className="h-9 w-12 rounded border border-input cursor-pointer"
                  />
                  <Input
                    value={newSubjectColor}
                    onChange={(e) =>
                      setNewSubjectColor(
                        e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                      )
                    }
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div className="grid gap-2 items-end">
                <Button
                  onClick={createSubject}
                  disabled={creatingSubject}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {creatingSubject ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Crear
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Lista de materias */}
          {subjects.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-zinc-500">
                No hay materias todavia. Crea una arriba para empezar.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {subjects.map((s) => (
                <SubjectRow
                  key={s.id}
                  s={s}
                  onStats={() => setStatsSubject(s)}
                  onEdit={() => setEditingSubject(s)}
                  onDelete={() => deleteSubject(s)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ====== TAB: Profesores (solo admin) ====== */}
        {user?.role === 'ADMIN' && (
          <TabsContent value="profesores" className="space-y-4">
            <Card className="border-emerald-200 bg-white">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5 text-emerald-600" />
                  Crear nuevo profesor
                </CardTitle>
                <CardDescription>
                  El profesor podra crear sus propias materias, sesiones y ver sus stats.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                <div className="grid gap-2">
                  <Label htmlFor="nuusername">Nombre de usuario</Label>
                  <Input
                    id="nuusername"
                    type="text"
                    autoComplete="off"
                    placeholder="ej. profe_maria"
                    value={newUserUsername}
                    onChange={(e) => setNewUserUsername(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nunombre">Nombre completo</Label>
                  <Input
                    id="nunombre"
                    placeholder="Ej. Maria Garcia"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createUser()
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="nupass">Contraseña temporal</Label>
                  <Input
                    id="nupass"
                    type="password"
                    placeholder="Minimo 6 caracteres"
                    value={newUserPassword}
                    onChange={(e) => setNewUserPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createUser()
                    }}
                  />
                </div>
                <div className="grid gap-2 items-end">
                  <Button
                    onClick={createUser}
                    disabled={creatingUser}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {creatingUser ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Plus className="size-4" />
                    )}
                    Crear
                  </Button>
                </div>
              </CardContent>
            </Card>

            {users.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-zinc-500">
                  No hay profesores registrados. Crea uno arriba.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3">
                {users.map((u) => (
                  <Card key={u.id}>
                    <CardContent className="p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-800">
                          {u.name}{' '}
                          <span className="text-[10px] text-zinc-500 font-normal">
                            {u.role === 'ADMIN' ? '(Admin)' : '(Profesor)'}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          @{u.username} — {u._count?.subjects ?? 0} materia(s)
                        </div>
                      </div>
                      {u.role !== 'ADMIN' && (
                        <div className="flex gap-2 shrink-0">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setResetUser(u)
                              setResetNew('')
                              setResetConfirm('')
                            }}
                            title="Cambiar contraseña"
                          >
                            <KeyRound className="size-4" />
                            <span className="hidden sm:inline ml-1">Contraseña</span>
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>¿Eliminar a {u.name}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Se borrara el profesor. Sus materias quedaran sin dueno
                                  (puedes reasignarlas despues). Esta accion no se puede deshacer.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteUser(u.id)}
                                  className="bg-red-600 hover:bg-red-700 text-white"
                                >
                                  <Trash2 className="size-4" /> Eliminar
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        )}
      </Tabs>

      {/* Modales */}
      {qrSession && (
        <QRDialog session={qrSession} onClose={() => setQrSession(null)} />
      )}
      {statsSession && (
        <SessionStatsDialog
          session={statsSession}
          onClose={() => setStatsSession(null)}
        />
      )}
      {statsSubject && (
        <SubjectStatsDialog
          subject={statsSubject}
          onClose={() => setStatsSubject(null)}
        />
      )}
      {editingSubject && (
        <EditSubjectDialog
          subject={editingSubject}
          onClose={() => setEditingSubject(null)}
          onSave={(data) => updateSubject(editingSubject.id, data)}
        />
      )}
    </div>
  )
}

function SessionRow({
  s,
  onShowQR,
  onToggle,
  onDelete,
  onStats,
}: {
  s: SessionInfo
  onShowQR: () => void
  onToggle: () => void
  onDelete: () => void
  onStats: () => void
}) {
  const startsAt = new Date(s.startsAt)
  const endsAt = new Date(s.endsAt)
  const now = new Date()
  const isExpired = now > endsAt
  const status = !s.isActive
    ? 'closed'
    : isExpired
      ? 'expired'
      : 'active'
  const statusMap = {
    active: { label: 'Activa', color: 'bg-emerald-100 text-emerald-700' },
    expired: { label: 'Caducó', color: 'bg-zinc-100 text-zinc-600' },
    closed: { label: 'Cerrada', color: 'bg-red-100 text-red-700' },
  } as const
  const attendanceCount = s._count?.attendances ?? 0
  const expected = s.expectedStudents ?? 0
  const percent =
    expected > 0 ? Math.round((attendanceCount / expected) * 100) : null

  return (
    <Card>
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                statusMap[status].color
              }`}
            >
              {statusMap[status].label}
            </span>
            {s.subject && (
              <span
                className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                style={{ backgroundColor: '#' + s.subject.color }}
              >
                <BookOpen className="size-2.5 mr-1" /> {s.subject.name}
              </span>
            )}
            {s.subject?.owner && (
              <span className="inline-flex items-center rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                <Users className="size-2.5 mr-1" /> {s.subject.owner.name}
              </span>
            )}
            <span className="text-[11px] text-zinc-500">
              {startsAt.toLocaleString('es-MX', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              -{' '}
              {endsAt.toLocaleTimeString('es-MX', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="text-sm font-medium text-zinc-800 truncate">
            {s.name}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            {attendanceCount} asistencia(s)
            {expected > 0 && (
              <>
                {' '}
                / {expected} esperadas
                {percent !== null && (
                  <span
                    className={`ml-1 font-medium ${
                      percent >= 80
                        ? 'text-emerald-700'
                        : percent >= 50
                          ? 'text-amber-700'
                          : 'text-red-700'
                    }`}
                  >
                    ({percent}%)
                  </span>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={onShowQR}>
            <QrCode className="size-4" /> Ver QR
          </Button>
          <AttendanceDialog
            session={s}
            trigger={
              <Button size="sm" variant="outline">
                <Users className="size-4" /> Lista
              </Button>
            }
          />
          <Button size="sm" variant="outline" onClick={onStats}>
            <BarChart3 className="size-4" /> Stats
          </Button>
          <Button
            size="sm"
            variant={s.isActive ? 'destructive' : 'outline'}
            onClick={onToggle}
          >
            {s.isActive ? (
              <>
                <StopCircle className="size-4" /> Cerrar
              </>
            ) : (
              <>
                <Play className="size-4" /> Abrir
              </>
            )}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta sesion?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borrara permanentemente la sesion{' '}
                  <strong className="text-zinc-900">{s.name}</strong> junto con{' '}
                  {s._count?.attendances ?? 0} registro(s) de asistencia
                  asociado(s). Esta accion no se puede deshacer.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  <Trash2 className="size-4" /> Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

/* ---------- Fila de Materia ---------- */
function SubjectRow({
  s,
  onStats,
  onEdit,
  onDelete,
}: {
  s: SubjectInfo
  onStats: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card>
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div
            className="size-10 rounded-lg shrink-0"
            style={{ backgroundColor: '#' + s.color }}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium text-zinc-800 truncate">
              {s.name}
            </div>
            <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2">
              <span>{s._count?.sessions ?? 0} sesion(es) registradas</span>
              {s.owner && (
                <span className="inline-flex items-center gap-1 text-zinc-400">
                  · <Users className="size-3" /> {s.owner.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={onStats}>
            <BarChart3 className="size-4" /> Stats
          </Button>
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Edit3 className="size-4" /> Editar
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>¿Eliminar esta materia?</AlertDialogTitle>
                <AlertDialogDescription>
                  Se borrara <strong className="text-zinc-900">{s.name}</strong>.
                  Las sesiones asociadas NO se borran, pero quedaran sin materia
                  asignada.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDelete}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  <Trash2 className="size-4" /> Eliminar
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  )
}

/* ---------- Modal: Editar Materia ---------- */
function EditSubjectDialog({
  subject,
  onClose,
  onSave,
}: {
  subject: SubjectInfo
  onClose: () => void
  onSave: (data: { name?: string; color?: string }) => void
}) {
  const [name, setName] = useState(subject.name)
  const [color, setColor] = useState(subject.color)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="size-5 text-emerald-600" />
            Editar materia
          </DialogTitle>
          <DialogDescription>Cambia el nombre o color.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-2">
            <Label htmlFor="edname">Nombre</Label>
            <Input
              id="edname"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edcolor">Color</Label>
            <div className="flex items-center gap-2">
              <input
                id="edcolor"
                type="color"
                value={'#' + color}
                onChange={(e) =>
                  setColor(e.target.value.replace('#', '').slice(0, 6))
                }
                className="h-9 w-12 rounded border border-input cursor-pointer"
              />
              <Input
                value={color}
                onChange={(e) =>
                  setColor(
                    e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
                  )
                }
                className="font-mono text-xs"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() =>
              onSave({
                name: name.trim() || subject.name,
                color: color || subject.color,
              })
            }
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Modal: Stats por Sesion ---------- */
function SessionStatsDialog({
  session,
  onClose,
}: {
  session: SessionInfo
  onClose: () => void
}) {
  const { authedFetch } = useAuth()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/stats/session/${session.token}`)
      if (!res.ok) {
        toast.error('No se pudieron cargar las stats')
        return
      }
      const d = await res.json()
      setData(d)
    } catch {
      toast.error('Error de red')
    } finally {
      setLoading(false)
    }
  }, [session.token, authedFetch])

  useEffect(() => {
    load()
  }, [load])

  const exportExcel = () => {
    if (!data) return
    const wb = XLSX.utils.book_new()
    // Hoja 1: resumen
    const summary = [
      ['Sesion', data.session.name],
      ['Materia', data.session.subject?.name || '(sin materia)'],
      ['Fecha', new Date(data.session.startsAt).toLocaleString('es-MX')],
      ['Estado', data.session.isActive ? 'Activa' : 'Cerrada'],
      ['Esperados', data.session.expectedStudents],
      ['Total asistencias', data.stats.total],
      ['Limpias', data.stats.limpias],
      ['Sospechosas', data.stats.sospechosas],
      ['% Asistencia', data.stats.percent !== null ? data.stats.percent + '%' : 'N/A'],
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(sanitizeMatrix(summary))
    ws1['!cols'] = [{ wch: 25 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')

    // Hoja 2: lista detallada
    // Incluye columna "Sesion" al inicio para que sepas de que sesion es cada fila
    // (util cuando combinas exports de varias sesiones en un solo Excel)
    const rows = [
      ['Sesion', 'Matricula', 'Nombre(s)', 'Apellido paterno', 'Apellido materno', 'Nombre completo', 'Hora', 'Sospechoso', 'Razon', 'IP'],
      ...data.attendances.map((a: any) => [
        data.session.name,
        a.studentId,
        a.studentGivenNames,
        a.studentPaternalSurname,
        a.studentMaternalSurname ?? '',
        [a.studentGivenNames, a.studentPaternalSurname, a.studentMaternalSurname]
          .filter(Boolean)
          .join(' '),
        new Date(a.submittedAt).toLocaleString('es-MX'),
        a.flagged ? 'SI' : 'NO',
        a.flagReason ?? '',
        a.ip ?? '',
      ]),
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(sanitizeMatrix(rows))
    ws2['!cols'] = [
      { wch: 30 }, // Sesion
      { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 35 },
      { wch: 20 }, { wch: 11 }, { wch: 50 }, { wch: 18 },
    ]
    XLSX.utils.book_append_sheet(wb, ws2, 'Asistencias')

    XLSX.writeFile(wb, `stats_sesion_${session.name.replace(/\s+/g, '_')}.xlsx`)
    toast.success('Excel exportado')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-5 text-emerald-600" />
            Estadisticas — {session.name}
          </DialogTitle>
          <DialogDescription>
            {data?.session?.subject?.name
              ? `Materia: ${data.session.subject.name}`
              : 'Sin materia asignada'}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Resumen de stats */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">
                  {data.stats.total}
                </div>
                <div className="text-[10px] text-emerald-800 uppercase">Total</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">
                  {data.stats.limpias}
                </div>
                <div className="text-[10px] text-emerald-800 uppercase">Limpias</div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-amber-700">
                  {data.stats.sospechosas}
                </div>
                <div className="text-[10px] text-amber-800 uppercase">Sospechosas</div>
              </div>
              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-zinc-700">
                  {data.stats.expected || '-'}
                </div>
                <div className="text-[10px] text-zinc-600 uppercase">Esperados</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">
                  {data.stats.percent !== null ? data.stats.percent + '%' : '-'}
                </div>
                <div className="text-[10px] text-emerald-800 uppercase">% Asist.</div>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-zinc-700">
                Lista detallada ({data.attendances.length})
              </h3>
              <Button size="sm" variant="outline" onClick={exportExcel}>
                <Download className="size-4" /> Exportar Excel
              </Button>
            </div>

            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Matricula</th>
                    <th className="text-left font-medium px-3 py-2">Nombre</th>
                    <th className="text-left font-medium px-3 py-2">Hora</th>
                    <th className="text-left font-medium px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attendances.map((a: any) => (
                    <tr
                      key={a.id}
                      className={`border-t ${
                        a.flagged ? 'bg-amber-50' : 'bg-white'
                      } hover:bg-zinc-50`}
                    >
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {a.studentId}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {[a.studentGivenNames, a.studentPaternalSurname, a.studentMaternalSurname]
                          .filter(Boolean)
                          .join(' ')}
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-600 whitespace-nowrap">
                        {new Date(a.submittedAt).toLocaleTimeString('es-MX', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-3 py-2">
                        {a.flagged ? (
                          <span className="text-[11px] text-amber-700">
                            <AlertTriangle className="size-3 inline mr-1" />
                            {a.flagReason}
                          </span>
                        ) : (
                          <span className="text-[11px] text-emerald-700">
                            <CheckCircle2 className="size-3 inline mr-1" />OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-zinc-500">
            No se pudieron cargar las stats.
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- Modal: Stats por Materia ---------- */
function SubjectStatsDialog({
  subject,
  onClose,
}: {
  subject: SubjectInfo
  onClose: () => void
}) {
  const { authedFetch } = useAuth()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/stats/subject/${subject.id}`)
      if (!res.ok) {
        toast.error('No se pudieron cargar las stats')
        return
      }
      const d = await res.json()
      setData(d)
    } catch {
      toast.error('Error de red')
    } finally {
      setLoading(false)
    }
  }, [subject.id, authedFetch])

  useEffect(() => {
    load()
  }, [load])

  const exportExcel = () => {
    if (!data) return
    const wb = XLSX.utils.book_new()
    // Hoja 1: resumen
    const summary = [
      ['Materia', data.subject.name],
      ['Total sesiones', data.totals.totalSesiones],
      ['Alumnos unicos', data.totals.totalAlumnosUnicos],
      ['Total asistencias', data.totals.totalAsistencias],
      ['% asistencia promedio', data.totals.promedioAsistencia + '%'],
    ]
    const ws1 = XLSX.utils.aoa_to_sheet(sanitizeMatrix(summary))
    ws1['!cols'] = [{ wch: 25 }, { wch: 30 }]
    XLSX.utils.book_append_sheet(wb, ws1, 'Resumen')

    // Hoja 2: sesiones
    const sesRows = [
      ['Nombre sesion', 'Fecha', 'Estado', 'Esperados', 'Asistencias'],
      ...data.sessions.map((s: any) => [
        s.name,
        new Date(s.startsAt).toLocaleString('es-MX'),
        s.isActive ? 'Activa' : 'Cerrada',
        s.expectedStudents,
        s.attendanceCount,
      ]),
    ]
    const ws2 = XLSX.utils.aoa_to_sheet(sanitizeMatrix(sesRows))
    ws2['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 12 }]
    XLSX.utils.book_append_sheet(wb, ws2, 'Sesiones')

    // Hoja 3: alumnos
    // Incluye columna "Materia" al inicio para identificar a que materia pertenecen
    // (los datos son agregados por materia, asi que la columna es la misma para todas las filas
    // pero es util cuando combinas exports de varias materias)
    const stuRows = [
      ['Materia', 'Matricula', 'Nombre(s)', 'Apellido paterno', 'Apellido materno', 'Nombre completo', 'Asistencias', 'Total sesiones', '% Asistencia', 'Sospechosas', 'Primera vez visto', 'Ultima vez visto'],
      ...data.students.map((s: any) => [
        data.subject.name,
        s.studentId,
        s.studentGivenNames,
        s.studentPaternalSurname,
        s.studentMaternalSurname ?? '',
        [s.studentGivenNames, s.studentPaternalSurname, s.studentMaternalSurname]
          .filter(Boolean)
          .join(' '),
        s.attendanceCount,
        s.totalSessions,
        s.percent + '%',
        s.flaggedCount,
        new Date(s.firstSeen).toLocaleString('es-MX'),
        new Date(s.lastSeen).toLocaleString('es-MX'),
      ]),
    ]
    const ws3 = XLSX.utils.aoa_to_sheet(sanitizeMatrix(stuRows))
    ws3['!cols'] = [
      { wch: 30 }, // Materia
      { wch: 12 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 35 },
      { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 20 }, { wch: 20 },
    ]
    XLSX.utils.book_append_sheet(wb, ws3, 'Alumnos')

    XLSX.writeFile(wb, `stats_materia_${subject.name.replace(/\s+/g, '_')}.xlsx`)
    toast.success('Excel exportado')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="size-5 text-emerald-600" />
            Stats — {subject.name}
          </DialogTitle>
          <DialogDescription>
            Estadisticas globales de la materia
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Resumen */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-zinc-700">
                  {data.totals.totalSesiones}
                </div>
                <div className="text-[10px] text-zinc-600 uppercase">Sesiones</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">
                  {data.totals.totalAlumnosUnicos}
                </div>
                <div className="text-[10px] text-emerald-800 uppercase">Alumnos unicos</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">
                  {data.totals.totalAsistencias}
                </div>
                <div className="text-[10px] text-emerald-800 uppercase">Total asistencias</div>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">
                  {data.totals.promedioAsistencia ?? '-'}%
                </div>
                <div className="text-[10px] text-emerald-800 uppercase">% promedio</div>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <h3 className="text-sm font-semibold text-zinc-700">
                Alumnos ({data.students.length})
              </h3>
              <Button size="sm" variant="outline" onClick={exportExcel}>
                <Download className="size-4" /> Exportar Excel
              </Button>
            </div>

            <div className="max-h-[40vh] overflow-y-auto rounded-md border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Matricula</th>
                    <th className="text-left font-medium px-3 py-2">Nombre</th>
                    <th className="text-center font-medium px-3 py-2">Asist.</th>
                    <th className="text-center font-medium px-3 py-2">Total</th>
                    <th className="text-center font-medium px-3 py-2">%</th>
                    <th className="text-center font-medium px-3 py-2">Sosp.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s: any) => (
                    <tr
                      key={s.studentId}
                      className="border-t hover:bg-zinc-50"
                    >
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {s.studentId}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {[s.studentGivenNames, s.studentPaternalSurname, s.studentMaternalSurname]
                          .filter(Boolean)
                          .join(' ')}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {s.attendanceCount}
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-zinc-500">
                        {s.totalSessions}
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        <span
                          className={`font-bold ${
                            s.percent >= 80
                              ? 'text-emerald-700'
                              : s.percent >= 50
                                ? 'text-amber-700'
                                : 'text-red-700'
                          }`}
                        >
                          {s.percent}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center text-xs">
                        {s.flaggedCount > 0 ? (
                          <span className="text-amber-700">
                            {s.flaggedCount}
                          </span>
                        ) : (
                          <span className="text-zinc-400">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-zinc-500">
            No se pudieron cargar las stats.
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose} variant="outline">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function QRDialog({
  session,
  onClose,
}: {
  session: SessionInfo
  onClose: () => void
}) {
  const origin =
    typeof window !== 'undefined' ? window.location.origin : ''
  const qrUrl = useMemo(() => `${origin}/?t=${session.token}`, [origin, session.token])

  const copyLink = () => {
    navigator.clipboard.writeText(qrUrl).then(
      () => toast.success('Enlace copiado'),
      () => toast.error('No se pudo copiar')
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5 text-emerald-600" />
            {session.name}
          </DialogTitle>
          <DialogDescription>
            Muestra este QR a tus alumnos. Caduca el{' '}
            {new Date(session.endsAt).toLocaleString('es-MX')}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid place-items-center bg-white p-4 rounded-lg border">
          <QRCodeSVG
            value={qrUrl}
            size={260}
            level="M"
            includeMargin
            bgColor="#ffffff"
            fgColor="#0a0a0a"
          />
        </div>

        <div className="grid gap-2">
          <Label className="text-[11px] text-zinc-500">Enlace directo</Label>
          <div className="flex gap-2">
            <Input readOnly value={qrUrl} className="text-xs font-mono" />
            <Button size="sm" variant="outline" onClick={copyLink}>
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose} className="bg-zinc-900 text-white">
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AttendanceDialog({
  session,
  trigger,
}: {
  session: SessionInfo
  trigger: React.ReactNode
}) {
  const { authedFetch } = useAuth()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<AttendanceRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authedFetch(`/api/sessions/${session.token}/attendance`)
      const data = await res.json()
      setList(data.attendances || [])
    } catch {
      toast.error('No se pudo cargar la lista')
    } finally {
      setLoading(false)
    }
  }, [session.token, authedFetch])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  const flagged = list.filter((a) => a.flagged).length
  const clean = list.length - flagged

  const deleteAttendance = async (id: string) => {
    try {
      const res = await authedFetch(`/api/attendance/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'No se pudo borrar')
      }
      await load()
      toast.success('Registro eliminado')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const exportCSV = () => {
    try {
      const rows = [
        ['matricula', 'nombres', 'apellido_paterno', 'apellido_materno', 'nombre_completo', 'fecha_hora', 'ip', 'device_fp', 'sospechoso', 'razon'],
        ...list.map((a) => [
          a.studentId,
          a.studentGivenNames,
          a.studentPaternalSurname,
          a.studentMaternalSurname ?? '',
          [a.studentGivenNames, a.studentPaternalSurname, a.studentMaternalSurname]
            .filter(Boolean)
            .join(' '),
          new Date(a.submittedAt).toISOString(),
          a.ip ?? '',
          a.deviceFp,
          a.flagged ? 'SI' : 'NO',
          a.flagReason ?? '',
        ]),
      ]
      const csv = rows
        .map((r) =>
          r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')
        )
        .join('\n')
      // BOM UTF-8 (\uFEFF) para que Excel reconozca acentos y ñ correctamente
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      // IMPORTANTE: el anchor DEBE estar en el DOM para que click() dispare la descarga
      // en algunos navegadores (Safari, algunas versiones de Chrome).
      // Si no está en el DOM, click() es un no-op silencioso.
      const a = document.createElement('a')
      a.href = url
      a.download = `asistencia_${session.name.replace(/\s+/g, '_')}.csv`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Limpieza del blob URL después de un pequeño delay (para que el navegador procese el click)
      setTimeout(() => URL.revokeObjectURL(url), 100)
      toast.success('CSV descargado')
    } catch (e) {
      toast.error('No se pudo generar el CSV: ' + (e as Error).message)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="size-5 text-emerald-600" />
            {session.name}
          </DialogTitle>
          <DialogDescription>
            Lista de asistencia registrada por QR.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-2 mb-2">
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
            <ShieldCheck className="size-3 mr-1" /> {clean} limpias
          </Badge>
          {flagged > 0 && (
            <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">
              <ShieldAlert className="size-3 mr-1" /> {flagged} sospechosas
            </Badge>
          )}
          <Badge className="bg-zinc-100 text-zinc-700 hover:bg-zinc-100">
            Total: {list.length}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={exportCSV}
            disabled={list.length === 0}
            className="ml-auto"
          >
            <Download className="size-4" /> CSV
          </Button>
        </div>

        {loading ? (
          <div className="grid place-items-center py-8">
            <Loader2 className="size-5 animate-spin text-zinc-400" />
          </div>
        ) : list.length === 0 ? (
          <div className="text-center py-10 text-sm text-zinc-500">
            Nadie ha registrado asistencia en esta sesion todavia.
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto rounded-md border border-zinc-200">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 sticky top-0">
                <tr>
                  <th className="text-left font-medium px-3 py-2">Matricula</th>
                  <th className="text-left font-medium px-3 py-2">Hora</th>
                  <th className="text-left font-medium px-3 py-2">IP</th>
                  <th className="text-left font-medium px-3 py-2">Estado</th>
                  <th className="text-right font-medium px-3 py-2">Accion</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-t ${
                      a.flagged
                        ? 'bg-amber-50'
                        : 'bg-white'
                    } hover:bg-zinc-50`}
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {a.studentId}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-600">
                      {new Date(a.submittedAt).toLocaleTimeString('es-MX', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500 font-mono">
                      {a.ip ?? '-'}
                    </td>
                    <td className="px-3 py-2">
                      {a.flagged ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                          <AlertTriangle className="size-3" />
                          {a.flagReason}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                          <CheckCircle2 className="size-3" /> OK
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 w-7 p-0"
                            title="Eliminar este registro"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              ¿Eliminar este registro?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Se borrara la asistencia de la matricula{' '}
                              <strong className="text-zinc-900 font-mono">
                                {a.studentId}
                              </strong>{' '}
                              registrada a las{' '}
                              {new Date(a.submittedAt).toLocaleTimeString('es-MX')}.
                              No se puede deshacer.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteAttendance(a.id)}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              <Trash2 className="size-4" /> Eliminar
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------- VISTA: ALUMNO --------------------------- */

function StudentAttendanceForm({ token }: { token: string }) {
  const [session, setSession] = useState<StudentSessionInfo | null>(null)
  const [loadingS, setLoadingS] = useState(true)
  // Campos de nombre y matricula (Fase 1)
  const [givenNames, setGivenNames] = useState('')
  const [paternalSurname, setPaternalSurname] = useState('')
  const [maternalSurname, setMaternalSurname] = useState('')
  const [studentId, setStudentId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<
    | { kind: 'ok'; message: string }
    | { kind: 'error'; message: string }
    | null
  >(null)

  // Regex visual para validar matricula AASSFNNNN en cliente
  const MATRICULA_RE = /^(0[8-9]|[1-9][0-9])[0-9]{2}[fF][0-9]{4}$/
  const isMatriculaValid = MATRICULA_RE.test(studentId)

  // Normaliza la matricula: quita espacios/guiones, convierte f min a F mayus
  const normalizeMatricula = (s: string): string => {
    let cleaned = s.toUpperCase().replace(/[\s-]/g, '')
    cleaned = cleaned.replace(/^([0-9]{4})f([0-9]{4})$/, '$1F$2')
    return cleaned
  }

  // Ref para acceder al valor actual de session dentro de loadSession
  // sin incluirlo como dependency (lo que causaria loop infinito).
  const sessionRef = useRef<StudentSessionInfo | null>(null)
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  // Cargar info de la sesion.
  // El flag `silent` evita mostrar el spinner en refrescos periodicos
  // (solo lo mostramos en la carga inicial). Sin esto, el formulario se
  // desmonta y el cursor salta al campo con autoFocus cada 30s.
  const loadSession = useCallback(async (silent = false) => {
    if (!silent) setLoadingS(true)
    try {
      const res = await fetch(`/api/sessions/${token}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        // Solo sobreescribir el result con error si la sesion realmente se cerro
        // o no existe. No queremos perder lo que el alumno ya escribio en el form
        // por un blip de red transitorio.
        if (res.status === 404) {
          setResult({ kind: 'error', message: err.error || 'Sesion no encontrada' })
          setSession(null)
        }
      } else {
        const data = await res.json()
        setSession(data.session)
        setResult(null)
      }
    } catch {
      // Error de red transitorio: no romper el form del alumno.
      // Solo mostrar error si nunca hemos cargado.
      if (!sessionRef.current) {
        setResult({ kind: 'error', message: 'No se pudo conectar con el servidor' })
      }
    } finally {
      if (!silent) setLoadingS(false)
    }
  }, [token])

  useEffect(() => {
    loadSession(false) // inicial: muestra spinner
    // Refresco cada 30s en modo silencioso (no monta/desmonta el form)
    const id = setInterval(() => loadSession(true), 30_000)
    return () => clearInterval(id)
  }, [loadSession])

  const submit = async () => {
    if (!givenNames.trim() || givenNames.trim().length < 2) {
      toast.error('Escribe tu(s) nombre(s) - minimo 2 caracteres')
      return
    }
    if (!paternalSurname.trim() || paternalSurname.trim().length < 2) {
      toast.error('Escribe tu apellido paterno - minimo 2 caracteres')
      return
    }
    if (!studentId.trim() || !isMatriculaValid) {
      toast.error('Matricula con formato invalido. Debe ser AASSFNNNN (ej: 1701F0021)')
      return
    }
    setSubmitting(true)
    setResult(null)
    try {
      // IMPORTANTE: ya NO enviamos deviceFp ni deviceUuid desde el cliente.
      // El servidor calcula la huella a partir de los headers HTTP (no forgeable
      // trivialmente) y setea una cookie HTTP-only firmada.
      const res = await fetch('/api/attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // para que el navegador envie/reciba cookies
        body: JSON.stringify({
          token,
          studentId: normalizeMatricula(studentId),
          studentGivenNames: givenNames.trim(),
          studentPaternalSurname: paternalSurname.trim(),
          studentMaternalSurname: maternalSurname.trim(),
        }),
      })
      // Intentar parsear JSON; si el servidor devuelve HTML, mostrar error claro
      let data: any = null
      try {
        data = await res.json()
      } catch {
        // El servidor devolvió HTML (probablemente un error 500 o página 404)
        if (!res.ok) {
          setResult({ kind: 'error', message: 'El servidor tuvo un problema. Intenta de nuevo o avisa a tu maestro.' })
          return
        }
      }
      if (!res.ok) {
        setResult({
          kind: 'error',
          message: data.error || 'No se pudo registrar la asistencia',
        })
        return
      }
      const full = data.attendance?.studentName || data.attendance?.studentId
      setResult({
        kind: 'ok',
        message: data.attendance?.flagged
          ? `Asistencia registrada para ${full}. AVISO: tu registro quedo marcado como sospechoso: ${data.attendance.flagReason}. Contacta a tu maestro.`
          : `Asistencia registrada para ${full}. Gracias!`,
      })
      setGivenNames('')
      setPaternalSurname('')
      setMaternalSurname('')
      setStudentId('')
    } catch (e) {
      // Si el servidor devuelve HTML (no JSON), res.json() falla y cae aquí.
      // Intentar leer el texto de la respuesta para dar un mejor mensaje.
      setResult({ kind: 'error', message: 'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (loadingS) {
    return (
      <div className="grid place-items-center min-h-[60vh]">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-md px-4 py-10">
        <Card>
          <CardContent className="py-10 text-center">
            <AlertTriangle className="size-10 text-amber-500 mx-auto mb-3" />
            <div className="text-sm font-medium text-zinc-800 mb-1">
              Sesion invalida
            </div>
            <div className="text-xs text-zinc-500">
              {result?.message || 'El QR no es valido o ya caduco.'}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  const now = new Date()
  const endsAt = new Date(session.endsAt)
  const remainingMs = Math.max(0, endsAt.getTime() - now.getTime())
  const remainingMin = Math.floor(remainingMs / 60_000)
  const remainingSec = Math.floor((remainingMs % 60_000) / 1000)

  return (
    <div className="mx-auto max-w-md px-4 py-8 w-full">
      <Card className="border-emerald-200">
        <CardHeader>
          <div className="flex items-center gap-2 mb-1">
            <div className="size-8 rounded-lg bg-emerald-600 text-white grid place-items-center">
              <QrCode className="size-4" />
            </div>
            <CardTitle className="text-base">Registro de asistencia</CardTitle>
          </div>
          <CardDescription className="text-base font-medium text-zinc-800">
            {session.name}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center gap-2 text-xs">
            {session.isWindowOpen ? (
              <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
                <Clock className="size-3 mr-1" /> Sesion abierta
              </Badge>
            ) : (
              <Badge className="bg-red-100 text-red-700 hover:bg-red-100">
                <Clock className="size-3 mr-1" /> Cerrada
              </Badge>
            )}
            <span className="text-zinc-500">
              Tiempo restante: {String(remainingMin).padStart(2, '0')}:
              {String(remainingSec).padStart(2, '0')}
            </span>
          </div>

          {session.isWindowOpen ? (
            <>
              {/* Nombre(s) - obligatorio */}
              <div className="grid gap-2">
                <Label htmlFor="given">
                  Nombre(s) <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="given"
                  placeholder="Ej. Juan Carlos"
                  value={givenNames}
                  autoCapitalize="words"
                  onChange={(e) => setGivenNames(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                  autoFocus
                />
              </div>

              {/* Apellido paterno (obligatorio) + Apellido materno (opcional) */}
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="pat">
                    Apellido paterno <span className="text-red-600">*</span>
                  </Label>
                  <Input
                    id="pat"
                    placeholder="Ej. Perez"
                    value={paternalSurname}
                    autoCapitalize="words"
                    onChange={(e) => setPaternalSurname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submit()
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mat" className="flex items-center gap-1">
                    Apellido materno{' '}
                    <span className="text-[10px] text-zinc-400 font-normal">
                      (opcional)
                    </span>
                  </Label>
                  <Input
                    id="mat"
                    placeholder="Ej. Lopez"
                    value={maternalSurname}
                    autoCapitalize="words"
                    onChange={(e) => setMaternalSurname(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submit()
                    }}
                  />
                </div>
              </div>

              {/* Matricula con regex visual */}
              <div className="grid gap-2">
                <Label htmlFor="matricula" className="flex items-center gap-1">
                  Matricula (numero de control){' '}
                  <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="matricula"
                  placeholder="Ej. 1701F0021"
                  value={studentId}
                  autoCapitalize="characters"
                  className={`font-mono ${
                    studentId.length > 0 && !isMatriculaValid
                      ? 'border-red-400 focus-visible:outline-red-200'
                      : isMatriculaValid
                        ? 'border-emerald-400'
                        : ''
                  }`}
                  onChange={(e) => setStudentId(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submit()
                  }}
                  maxLength={9}
                />
                <p className="text-[10px] text-zinc-500">
                  Formato: AASSFNNNN — AA = ano (08-99), SS = semestre, F =
                  letra F, NNNN = consecutivo.
                  {studentId.length > 0 && !isMatriculaValid && (
                    <span className="text-red-600 ml-1">Formato invalido</span>
                  )}
                  {isMatriculaValid && (
                    <span className="text-emerald-700 ml-1">✓ Formato valido</span>
                  )}
                </p>
              </div>
              <Button
                onClick={submit}
                disabled={
                  submitting ||
                  !givenNames.trim() ||
                  givenNames.trim().length < 2 ||
                  !paternalSurname.trim() ||
                  paternalSurname.trim().length < 2 ||
                  !isMatriculaValid
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white w-full"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Registrar asistencia
              </Button>
              <p className="text-[10px] text-zinc-400 text-center">
              </p>
            </>
          ) : (
            <div className="text-center py-4 text-sm text-zinc-600">
              {now < new Date(session.startsAt)
                ? 'La sesion aun no abre. Espera a que tu maestro inicie.'
                : 'La sesion ya cerro. Pide a tu maestro que reabra o genere un QR nuevo.'}
            </div>
          )}

          {result && (
            <div
              className={`rounded-md p-3 text-sm ${
                result.kind === 'ok'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              <div className="flex gap-2">
                {result.kind === 'ok' ? (
                  <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                )}
                <div>{result.message}</div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
