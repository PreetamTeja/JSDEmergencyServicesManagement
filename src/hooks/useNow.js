import { useEffect, useState } from 'react'

// Re-renders the consumer every `intervalMs` so time-based UI (SLA countdowns,
// "x min ago") stays current without a manual refresh.
export function useNow(intervalMs = 15000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
