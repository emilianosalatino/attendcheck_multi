'use client'

import { useState, useEffect, useCallback } from 'react'

/**
 * Hook de autenticacion multi-usuario.
 * Reemplaza a useTeacherAuth. Usa cookies JWT HTTP-only (no sessionStorage).
 *
 * - On mount, llama a GET /api/auth/me para ver si ya hay sesion activa.
 * - login(username, password) → POST /api/auth/login → setea cookie JWT
 * - logout() → POST /api/auth/logout → limpia cookie
 * - authedFetch(url, init) → fetch con credentials: 'include' (cookie automatico)
 *
 * El identificador de login es un NOMBRE DE USUARIO (no email). El campo se
 * llama `username` en todo el sistema desde v12.
 */

export type AuthUser = {
  userId: string
  username: string
  role: 'ADMIN' | 'TEACHER'
  name: string
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  // Al montar, verificar si ya hay sesion
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user)
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (username: string, password: string): Promise<boolean> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    })
    if (!res.ok) return false
    const data = await res.json()
    if (data?.user) {
      setUser(data.user)
      return true
    }
    return false
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    setUser(null)
  }, [])

  /**
   * Fetch con cookies. El JWT cookie se envia automaticamente.
   */
  const authedFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers)
      if (init.body && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json')
      }
      const res = await fetch(url, {
        ...init,
        headers,
        credentials: 'include', // siempre enviar cookies
      })
      if (res.status === 401) {
        setUser(null)
      }
      return res
    },
    []
  )

  return { user, ready, login, logout, authedFetch }
}
