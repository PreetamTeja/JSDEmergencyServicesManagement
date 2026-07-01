import React, { useEffect, useRef, useState } from 'react'
import { getToken } from '../auth'
import { useFleetStore } from '../store/useFleetStore'
import { locById } from '../data/locations'
import { hospitalById } from '../data/hospitals'
import LiveEta from '../components/common/LiveEta'

const VOICE_URL = import.meta.env.VITE_VOICE_URL || ''
const SR = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null
// strip any <thinking>…</thinking> / stray tags the model may emit
const clean = (t) => String(t || '').replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').replace(/<\/?[a-z_]+>/gi, '').trim()
// A booking is confirmed if the server returned a booked object with pickup_id set.
// booked is null for all question/pending states; only dispatch responses include pickup_id.
const bookedOk = (b) => b != null && b.pickup_id != null

// Phone-style voice agent: Call -> "Connecting…" -> live call UI with a timer that
// auto-listens. Browser STT/TTS; AWS (Bedrock Lambda) books via /emergencies.
// End call finalizes the dispatch if nothing was booked yet.
export default function VoiceAgent({ session, onClose }) {
  const refresh = useFleetStore((s) => s.refreshFromApi)
  const hydrate = useFleetStore((s) => s.hydrateLive)
  const emergencies = useFleetStore((s) => s.emergencies)
  const vehicles = useFleetStore((s) => s.vehicles)

  const [phase, setPhase] = useState('connecting') // connecting | incall
  const [messages, setMessages] = useState([])
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [booked, setBooked] = useState(null)
  const [pending, setPending] = useState(null) // awaiting caller approval before dispatch
  const [ending, setEnding] = useState(false)
  const [ended, setEnded] = useState(false)

  const recRef = useRef(null)
  const speakingRef = useRef(false)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  const endingRef = useRef(false)
  const pendingRef = useRef(null)
  const msgsRef = useRef([])
  const endRef = useRef(null)
  useEffect(() => { msgsRef.current = messages }, [messages])
  useEffect(() => { busyRef.current = busy }, [busy])
  useEffect(() => { endingRef.current = ending }, [ending])
  useEffect(() => { pendingRef.current = pending }, [pending])

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  function speak(text, thenListen = true) {
    try {
      speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text); u.rate = 1.05
      speakingRef.current = true; setSpeaking(true)
      const done = () => { speakingRef.current = false; setSpeaking(false); if (thenListen) startListening() }
      u.onend = done; u.onerror = done
      speechSynthesis.speak(u)
    } catch { speakingRef.current = false; setSpeaking(false); if (thenListen) startListening() }
  }

  function startListening() {
    if (!SR || !aliveRef.current || busyRef.current || speakingRef.current || endingRef.current) return
    if (recRef.current) return
    const rec = new SR()
    rec.lang = 'en-IN'; rec.continuous = true; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e) => { const r = e.results[e.results.length - 1]; if (r && r.isFinal) submitUtterance(r[0].transcript) }
    rec.onend = () => { recRef.current = null; setListening(false); if (aliveRef.current && !busyRef.current && !speakingRef.current && !endingRef.current) setTimeout(startListening, 300) }
    rec.onerror = () => { recRef.current = null; setListening(false) }
    recRef.current = rec
    try { rec.start(); setListening(true) } catch { recRef.current = null }
  }
  function stopListening() { const r = recRef.current; recRef.current = null; if (r) { try { r.stop() } catch {} } setListening(false) }

  // Send the conversation to the AWS agent; returns the parsed reply (or null).
  // silent = don't add an assistant text bubble (used on dispatch — the card shows instead).
  async function ask(history, finalize = false, silent = false, confirmed = false, slots = null) {
    setBusy(true); busyRef.current = true; stopListening()
    try {
      const bearer = getToken()
      const r = await fetch(VOICE_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
        body: JSON.stringify({ messages: history, requestedBy: session?.sub || session?.name, finalize, confirmed, slots }),
      })
      const data = await r.json()
      if (!aliveRef.current) return null
      data.reply = clean(data.reply)
      const isBooked = bookedOk(data.booked)
      if (!silent && !isBooked) setMessages((m) => [...m, { role: 'assistant', text: data.reply }])
      if (isBooked) { setBooked(data.booked); setPending(null); pendingRef.current = null; await refresh(); hydrate().catch(() => {}) }
      else { setPending(data.pending || null); pendingRef.current = data.pending || null }
      return data
    } catch {
      if (!aliveRef.current) return null
      const msg = 'Sorry, the voice line is unavailable right now.'
      setMessages((m) => [...m, { role: 'assistant', text: msg }])
      return { reply: msg, error: true }
    } finally { setBusy(false); busyRef.current = false }
  }

  const isYes = (t) => /\b(yes|yeah|yep|yup|sure|correct|confirm|confirmed|go ahead|do it|dispatch|okay|ok|please do|that'?s right|right)\b/i.test(t)
  const isNo = (t) => /\b(no|nope|nah|cancel|wrong|change|not right|incorrect|don'?t)\b/i.test(t)

  function submitUtterance(text) {
    if (!text.trim() || busyRef.current) return
    // When awaiting approval, interpret the spoken answer as yes/no.
    if (pendingRef.current) {
      if (isYes(text) && !isNo(text)) { setMessages((m) => [...m, { role: 'user', text }]); confirmDispatch(); return }
      if (isNo(text)) { setMessages((m) => [...m, { role: 'user', text }]); declinePending(); return }
      // otherwise treat as a correction -> fall through and re-extract
    }
    const next = [...msgsRef.current, { role: 'user', text }]
    setMessages(next)
    ask(next).then((d) => { if (d) speak(d.reply, true) }) // ask for missing / re-confirm; keep listening
  }

  // Caller approved -> dispatch the slots we already collected (no re-extraction → no loop).
  function confirmDispatch() {
    const slots = pendingRef.current
    console.log('[voice] confirmDispatch slots=', slots)
    const next = [...msgsRef.current]
    ask(next, false, true, true, slots).then((d) => {
      if (!d) return
      console.log('[voice] confirmDispatch response=', d)
      if (bookedOk(d.booked)) { setEnded(true); endingRef.current = true; speak(d.reply, false) }
      else speak(d.reply, true)
    })
  }
  // Caller declined -> drop the pending dispatch and keep listening for changes.
  function declinePending() {
    setPending(null); pendingRef.current = null
    speak('Okay, what would you like to change?', true)
  }

  // open the call (greeting) — guard so StrictMode's double effect doesn't greet twice
  const greetedRef = useRef(false)
  useEffect(() => {
    aliveRef.current = true
    if (VOICE_URL && !greetedRef.current) {
      greetedRef.current = true
      ask([]).then((d) => { if (d) { setPhase('incall'); startListening() } })
    }
    return () => { aliveRef.current = false; stopListening(); speechSynthesis.cancel() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { if (phase !== 'incall') return; const id = setInterval(() => setSeconds((s) => s + 1), 1000); return () => clearInterval(id) }, [phase])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, booked])

  // Hang up: if there's a pending confirmed dispatch, submit it first; otherwise close.
  function endCall() {
    if (pendingRef.current) { confirmDispatch(); return }
    close()
  }
  function close() { aliveRef.current = false; stopListening(); speechSynthesis.cancel(); onClose() }

  // dispatch card data (live)
  const em = booked ? emergencies.find((e) => e.id === booked.id) : null
  const isFire = (booked?.kind === 'fire') || (em?.kind === 'fire')
  const reg = vehicles.find((v) => v.id === (booked?.assigned_vehicle_id || em?.ambulanceId))?.reg
  const dest = isFire ? (locById(booked?.pickup_id || em?.pickup)?.name) : (booked?.hospital || hospitalById(booked?.hospital_id || em?.hospitalId)?.name)
  const isMass = !!(booked?.incident_id || booked?.mass)
  const massPlace = locById(booked?.pickup_id)?.name
  const dispatched = bookedOk(booked)

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 grid place-items-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-card overflow-hidden flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="bg-accent text-white px-5 py-5 flex flex-col items-center gap-1">
          <div className={`h-20 w-20 rounded-full bg-[#cfd8dc] grid place-items-center mb-2 overflow-hidden ${phase === 'incall' && (listening || busy) ? 'ring-4 ring-white/30' : ''}`}>
            <svg viewBox="0 0 24 24" className="h-20 w-20 text-[#eceff1]" fill="currentColor"><path d="M12 12.6c2.3 0 4.1-1.9 4.1-4.3S14.3 4 12 4 7.9 5.9 7.9 8.3 9.7 12.6 12 12.6zm0 2c-3 0-8 1.6-8 4.7V21h16v-1.7c0-3.1-5-4.7-8-4.7z"/></svg>
          </div>
          <div className="font-semibold text-[17px]">Emergency Services</div>
          {phase === 'connecting'
            ? <div className="text-[13px] text-white/80">Connecting…</div>
            : <div className="text-[13px] text-white/90 tabular-nums">{fmt(seconds)}</div>}
          {phase === 'incall' && <div className="text-[11px] text-white/70">{ending ? 'Dispatching…' : ended ? 'Call ended' : busy ? 'Processing…' : speaking ? 'Speaking…' : pending ? 'Awaiting your approval' : '● Listening'}</div>}
        </div>

        {!VOICE_URL ? (
          <div className="p-6 text-sm text-status-danger">Voice service not configured (VITE_VOICE_URL missing).</div>
        ) : (
          <>
            <div className="flex-1 overflow-auto p-4 space-y-2 min-h-[140px]">
              {phase === 'connecting' && (
                <div className="h-full grid place-items-center text-cmd-muted text-sm">
                  <span className="flex items-center gap-2"><span className="h-4 w-4 rounded-full border-2 border-accent border-t-transparent animate-spin" /> Connecting…</span>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`max-w-[85%] px-3 py-2 rounded-2xl text-[14px] ${m.role === 'user' ? 'ml-auto bg-accent text-white' : 'bg-cmd-panel2 text-cmd-text'}`}>{m.text}</div>
              ))}

              {/* dispatch confirmation card */}
              {dispatched && isMass && (
                <div className="rounded-xl border-2 p-3 text-[13px]" style={{ borderColor: '#dc2626', background: '#fef2f2' }}>
                  <div className="font-semibold flex items-center gap-1.5" style={{ color: '#dc2626' }}>✓ Mass casualty response</div>
                  <div className="mt-1 text-cmd-text">{booked.dispatched ?? booked.units} ambulance{(booked.dispatched ?? booked.units) > 1 ? 's' : ''} dispatched</div>
                  {booked.patients && <div className="text-cmd-muted">{booked.patients} people affected</div>}
                  {massPlace && <div className="text-cmd-muted">To {massPlace}</div>}
                </div>
              )}
              {dispatched && !isMass && (() => {
                const st = em?.state || booked?.status
                const isEnRoute = st === 'EN_ROUTE'
                const isQueued = ['QUEUED', 'NO_HOSPITAL', 'NO_BLOODBANK'].includes(st)
                const color = isEnRoute ? (isFire ? '#ea580c' : '#16a34a') : '#b45309'
                const bg = isEnRoute ? (isFire ? '#fff7ed' : '#f0fdf4') : '#fffbeb'
                const label = isEnRoute
                  ? (isFire ? 'Fire truck dispatched' : 'Ambulance dispatched')
                  : isQueued ? 'Request queued — waiting for unit' : 'Request submitted'
                return (
                  <div className="rounded-xl border-2 p-3 text-[13px]" style={{ borderColor: color, background: bg }}>
                    <div className="font-semibold flex items-center gap-1.5" style={{ color }}>✓ {label}</div>
                    {booked.id && <div className="mt-1 text-cmd-text">{booked.id}{reg ? ` · Unit ${reg}` : ''}</div>}
                    {dest && isEnRoute && <div className="text-cmd-muted">{isFire ? 'To incident' : 'To'} {dest}</div>}
                    {isEnRoute && em?.state === 'EN_ROUTE' && <div className="mt-0.5">ETA <LiveEta etaComplete={em.etaComplete} fallbackMin={em.etaToPickupMin} className="font-semibold text-accent" /></div>}
                  </div>
                )
              })()}
              {ended && !dispatched && (
                <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-[13px] text-status-danger">
                  Couldn't dispatch automatically — please use the request form.
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="p-4 border-t border-cmd-border flex items-center justify-center gap-4">
              {(dispatched || ended)
                ? <button onClick={close} className="btn-primary px-6">Close</button>
                : pending
                  ? (
                    <>
                      <button onClick={() => { setMessages((m) => [...m, { role: 'user', text: 'No' }]); declinePending() }} disabled={busy}
                        className="px-5 h-11 rounded-lg border border-cmd-border bg-white text-cmd-text font-medium disabled:opacity-50">✕ No, change</button>
                      <button onClick={() => confirmDispatch()} disabled={busy}
                        className="px-5 h-11 rounded-lg bg-status-enroute text-white font-semibold disabled:opacity-50" style={{ background: '#16a34a' }}>✓ Approve & dispatch</button>
                    </>
                  )
                  : (
                    <>
                      <div className="flex flex-col items-center gap-1">
                        <button onClick={() => (listening ? stopListening() : startListening())} disabled={busy || speaking || ending || !SR}
                          className={`h-14 w-14 rounded-full grid place-items-center text-white ${listening ? 'bg-accent' : 'bg-cmd-muted/60'} disabled:opacity-40`}
                          title={listening ? 'Mute mic' : 'Unmute mic'}>
                          {listening
                            ? <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2z"/></svg>
                            : <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor"><path d="M19 11h-1.7a5 5 0 0 1-.9 2.6l1.2 1.2A6.9 6.9 0 0 0 19 11zM3.3 3 2 4.3l6 6V11a3 3 0 0 0 4.4 2.6l1.5 1.5A4.9 4.9 0 0 1 12 16a5 5 0 0 1-5-5H5a7 7 0 0 0 6 6.9V21h2v-3.1a6.9 6.9 0 0 0 2.3-.8l3.4 3.4 1.3-1.3L3.3 3zM15 9.2V5a3 3 0 0 0-5.7-1.3L15 9.2z"/></svg>}
                        </button>
                        <span className="text-[10px] text-cmd-muted">{listening ? 'Mute' : 'Unmute'}</span>
                      </div>
                      <div className="flex flex-col items-center gap-1">
                        <button onClick={endCall} className="h-14 w-14 rounded-full grid place-items-center bg-red-600 text-white" title="Hang up">
                          <svg viewBox="0 0 24 24" className="h-6 w-6 rotate-[135deg]" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.4.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1l-2.3 2.2z"/></svg>
                        </button>
                        <span className="text-[10px] text-cmd-muted">Hang up</span>
                      </div>
                    </>
                  )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
