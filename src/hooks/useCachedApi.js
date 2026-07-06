import { useEffect, useState } from 'react'

// Stale-while-revalidate for one-off analytics fetches: render whatever's in
// localStorage instantly (no loading flash on repeat visits), then refetch
// in the background and swap in fresh data when it arrives. Built for the
// historical-insights endpoints specifically — their underlying data is a
// static seeded dataset that essentially never changes between deploys, so
// showing a few-seconds-stale cached copy while revalidating is free.
function readCache(key) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw).d ?? null
  } catch {
    return null
  }
}
function writeCache(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d: data })) } catch {}
}

// Fire-and-forget warm-up, callable outside a component (e.g. once at app
// boot) — populates the same cache slot useCachedApi reads from, so by the
// time the user actually navigates to the page that calls useCachedApi(key),
// the fetch may already be sitting in localStorage instead of starting cold.
export function prefetchCachedApi(key, fetcher) {
  fetcher().then((d) => writeCache(key, d)).catch(() => {})
}

export function useCachedApi(key, fetcher) {
  const [data, setData] = useState(() => readCache(key))
  const [refreshing, setRefreshing] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    fetcher()
      .then((d) => {
        if (cancelled) return
        setData(d)
        setErr(null)
        setRefreshing(false)
        writeCache(key, d)
      })
      .catch((e) => {
        if (cancelled) return
        setRefreshing(false)
        // Only surface the error if we have nothing cached to fall back on —
        // a background refresh failure shouldn't blank out a working view.
        if (!readCache(key)) setErr(e.message)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { data, loading: refreshing && !data, refreshing: refreshing && !!data, err }
}
