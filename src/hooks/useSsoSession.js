import { useEffect, useState } from 'react'

// Reads the Worker-issued session via /api/me. The session cookie itself is
// HttpOnly, so this is the only way the app can learn who's signed in.
export function useSsoSession() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/me', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        setSession(data && data.authed ? data : null)
      })
      .catch(() => { if (!cancelled) setSession(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { session, loading }
}
