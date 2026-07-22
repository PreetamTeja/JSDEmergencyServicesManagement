import React, { useState, useRef, useEffect } from 'react'
import { useMap } from 'react-leaflet'

// Shared floating zoom + place-search controls, dropped into every Leaflet
// map in the app (admin Live Map/Emergencies/Fleet, user Portal, public
// Track). Zoom buttons drive the map instance directly via useMap() rather
// than react-leaflet's built-in <ZoomControl> so the styling/position stays
// consistent with the rest of the app's floating-card language instead of
// Leaflet's default top-left widget (which collides with the floating page
// headers already occupying that corner on most of these pages).
//
// Search uses OpenStreetMap's public Nominatim geocoder — free, no API key,
// same "no external dependency, real service" pattern already used for OSRM
// routing elsewhere in this app.
export default function MapControls({ className = 'top-3 right-3', align = 'items-end' }) {
  const map = useMap()
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef(null)
  const aliveRef = useRef(true)
  const boxRef = useRef(null)
  const posClass = className

  // The debounced fetch can resolve after this component has already
  // unmounted (map page navigated away from while a search was in flight) —
  // without this guard, setResults/setLoading fire on an unmounted
  // component (React warning, and a wasted render race). Also clears any
  // still-pending debounce timer so it can't fire post-unmount at all.
  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false; clearTimeout(debounceRef.current) }
  }, [])

  // Click anywhere outside the search box dismisses the results dropdown —
  // every other dropdown/menu in this app (RowMenu, CommandPalette, the
  // profile popover) already does this; this one was the odd one out and
  // could stay open floating over the map indefinitely.
  useEffect(() => {
    if (!results.length) return
    const onDocClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setResults([]) }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [results.length])

  async function search(text) {
    if (!text.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const bounds = map.getBounds()
      const viewbox = [bounds.getWest(), bounds.getNorth(), bounds.getEast(), bounds.getSouth()].join(',')
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&viewbox=${viewbox}&bounded=0&q=${encodeURIComponent(text)}`
      const res = await fetch(url, { headers: { Accept: 'application/json' } })
      const data = await res.json()
      if (!aliveRef.current) return
      setResults(Array.isArray(data) ? data : [])
    } catch {
      if (aliveRef.current) setResults([])
    } finally {
      if (aliveRef.current) setLoading(false)
    }
  }

  function onChange(e) {
    const v = e.target.value
    setQ(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(v), 400)
  }

  function pick(r) {
    map.flyTo([Number(r.lat), Number(r.lon)], 16, { duration: 0.8 })
    setResults([])
    setQ(r.display_name.split(',')[0])
  }

  return (
    // z-[1000]: this is rendered as a child of <MapContainer>, sharing a
    // stacking context with Leaflet's own internal panes (tilePane 200,
    // overlayPane 400, markerPane 600, tooltipPane 650, popupPane 700) — a
    // lower z-index here loses to any vehicle marker/tooltip that happens to
    // render near this corner, hiding the panel under map UI most of the
    // time and only flashing visible mid-zoom while markers reposition.
    <div className={`absolute z-[1000] flex flex-col ${align} gap-2 ${posClass}`}>
      {/* search */}
      <div className="w-56" ref={boxRef}>
        <div className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6B7280]" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
          <input value={q} onChange={onChange} placeholder="Search places…" aria-label="Search places on map"
            className="w-full pl-8 pr-2 py-1.5 rounded-xl text-[12.5px] text-[#0C1322]"
            style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', border: '1px solid rgba(0,0,0,0.06)' }} />
        </div>
        {(results.length > 0 || loading) && (
          <div className="mt-1 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.97)', boxShadow: '0 8px 24px rgba(0,0,0,0.14)', border: '1px solid rgba(0,0,0,0.06)' }}>
            {loading && <div className="px-3 py-2 text-[11.5px]" style={{ color: '#6B7280' }}>Searching…</div>}
            {!loading && results.map((r) => (
              <button key={r.place_id} onClick={() => pick(r)}
                className="w-full text-left px-3 py-2 text-[12px] transition-colors hover:bg-[rgba(7,81,77,0.06)]"
                style={{ color: '#0C1322', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                {r.display_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* zoom */}
      <div className="flex flex-col rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', boxShadow: '0 2px 12px rgba(0,0,0,0.12)', border: '1px solid rgba(0,0,0,0.06)' }}>
        <button onClick={() => map.zoomIn()} aria-label="Zoom in"
          className="h-8 w-8 grid place-items-center text-[15px] font-bold transition-colors hover:bg-[rgba(7,81,77,0.06)]"
          style={{ color: '#07514D', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>+</button>
        <button onClick={() => map.zoomOut()} aria-label="Zoom out"
          className="h-8 w-8 grid place-items-center text-[15px] font-bold transition-colors hover:bg-[rgba(7,81,77,0.06)]"
          style={{ color: '#07514D' }}>−</button>
      </div>
    </div>
  )
}
