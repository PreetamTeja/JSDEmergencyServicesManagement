// Jamshedpur is IST (UTC+5:30) — every "today"/"yesterday" boundary in this
// app (Dashboard KPIs, Dispatch Board KPIs, the 14-day trend chart) needs to
// mean the IST calendar day a dispatcher actually sees on their wall clock,
// not the UTC day. `new Date().toISOString().slice(0,10)` computes the UTC
// day, which is wrong for any dispatch between 00:00–05:29 IST — those
// dispatches got silently counted under "yesterday" (still UTC's yesterday
// at that point) instead of today, and the reverse at 05:30 UTC (11:00 IST
// boundary doesn't exist, but the *midnight* boundary is the one that's off
// by the full 5.5h gap). Shift the epoch by the IST offset before taking a
// UTC date slice — the standard trick for "get the calendar date in another
// timezone" without a timezone-aware date library.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export function istDateKey(d = new Date()) {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}
