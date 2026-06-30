/* =====================================================================
   Generates the three project PDFs (clean cover + index + sections +
   master architecture diagram + per-flow diagrams):
     1) Architecture-Flow.pdf
     2) System-Design.pdf
     3) DB-Schema.pdf
   Run:  node infra/docs/generate-docs.mjs   ->  writes to ./docs/
   ===================================================================== */
import PDFDocument from 'pdfkit'
import fs from 'fs'
import path from 'path'

const OUT_DIR = path.resolve('docs')
fs.mkdirSync(OUT_DIR, { recursive: true })

const BRAND = 'JSD TATA Emergency Services'
const DATED = '25 June 2026'
const ACCENT = '#07514D', ACCENT2 = '#2E8B84', INK = '#0f172a', MUTED = '#64748b'
const LINE = '#cbd5e1', SOFT = '#eef2f1', BLUE = '#2563eb', ORANGE = '#ea580c', RED = '#dc2626'
const M = { top: 74, bottom: 66, left: 56, right: 56 }
const PW = 595.28, PH = 841.89
const CW = PW - M.left - M.right
const BOTTOM = PH - M.bottom

class Doc {
  constructor(title, subtitle, kicker) {
    this.title = title; this.subtitle = subtitle; this.kicker = kicker
    this.doc = new PDFDocument({ size: 'A4', margins: M, bufferPages: true, autoFirstPage: false })
    this.toc = []
    this.doc.addPage()      // cover (page 1)
    this._cover()
    this.doc.addPage()      // TOC (page 2)
    this.tocPage = this._idx()
    this.doc.addPage()      // content start (page 3)
  }
  _idx() { const r = this.doc.bufferedPageRange(); return r.start + r.count - 1 }
  _pageNo() { return this.doc.bufferedPageRange().count }
  ensure(h) { if (this.doc.y + h > BOTTOM) this.doc.addPage() }

  _cover() {
    const d = this.doc
    d.save()
    d.rect(0, 0, PW, 210).fill(ACCENT)
    d.rect(0, 210, PW, 6).fill(ACCENT2)
    d.fillColor('#ffffff').font('Helvetica-Bold').fontSize(11)
    d.text(BRAND.toUpperCase(), M.left, 70, { characterSpacing: 1.5 })
    d.fontSize(30).text(this.title, M.left, 110, { width: CW })
    if (this.subtitle) d.font('Helvetica').fontSize(13).fillColor('#d8e6e4').text(this.subtitle, M.left, 160, { width: CW })
    d.restore()
    d.fillColor(MUTED).font('Helvetica').fontSize(10)
    d.text(this.kicker || '', M.left, 250, { width: CW })
    // meta block
    const my = 700
    d.moveTo(M.left, my).lineTo(PW - M.right, my).strokeColor(LINE).stroke()
    d.fillColor(INK).font('Helvetica-Bold').fontSize(10).text('Document', M.left, my + 14)
    d.font('Helvetica').fillColor(MUTED).text(this.title, M.left + 90, my + 14)
    d.font('Helvetica-Bold').fillColor(INK).text('Date', M.left, my + 32)
    d.font('Helvetica').fillColor(MUTED).text(DATED, M.left + 90, my + 32)
    d.font('Helvetica-Bold').fillColor(INK).text('Audience', M.left, my + 50)
    d.font('Helvetica').fillColor(MUTED).text('Executive summary + engineering detail (layered)', M.left + 90, my + 50)
    d.font('Helvetica-Bold').fillColor(INK).text('Status', M.left, my + 68)
    d.font('Helvetica').fillColor(MUTED).text('Confidential — internal', M.left + 90, my + 68)
  }

  h1(text) {
    this.ensure(70)
    if (this.doc.y > M.top + 4) this.doc.moveDown(0.8)
    const y = this.doc.y
    this.doc.save().rect(M.left, y, 4, 18).fill(ACCENT).restore()
    this.doc.fillColor(INK).font('Helvetica-Bold').fontSize(17).text(text, M.left + 12, y - 1, { width: CW - 12 })
    this.toc.push({ level: 1, text, page: this._pageNo() })
    this.doc.moveDown(0.4)
    this.doc.fillColor(INK)
  }
  h2(text) {
    this.ensure(44)
    this.doc.moveDown(0.5)
    this.doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(12.5).text(text, M.left, this.doc.y, { width: CW })
    this.toc.push({ level: 2, text, page: this._pageNo() })
    this.doc.moveDown(0.25)
    this.doc.fillColor(INK)
  }
  p(text) {
    this.doc.font('Helvetica').fontSize(10).fillColor('#1e293b')
    this.doc.text(text, M.left, this.doc.y, { width: CW, align: 'left', lineGap: 2.5 })
    this.doc.moveDown(0.5)
  }
  small(text) {
    this.doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED)
    this.doc.text(text, M.left, this.doc.y, { width: CW, lineGap: 2 })
    this.doc.moveDown(0.4); this.doc.fillColor(INK)
  }
  bullets(items) {
    this.doc.font('Helvetica').fontSize(10).fillColor('#1e293b')
    for (const it of items) {
      this.ensure(16)
      const y = this.doc.y
      this.doc.save().circle(M.left + 3, y + 5, 1.7).fill(ACCENT2).restore()
      this.doc.text(it, M.left + 14, y, { width: CW - 14, lineGap: 2 })
      this.doc.moveDown(0.25)
    }
    this.doc.moveDown(0.35)
  }
  note(text) {
    this.doc.font('Helvetica').fontSize(9.5)
    const h = this.doc.heightOfString(text, { width: CW - 24, lineGap: 2 }) + 16
    this.ensure(h)
    const y = this.doc.y
    this.doc.save().rect(M.left, y, CW, h).fill(SOFT).rect(M.left, y, 3, h).fill(ACCENT).restore()
    this.doc.fillColor('#234').text(text, M.left + 14, y + 8, { width: CW - 24, lineGap: 2 })
    this.doc.y = y + h + 8; this.doc.fillColor(INK)
  }
  // simple table: headers[], rows[][]
  table(headers, rows, widths) {
    const tw = CW
    const cols = widths || headers.map(() => tw / headers.length)
    const rowH = (cells, bold) => {
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
      let h = 0
      cells.forEach((c, i) => { h = Math.max(h, this.doc.heightOfString(String(c), { width: cols[i] - 12, lineGap: 1.5 })) })
      return h + 10
    }
    const drawRow = (cells, bold, fill) => {
      const h = rowH(cells, bold)
      this.ensure(h)
      const y = this.doc.y
      if (fill) this.doc.save().rect(M.left, y, tw, h).fill(fill).restore()
      let x = M.left
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(bold ? '#ffffff' : '#1e293b')
      cells.forEach((c, i) => { this.doc.text(String(c), x + 6, y + 5, { width: cols[i] - 12, lineGap: 1.5 }); x += cols[i] })
      this.doc.save().strokeColor(LINE).lineWidth(0.5).moveTo(M.left, y + h).lineTo(M.left + tw, y + h).stroke().restore()
      this.doc.y = y + h
    }
    drawRow(headers, true, ACCENT)
    rows.forEach((r, i) => drawRow(r, false, i % 2 ? '#f8fafc' : null))
    this.doc.moveDown(0.6); this.doc.fillColor(INK)
  }
  code(lines) {
    const txt = Array.isArray(lines) ? lines.join('\n') : lines
    this.doc.font('Courier').fontSize(8.5)
    const h = this.doc.heightOfString(txt, { width: CW - 20, lineGap: 1.5 }) + 14
    this.ensure(h)
    const y = this.doc.y
    this.doc.save().rect(M.left, y, CW, h).fill('#0f172a').restore()
    this.doc.fillColor('#e2e8f0').text(txt, M.left + 10, y + 7, { width: CW - 20, lineGap: 1.5 })
    this.doc.y = y + h + 8; this.doc.fillColor(INK)
  }

  // ---- diagram primitives ----
  box(x, y, w, h, label, sub, opt = {}) {
    const d = this.doc
    d.save()
    d.roundedRect(x, y, w, h, 5).lineWidth(1).fillAndStroke(opt.fill || '#ffffff', opt.stroke || LINE)
    d.fillColor(opt.color || INK).font('Helvetica-Bold').fontSize(opt.fs || 8.5)
    d.text(label, x + 5, y + (sub ? 7 : (h - 10) / 2), { width: w - 10, align: 'center' })
    if (sub) { d.font('Helvetica').fontSize(7).fillColor(opt.subColor || MUTED).text(sub, x + 5, y + 21, { width: w - 10, align: 'center' }) }
    d.restore()
  }
  vArrow(x, y1, y2) {
    const d = this.doc; d.save().strokeColor('#94a3b8').lineWidth(1)
    d.moveTo(x, y1).lineTo(x, y2).stroke()
    d.moveTo(x - 3, y2 - 4).lineTo(x, y2).lineTo(x + 3, y2 - 4).stroke().restore()
  }
}

/* ---------- footers + TOC fill (run last) ---------- */
function finalize(D, fileTitle) {
  const d = D.doc
  // Fill the TOC page
  d.switchToPage(D.tocPage)
  d.fillColor(INK).font('Helvetica-Bold').fontSize(17).text('Contents', M.left, M.top)
  d.moveTo(M.left, M.top + 26).lineTo(PW - M.right, M.top + 26).strokeColor(LINE).stroke()
  let y = M.top + 40
  for (const e of D.toc) {
    const indent = e.level === 2 ? 16 : 0
    d.font(e.level === 1 ? 'Helvetica-Bold' : 'Helvetica').fontSize(e.level === 1 ? 10.5 : 9.5)
    d.fillColor(e.level === 1 ? INK : '#334155')
    const label = e.text
    const num = String(e.page)
    const numW = d.widthOfString(num)
    const labelX = M.left + indent
    const labelW = CW - indent - numW - 10
    d.text(label, labelX, y, { width: labelW, lineBreak: false, ellipsis: true })
    // leader dots
    const lw = d.widthOfString(label.length > 60 ? label.slice(0, 60) : label)
    const dotsStart = labelX + Math.min(lw, labelW) + 4
    const dotsEnd = PW - M.right - numW - 4
    if (dotsEnd > dotsStart) {
      d.save().fillColor('#cbd5e1').fontSize(9)
      let dx = dotsStart; let dots = ''
      while (dx < dotsEnd) { dots += '.'; dx += d.widthOfString('.') }
      d.text(dots, dotsStart, y + (e.level === 1 ? 1 : 0.5), { lineBreak: false }); d.restore()
    }
    d.fillColor(e.level === 1 ? INK : '#334155').text(num, PW - M.right - numW, y, { lineBreak: false })
    y += e.level === 1 ? 19 : 16
    if (y > BOTTOM - 20) { /* TOC overflow guard: stop */ break }
  }
  // Footers on every page except the cover
  const range = d.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    d.switchToPage(i)
    if (i === range.start) continue // cover
    d.save()
    d.font('Helvetica').fontSize(8).fillColor('#94a3b8')
    d.text(BRAND + '  ·  ' + fileTitle, M.left, PH - 44, { width: CW - 60, lineBreak: false })
    d.text('Page ' + (i + 1), PW - M.right - 60, PH - 44, { width: 60, align: 'right' })
    d.moveTo(M.left, PH - 50).lineTo(PW - M.right, PH - 50).strokeColor('#e2e8f0').lineWidth(0.5).stroke()
    d.restore()
  }
}

function save(D, name) {
  finalize(D, name)   // fill the TOC page + draw footers before flushing
  const file = path.join(OUT_DIR, name)
  const stream = fs.createWriteStream(file)
  D.doc.pipe(stream)
  D.doc.end()
  return new Promise((res) => stream.on('finish', () => { console.log('wrote', file); res() }))
}

/* ===================================================================
   MASTER ARCHITECTURE DIAGRAM (used in Architecture + System Design)
   =================================================================== */
function architectureDiagram(D) {
  const d = D.doc
  d.addPage()
  d.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('Master architecture', M.left, M.top)
  d.font('Helvetica').fontSize(9).fillColor(MUTED).text('All services and how requests flow from clients to data and external systems.', M.left, M.top + 18, { width: CW })
  let y = M.top + 44
  const cx = M.left + CW / 2
  const band = (label, boxes, h = 52) => {
    d.save().font('Helvetica-Bold').fontSize(7.5).fillColor('#94a3b8')
    d.text(label.toUpperCase(), M.left, y - 11, { characterSpacing: 1 }); d.restore()
    const n = boxes.length, gap = 12
    const bw = (CW - gap * (n - 1)) / n
    boxes.forEach((b, i) => { D.box(M.left + i * (bw + gap), y, bw, h, b.t, b.s, b.o || {}) })
    const bottom = y + h
    y = bottom + 30
    return bottom
  }
  const arrowDown = (fromY) => D.vArrow(cx, fromY, fromY + 30)

  let b
  b = band('Clients', [
    { t: 'Hospital / Blood Bank', s: 'system → API key', o: { fill: '#eef6ff', stroke: '#bcd6f5', color: BLUE } },
    { t: 'Citizens & Staff', s: 'Web portal → SSO', o: { fill: '#eefaf3', stroke: '#bfe6cf', color: '#16a34a' } },
    { t: 'Dispatchers', s: 'Console → SSO (admin)', o: { fill: '#fff4ec', stroke: '#f6d2b8', color: ORANGE } },
  ]); arrowDown(b)
  b = band('Edge / Delivery', [
    { t: 'Amazon CloudFront', s: 'CDN (HTTPS, OAC)' },
    { t: 'Amazon S3', s: 'React SPA (static)' },
  ]); arrowDown(b)
  b = band('Identity', [
    { t: 'Amazon Cognito', s: 'SSO JWT (RS256)', o: { fill: '#f3f0ff', stroke: '#d6cdf5', color: '#6d28d9' } },
    { t: 'Scoped API keys', s: 'server-to-server', o: { fill: '#f3f0ff', stroke: '#d6cdf5', color: '#6d28d9' } },
  ]); arrowDown(b)
  b = band('API', [
    { t: 'API Gateway (HTTP API)', s: 'proxy · throttled 10 rps / burst 20', o: { fill: SOFT, stroke: '#bcd', color: ACCENT } },
  ]); arrowDown(b)
  b = band('Compute', [
    { t: 'Lambda: psiog-transport-api', s: 'dispatch · auth · ETA · tracking · notify', o: { fill: '#e9f3f2', stroke: ACCENT2, color: ACCENT } },
    { t: 'Lambda: psiog-policy-sync', s: 'policy PDF → config', o: { fill: '#e9f3f2', stroke: ACCENT2, color: ACCENT } },
  ]); arrowDown(b)
  b = band('Data (DynamoDB)', [
    { t: 'ReferenceData', s: 'LOC/ZONE/HOSP/FIRE/POLICY' },
    { t: 'Fleet', s: 'vehicles/drivers' },
    { t: 'TransportRequests', s: 'EMG/REQ/BK' },
    { t: 'ShuttleCards', s: 'cards/rides' },
  ], 46)
  // external band (no down-arrow; side services)
  d.save().font('Helvetica-Bold').fontSize(7.5).fillColor('#94a3b8').text('EXTERNAL / AI / MESSAGING', M.left, y - 11, { characterSpacing: 1 }).restore()
  const ext = [
    { t: 'Amazon Bedrock', s: 'Nova Lite — voice & policy', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
    { t: 'OSRM', s: 'road routing / ETA', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
    { t: 'Amazon SES / SNS', s: 'email / SMS alerts', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
    { t: 'Power BI Embedded', s: 'analytics (App-owns-data)', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
  ]
  const gap = 12, bw = (CW - gap * 3) / 4
  ext.forEach((e, i) => D.box(M.left + i * (bw + gap), y, bw, 46, e.t, e.s, e.o))
  d.addPage() // following section starts fresh (resets text cursor)
}

/* per-flow vertical step diagram */
function flowDiagram(D, steps) {
  const d = D.doc
  const boxH = 30, gap = 18, w = CW - 60
  const totalH = steps.length * boxH + (steps.length - 1) * gap
  D.ensure(totalH + 10)
  let y = d.y + 4
  const x = M.left + 30
  steps.forEach((s, i) => {
    d.save()
    d.roundedRect(x, y, w, boxH, 5).lineWidth(1).fillAndStroke('#ffffff', LINE)
    d.circle(x + 15, y + boxH / 2, 9).fill(ACCENT)
    d.fillColor('#ffffff').font('Helvetica-Bold').fontSize(9).text(String(i + 1), x + 11, y + boxH / 2 - 5)
    d.fillColor('#1e293b').font('Helvetica').fontSize(9).text(s, x + 32, y + 8, { width: w - 40, lineGap: 1 })
    d.restore()
    if (i < steps.length - 1) D.vArrow(x + 15, y + boxH, y + boxH + gap)
    y += boxH + gap
  })
  d.y = y + 6
}

/* ===================================================================
   POWER BI DATA PIPELINE DIAGRAM (Sources -> Web connector -> Power
   Query -> Model -> Report -> Embed)
   =================================================================== */
function biPipelineDiagram(D) {
  const d = D.doc
  d.addPage()
  d.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('Power BI data pipeline', M.left, M.top)
  d.font('Helvetica').fontSize(9).fillColor(MUTED).text('How operational data flows from the live API into business-ready visuals.', M.left, M.top + 18, { width: CW })
  let y = M.top + 46
  const cx = M.left + CW / 2
  const band = (label, boxes, h = 50) => {
    d.save().font('Helvetica-Bold').fontSize(7.5).fillColor('#94a3b8').text(label.toUpperCase(), M.left, y - 11, { characterSpacing: 1 }).restore()
    const n = boxes.length, gap = 12, bw = (CW - gap * (n - 1)) / n
    boxes.forEach((b, i) => D.box(M.left + i * (bw + gap), y, bw, h, b.t, b.s, b.o || {}))
    const bottom = y + h; y = bottom + 30; return bottom
  }
  const arrow = (fromY) => D.vArrow(cx, fromY, fromY + 30)
  let b
  b = band('Sources (live platform)', [
    { t: 'DynamoDB via API', s: 'Ops, Fleet, Reference', o: { fill: '#e9f3f2', stroke: ACCENT2, color: ACCENT } },
    { t: 'jamshedpur-users', s: 'employees & bands', o: { fill: '#e9f3f2', stroke: ACCENT2, color: ACCENT } },
    { t: 'Integrations', s: 'hospital · fuel · voice', o: { fill: '#e9f3f2', stroke: ACCENT2, color: ACCENT } },
  ]); arrow(b)
  b = band('Ingestion (Power BI Web connector)', [
    { t: 'GET /ops', s: 'requests·emergencies·bookings', o: { fill: '#eef6ff', stroke: '#bcd6f5', color: BLUE } },
    { t: 'GET /fleet · /fleet/vehicles', s: 'vehicles·drivers·fuel', o: { fill: '#eef6ff', stroke: '#bcd6f5', color: BLUE } },
    { t: 'GET /employees', s: 'x-api-key header', o: { fill: '#eef6ff', stroke: '#bcd6f5', color: BLUE } },
  ]); arrow(b)
  b = band('Transform (Power Query / M)', [
    { t: 'Expand JSON → tables', s: 'lists → rows → columns' },
    { t: 'Type & clean', s: 'numbers, dates, nulls' },
    { t: 'Derive', s: 'band label, SLA bucket' },
  ]); arrow(b)
  b = band('Model (star schema + DAX)', [
    { t: 'Fact: Emergencies', s: 'one row per incident', o: { fill: SOFT, stroke: '#bcd', color: ACCENT } },
    { t: 'Dimensions', s: 'Zone·Hospital·Vehicle·Band·Date', o: { fill: SOFT, stroke: '#bcd', color: ACCENT } },
    { t: 'Measures', s: 'SLA% · util · avg ETA', o: { fill: SOFT, stroke: '#bcd', color: ACCENT } },
  ]); arrow(b)
  band('Deliver (report + embed)', [
    { t: 'Report pages', s: 'KPIs · maps · AI visuals', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
    { t: 'Embed in app', s: 'App-owns-data · SSO', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
    { t: 'Refresh', s: 'manual / gateway schedule', o: { fill: '#fdf2f8', stroke: '#f5cfe3', color: '#be185d' } },
  ])
  d.addPage()
}

/* ===================================================================
   4) POWER BI & DATA ENGINEERING
   =================================================================== */
async function buildPowerBI() {
  const D = new Doc('Power BI Analytics & Data Engineering',
    'Turning live emergency-response data into business insight',
    'A combined business and engineering document: what the platform measures and the decisions it enables, followed by the end-to-end data-engineering workflow that powers the Power BI reports — sources, Web-connector ingestion, Power Query transformations, the data model, DAX, refresh, and the analytics design (including advanced Power BI capabilities).')

  // ---------- BUSINESS LAYER ----------
  D.h1('1. Executive summary')
  D.p('JSD TATA Emergency Services coordinates ambulances, fire trucks and blood-bank logistics across the Jamshedpur township. Every booking, dispatch, ETA and completion is captured as live operational data. This document describes how that data is engineered into Power BI and the business insights it surfaces — response performance, fleet readiness, demand patterns, fuel economics and service-level compliance — so leadership can act on facts, not guesswork.')
  D.p('Analytics is delivered two ways: an embedded dashboard inside the operations app (no separate Power BI login, authorised by the same corporate SSO), and the full Power BI report for deeper analysis. The data is sourced directly from the platform’s live API using Power BI Web connectors, so reports reflect real operations with no manual exports.')

  D.h1('2. What we measure & why it matters')
  D.table(['Metric', 'What it tells the business'], [
    ['Total responses & today’s volume', 'Service demand and load trend over time.'],
    ['Active vs queued incidents', 'Whether current capacity meets live demand.'],
    ['Avg response time (to scene)', 'How fast help arrives — the core service promise.'],
    ['SLA compliance %', 'Share of incidents met within target by severity (Critical 8 / Urgent 15 / Normal 30 min).'],
    ['Responses by severity & type', 'Case mix — medical vs fire, Critical/Urgent/Normal.'],
    ['Responses by zone', 'Geographic demand hotspots for resource placement.'],
    ['Fleet utilisation', 'How hard the fleet is working; spare capacity.'],
    ['Fuel burn & refuel cadence', 'Operating cost driver and readiness risk (low-fuel units).'],
    ['Band-based entitlements', 'Transport allotment governance by employee band (0–4).'],
  ], [165, CW - 165])

  D.h1('3. Services & data the platform produces')
  D.p('All analytics draw from one platform. The table below maps each service to the data it contributes to the reporting layer.')
  D.table(['Service / source', 'Data contributed to analytics'], [
    ['Dispatch API (psiog-transport-api)', 'Emergencies, requests, bookings, status, severity, ETA, distance, assignments.'],
    ['Fleet (DynamoDB)', 'Vehicles, drivers, status, fuel level, tank/consumption, refuel flags.'],
    ['ReferenceData (DynamoDB)', 'Zones, hospitals, fire stations, locations, dispatch policy.'],
    ['jamshedpur-users (shared)', 'Employee directory and band (0–4) for entitlement analytics.'],
    ['Hospital integration', 'Inbound hospital ambulance requests (source = HOSPITAL).'],
    ['Fuel-team integration', 'Refuel confirmations and litres dispensed (fuel logs).'],
    ['Voice agent (Bedrock)', 'Voice-originated bookings (source channel mix).'],
  ], [180, CW - 180])

  // ---------- ENGINEERING LAYER ----------
  biPipelineDiagram(D)

  D.h1('4. Data engineering workflow')
  D.p('The reporting layer is built directly on the live API — no warehouse or manual extracts for the current scope. The pipeline has five stages: ingest, transform, model, measure, refresh.')

  D.h2('4.1 Ingestion — Power BI Web connectors')
  D.p('Power BI connects to the platform’s HTTPS/JSON API using the Web connector (Get Data → Web → Advanced), sending a server-to-server API key in the request header. The CONSOLE-scoped key grants read access to the analytics endpoints; credentials are stored as Anonymous because authentication is carried by the header, not a Power BI credential.')
  D.table(['Query', 'Endpoint', 'Produces'], [
    ['ops', 'GET /ops', 'One object with three lists: requests, emergencies, bookings.'],
    ['fleet', 'GET /fleet', 'Vehicles and drivers (status, zone, assignment).'],
    ['fleet_fuel', 'GET /fleet/vehicles', 'Per-vehicle fuel: tank, kmpl, fuel_l, fuel_pct, needs_refuel.'],
    ['employees', 'GET /employees', 'Directory with employee_band, grade, department, status.'],
  ], [90, 140, CW - 230])
  D.code([
    '// Power Query — Web connector with API-key header (per query)',
    'let',
    '  Source = Json.Document(Web.Contents(',
    '    "https://cfnjgxlvfl.execute-api.eu-west-1.amazonaws.com/ops",',
    '    [ Headers = [ #"x-api-key" = "<CONSOLE_API_KEY>" ] ]))',
    'in Source',
  ])
  D.note('Security: the API key sits inside the dataset credentials. For production, store it in the data-gateway data source (or move analytics to a read-only key) and never publish the report publicly with the key embedded.')

  D.h2('4.2 Transformation — Power Query (M)')
  D.p('The /ops object is shaped into three fact-style tables; the others map directly. Typical steps:')
  D.bullets([
    'Expand the emergencies list to new rows, then expand the record fields into columns (no name prefix).',
    'Repeat for requests and bookings as separate queries (duplicate the source, keep one list each).',
    'Set data types: eta_min, eta_to_pickup_min, distance_km → Decimal; patients_count, employee_band → Whole number; created_at/updated_at → Date/time.',
    'Clean: trim text, replace empty strings with null, filter to status = Active for employees.',
    'Derive columns: SLA target by severity, response-time bucket (≤8 / ≤15 / ≤30 / over), band label (B0–B4), hour-of-day and date keys for trend analysis.',
  ])

  D.h2('4.3 Data model — star schema')
  D.p('Model the expanded tables as a star: a central fact (Emergencies) related to conformed dimensions. This keeps measures simple and slicers fast.')
  D.table(['Table', 'Role', 'Key fields'], [
    ['Emergencies', 'Fact (one row per incident)', 'id, kind, severity, status, eta_min, distance_km, zone, hospital_id, vehicle_id, band, created_at'],
    ['Dim Date', 'Dimension', 'date, day, week, month (mark as date table)'],
    ['Dim Zone', 'Dimension', 'zone_id, zone name, lat/lng'],
    ['Dim Hospital', 'Dimension', 'hospital_id, name, specialties, capability'],
    ['Dim Vehicle', 'Dimension', 'vehicle_id, reg, type, home zone, tank, kmpl'],
    ['Dim Band', 'Dimension', 'band (0–4), label, allowed_vehicle_types'],
  ], [95, 110, CW - 205])

  D.h2('4.4 Measures (DAX)')
  D.p('Core measures that drive the report and the embedded dashboard:')
  D.code([
    'Total Incidents = COUNTROWS(Emergencies)',
    'Active = CALCULATE([Total Incidents], Emergencies[status] = "EN_ROUTE")',
    'Completed = CALCULATE([Total Incidents], Emergencies[status] = "COMPLETED")',
    'Avg Response (min) = AVERAGE(Emergencies[eta_to_pickup_min])',
    'SLA Target (min) = SWITCH(SELECTEDVALUE(Emergencies[severity]),',
    '   "Critical", 8, "Urgent", 15, "Normal", 30)',
    'Within SLA = CALCULATE([Total Incidents],',
    '   FILTER(Emergencies, Emergencies[eta_to_pickup_min] <= [SLA Target (min)]))',
    'SLA Compliance % = DIVIDE([Within SLA], [Total Incidents])',
    'Fleet Utilisation % = DIVIDE(',
    '   CALCULATE(DISTINCTCOUNT(Emergencies[vehicle_id]), Emergencies[status]="EN_ROUTE"),',
    '   DISTINCTCOUNT(Dim Vehicle[vehicle_id]))',
    'Fuel Burn (L) = SUMX(Emergencies, DIVIDE(Emergencies[distance_km],',
    '   RELATED(Dim Vehicle[kmpl])))',
  ])

  D.h2('4.5 Refresh strategy')
  D.p('Two modes, matched to maturity:')
  D.table(['Mode', 'How it works', 'Use when'], [
    ['POC (current)', 'Web connector + Publish to web / manual refresh in the service.', 'Demo and early reporting.'],
    ['Production', 'On-premises / VNet data gateway holds the API key; scheduled refresh (e.g. every 30–60 min); secure App-owns-data embed.', 'Live leadership reporting.'],
  ], [90, CW - 90 - 110, 110])

  D.h1('5. Report design & unique Power BI usage')
  D.p('The report is organised into focused pages. Beyond standard KPI cards and charts, it uses several advanced Power BI capabilities to turn data into explanation and foresight — not just description.')
  D.h2('5.1 Operations overview')
  D.bullets([
    'KPI strip: Total, Active, Queued, Completed, Avg response, Fleet utilisation.',
    'Responses by type (donut), by severity (column), by zone (bar), trend over time (line).',
  ])
  D.h2('5.2 Geospatial hotspots (Map visual)')
  D.p('Plot incidents on a map by zone/coordinate to reveal demand hotspots and response-time blackspots across the township — the basis for where to pre-position units.')
  D.h2('5.3 AI visuals — Key Influencers & Decomposition Tree')
  D.p('Key Influencers explains what drives slow responses or SLA breaches (e.g. zone, severity, time-of-day, traffic factor). The Decomposition Tree lets a manager drill from a high number (e.g. total breaches) down through dimensions interactively to find the root contributor.')
  D.h2('5.4 What-if scenario parameters')
  D.p('What-if parameters let leadership simulate decisions live: add N ambulances to a zone, change the assumed travel speed or SLA target, or adjust the fuel refuel threshold — and immediately see the modelled effect on SLA compliance and utilisation.')
  D.h2('5.5 Drill-through & row-level security')
  D.p('Drill-through moves from any KPI to the underlying incident list for that slice. Row-level security (RLS) restricts what each role sees — e.g. a zone supervisor sees only their zone — so the same report safely serves many audiences.')

  D.h1('6. Business insights & recommendations')
  D.p('The analytics are designed to answer leadership questions and prompt action. Representative insights and the decisions they support:')
  D.table(['Insight (from the data)', 'Recommended action'], [
    ['A zone consistently breaches the Critical 8-min SLA', 'Pre-position or add an ambulance in that zone; review traffic-factor on its routes.'],
    ['Urgent volume peaks at specific hours', 'Shift-plan crews to peak windows instead of flat staffing.'],
    ['Fire trucks average ~5 km/L; rising trip distances', 'Forecast monthly fuel spend; schedule refuels off-peak to protect readiness.'],
    ['Repeated NO_HOSPITAL / queued incidents', 'Expand specialty coverage or partner hospitals for that case type.'],
    ['Fleet utilisation persistently high (low spare)', 'Justify capital case for additional units before demand outpaces capacity.'],
    ['Most demand from a few zones/sources', 'Target prevention and outreach where incidents concentrate.'],
    ['Band-based allotment mismatches', 'Tune the band→vehicle policy so entitlements match actual need.'],
  ], [CW / 2, CW / 2])
  D.note('Because the dispatch policy itself is configurable (speeds, SLA targets, unit caps, fuel thresholds), several of these recommendations can be enacted by updating policy — no code change — and their impact then re-measured in the same report.')

  D.h1('7. Governance & security')
  D.bullets([
    'Access to analytics endpoints is via a scoped server API key; the browser never holds it.',
    'Production refresh keeps the key inside the data gateway, not the published report.',
    'Embedded analytics use App-owns-data: authorised by corporate SSO, no separate Power BI login.',
    'Row-level security tailors visibility by role/zone; no patient-identifying data is published.',
    'The public "Publish to web" option is used only for non-sensitive POC demos.',
  ])

  D.h1('8. Roadmap')
  D.bullets([
    'Move ingestion behind a data gateway with scheduled refresh and a read-only analytics key.',
    'Add a curated historical store (e.g. S3 + Athena or a small warehouse) for long-range trends.',
    'Promote the embedded dashboard to a paid Power BI capacity for login-free production embedding.',
    'Expand AI visuals and what-if models as more history accumulates.',
  ])

  await save(D, 'PowerBI-DataEngineering.pdf')
}

/* ===================================================================
   1) ARCHITECTURE FLOW
   =================================================================== */
async function buildArchitecture() {
  const D = new Doc('Architecture & Service Flows', 'How every component fits together, end to end',
    'This document maps the complete runtime architecture of the JSD TATA Emergency Services platform — every AWS service, the trust boundaries between them, and a step-by-step walkthrough of each operational flow (booking, dispatch, ETA, tracking, notifications, AI agents and analytics).')

  D.h1('1. Executive summary')
  D.p('JSD TATA Emergency Services is a serverless emergency dispatch platform for Tata Steel, Jamshedpur. It coordinates ambulances, fire trucks and blood-bank logistics across the township. Citizens and staff request help through a web portal (Cognito SSO); hospital and blood-bank systems integrate machine-to-machine via scoped API keys; dispatchers manage everything from an admin console.')
  D.p('The system is fully serverless: a React single-page app served via CloudFront, a single AWS Lambda behind an API Gateway HTTP API, and DynamoDB for storage. Amazon Bedrock powers a voice agent and a policy-as-config agent; OSRM provides road routing for traffic-aware ETAs; SES/SNS deliver notifications; Power BI Embedded provides analytics. There are no servers to manage and the design scales on demand.')

  D.h1('2. Component inventory')
  D.table(['Service', 'Role'], [
    ['Amazon CloudFront + S3', 'Hosts and globally delivers the React SPA over HTTPS (S3 private via Origin Access Control).'],
    ['Amazon Cognito', 'Single sign-on; issues JWTs (RS256) verified in-Lambda against the pool JWKS.'],
    ['API Gateway (HTTP API)', 'Single proxy route to the Lambda; stage throttling (10 rps, burst 20); locked CORS.'],
    ['Lambda: psiog-transport-api', 'Core API: auth, dispatch engine, ETA, live tracking, notifications, policy upload.'],
    ['Lambda: psiog-policy-sync', 'Reads a natural-language policy PDF via Bedrock and updates dispatch config.'],
    ['DynamoDB', 'Four tables: ReferenceData, Fleet, TransportRequests, ShuttleCards.'],
    ['Amazon Bedrock (Nova Lite)', 'Voice-agent intent extraction and policy-document understanding.'],
    ['OSRM', 'Road-network routing for distance/time, scaled by a traffic factor.'],
    ['Amazon SES / SNS', 'Email and SMS notifications to requesters.'],
    ['Power BI Embedded', 'Embedded analytics dashboard (App-owns-data, SSO-gated).'],
  ], [150, CW - 150])

  architectureDiagram(D)

  D.h1('3. Trust boundaries & authentication')
  D.p('Two principal types are supported. Browser users authenticate with a Cognito JWT (Authorization: Bearer); the Lambda verifies the signature against the pool JWKS, checks expiry/issuer/audience, and reads cognito:groups for the admin role (transport-admin). Server callers (hospital, blood bank) use a scoped x-api-key, mapped to a source with a permission scope (CONSOLE = all; HOSPITAL = emergencies only). All operational reads/writes require one of these; the public live-tracking endpoint is the only unauthenticated route and is protected by a per-incident secret token.')

  D.h1('4. End-to-end flows')
  D.p('Each flow below lists the runtime steps. All write paths pass through the dispatch engine in the core Lambda, which assigns the nearest available unit and persists the result to DynamoDB.')

  const flows = [
    ['4.1 Citizen / staff booking (web portal)', [
      'User opens the portal via Jamshedpur SSO; Cognito JWT is attached to API calls.',
      'User submits an emergency (type, severity, pickup, optional contact).',
      'API Gateway routes POST /emergencies to the Lambda; JWT is verified.',
      'Dispatch engine finds the nearest idle unit and best hospital, computes ETA.',
      'Record persisted to TransportRequests; unit/driver marked en route in Fleet.',
      'Response returns status, assigned unit, ETA and a tracking link; portal shows live progress.',
    ]],
    ['4.2 Hospital / blood-bank booking (API key)', [
      'Hospital system calls POST /emergencies with header x-api-key (HOSPITAL).',
      'Lambda validates the key and its scope (emergencies only).',
      'Dispatch engine assigns a unit; OSRM + traffic factor produce a road ETA.',
      'Response JSON includes eta_to_pickup_min, eta_min, distance_km, traffic_factor and tracking_url.',
      'Hospital may poll GET /emergencies/{id} for refreshed status/ETA.',
    ]],
    ['4.3 Voice-agent booking', [
      'Caller speaks to the voice agent in the portal call window.',
      'Audio/text is sent to a voice Lambda which calls Amazon Bedrock (Nova Lite).',
      'Bedrock extracts intent and slots (type, location, patients) into structured fields.',
      'Agent asks for confirmation/approval before dispatch (no auto-dispatch).',
      'On approval, the collected slots are dispatched via the core API.',
    ]],
    ['4.4 Blood-bank logistics (round trip)', [
      'Hospital requests blood with its location as pickup and a destination blood bank.',
      'An ambulance is assigned for a round trip: base → hospital → blood bank → hospital.',
      'ETA covers the full round trip; the dispatch board shows all three legs.',
    ]],
    ['4.5 Mass-casualty dispatch', [
      'A request arrives with a high patient count (e.g. "bomb blast, 100 affected").',
      'Policy parameters decide unit count: ceil(patients / patients_per_ambulance), capped at max_units.',
      'Multiple ambulances are dispatched under one incident_id; any beyond available units queue.',
      'Queued units auto-dispatch as vehicles free up (server-side sweep).',
    ]],
    ['4.6 Real-time traffic & ETA', [
      'On dispatch, the Lambda calls OSRM for the road route (base → scene → destination).',
      'A congestion multiplier (time-of-day rush curve, or POLICY.traffic_factor) scales the time.',
      'eta_to_pickup_min and eta_min are returned and stored; identical routes are cached per invocation.',
      'If OSRM is unreachable, it falls back to straight-line distance ÷ policy speed × traffic.',
    ]],
    ['4.7 Live tracking link', [
      'Each emergency is issued a secret track_token at creation.',
      'The booking response and notification include a public link: /track/{id}?t=token.',
      'Opening it calls GET /track/{id} (no login); the token is validated.',
      'A public map page animates the unit along its route with a live ETA and progress bar.',
    ]],
    ['4.8 Notifications (email / SMS)', [
      'If the requester provided contact details, the Lambda notifies them best-effort.',
      'On dispatch: an SES email and/or SNS SMS with ETA and the tracking link.',
      'On completion: a closing message. Failures are logged and never block dispatch.',
    ]],
    ['4.9 Policy-as-config agent', [
      'An admin uploads a natural-language policy PDF from the console.',
      'The core Lambda stores it in S3 and invokes psiog-policy-sync.',
      'policy-sync sends the PDF to Bedrock, which extracts parameters (speeds, thresholds, caps).',
      'Values are sanitised and written to the core Lambda’s POLICY_CONFIG env — behaviour updates with no code change.',
    ]],
    ['4.10 Power BI analytics (App-owns-data)', [
      'Admin opens the Dashboard; the frontend requests an embed token from the API.',
      'The Lambda uses a service principal to mint a short-lived Power BI embed token.',
      'The report renders embedded — authorised by the user’s SSO session, with no Power BI login.',
    ]],
  ]
  for (const [title, steps] of flows) { D.h2(title); flowDiagram(D, steps); }

  await save(D, 'Architecture-Flow.pdf')
}

/* ===================================================================
   2) SYSTEM DESIGN
   =================================================================== */
async function buildSystemDesign() {
  const D = new Doc('System Design', 'Requirements, design decisions, scale, resilience and cost',
    'A layered design document: an executive overview of the platform followed by detailed component design, the dispatch algorithm, the security model, and non-functional treatment of scalability, resilience and cost.')

  D.h1('1. Executive summary')
  D.p('The platform provides on-demand emergency response coordination for the Tata Steel Jamshedpur township across three services — ambulance, fire and blood logistics — with multi-channel intake (web portal, machine API, and a voice agent). It is built serverless-first for elasticity and low operational overhead, and integrates AI (Amazon Bedrock) for natural-language intake and policy management.')

  D.h1('2. Goals & scope')
  D.bullets([
    'Dispatch the nearest appropriate unit automatically, with manual override for dispatchers.',
    'Give every requester a traffic-aware ETA and a live tracking link.',
    'Let hospitals/blood banks integrate machine-to-machine with scoped, least-privilege access.',
    'Adapt operational policy from a plain-language document, without redeploying code.',
    'Scale from demo to township load without server management.',
  ])

  D.h1('3. Requirements')
  D.h2('3.1 Functional')
  D.bullets([
    'Create/auto-dispatch emergencies (medical, fire, blood); mass-casualty multi-unit dispatch.',
    'Nearest-unit assignment by zone proximity; hospital selection by specialty and capability.',
    'Manual reassignment of unit/hospital; cancel and complete.',
    'Traffic-aware ETA; live public tracking; email/SMS notifications.',
    'Admin policy upload; analytics dashboard.',
  ])
  D.h2('3.2 Non-functional')
  D.bullets([
    'Availability: serverless, multi-AZ managed services; graceful degradation when externals fail.',
    'Security: SSO JWT verification, scoped API keys, CORS lockdown, throttling, input validation, log hygiene.',
    'Performance: dispatch decision in well under a second; ETA enriched via OSRM with caching.',
    'Cost: pay-per-use; near-zero idle cost.',
  ])

  D.h1('4. High-level architecture')
  D.p('Clients reach a CloudFront-delivered SPA and an API Gateway HTTP API. A single Lambda holds the domain logic and talks to DynamoDB and the external/AI services. A second Lambda performs policy synchronisation. See the master architecture diagram on the next page.')
  architectureDiagram(D)

  D.h1('5. Key design decisions & trade-offs')
  D.table(['Decision', 'Rationale', 'Trade-off'], [
    ['Single Lambda (modular monolith)', 'Simple deploy, shared code, low cold-start surface.', 'Less independent scaling per route.'],
    ['DynamoDB single-digit-ms KV', 'Elastic, serverless, predictable latency.', 'Access patterns must be designed up front (GSIs).'],
    ['JWT verified in-Lambda', 'No extra authorizer infra; full control.', 'Must manage JWKS caching/rotation in code.'],
    ['OSRM public routing', 'Free road ETAs for the POC.', 'No live traffic feed; congestion simulated.'],
    ['Policy-as-config via Bedrock', 'Non-engineers tune behaviour from a PDF.', 'Relies on LLM extraction + sanitisation.'],
  ], [120, CW - 120 - 150, 150])

  D.h1('6. Component design')
  D.h2('6.1 Frontend (React SPA)')
  D.p('React + Vite + Zustand state, Leaflet/OSM maps, Recharts. Routes are gated by SSO role: admins get the dispatcher console, others the self-service portal. A public /track route renders outside the auth gate. Polls the API every few seconds for near-real-time board updates and animates units client-side.')
  D.h2('6.2 Core API Lambda')
  D.p('Resolves the principal (API key or JWT), authorises by scope/role, validates input, and routes to handlers: reference reads, fleet, ops, emergency create/override/route, policy upload, tracking, and Power BI token. The dispatch engine is shared across create, mass-casualty and queue-drain paths.')
  D.h2('6.3 Dispatch algorithm')
  D.bullets([
    'Resolve pickup to coordinates (location ref or raw lat/lng).',
    'Rank zones by proximity; query the nearest idle unit of the required type via a GSI.',
    'Medical: choose a hospital matching the case specialty (Critical prefers higher capability, then distance).',
    'Compute road ETA (OSRM × traffic); persist record; mark unit/driver busy.',
    'If no unit: QUEUED; a server-side sweep auto-dispatches as units free and completes trips past ETA.',
  ])
  D.h2('6.4 AI agents')
  D.p('The voice agent uses Bedrock to convert speech/text into structured dispatch slots, confirming before acting. The policy-sync agent uses Bedrock document understanding to extract operational parameters from a PDF and write them to the core Lambda’s configuration.')

  D.h1('7. Security model')
  D.bullets([
    'Authentication: Cognito JWT (RS256) verified against pool JWKS; scoped API keys for servers.',
    'Authorization: admin via cognito:groups; API-key scopes restrict POST resources; users limited to their own records.',
    'Transport: HTTPS everywhere; S3 private behind CloudFront OAC.',
    'Hardening: locked CORS (allow-list origins), API Gateway throttling, strict input validation, generic error messages, no PII in logs.',
    'Tracking links carry an unguessable per-incident token; no secrets shipped to the browser.',
  ])

  D.h1('8. Scalability & performance')
  D.p('Every tier scales on demand. Lambda scales horizontally with concurrent requests; DynamoDB on-demand absorbs spikes without capacity planning; CloudFront caches static assets at the edge. The dispatch decision is pure compute over a small in-memory reference cache (warm-invocation reuse). ETA enrichment calls OSRM with per-invocation route caching so mass-casualty fan-out reuses identical routes. API Gateway throttling (10 rps, burst 20) protects downstreams and can be raised per environment.')

  D.h1('9. Resilience & failure modes')
  D.table(['If this fails…', 'Behaviour'], [
    ['OSRM unreachable', 'ETA falls back to straight-line ÷ policy speed × traffic; dispatch still succeeds.'],
    ['SES/SNS error', 'Notification is logged and skipped; dispatch is never blocked.'],
    ['Bedrock unavailable', 'Voice/policy features degrade; core dispatch (portal/API) is unaffected.'],
    ['No unit available', 'Request is QUEUED and auto-dispatched later by the sweep.'],
    ['Browser/console offline', 'Server-side sweep still completes trips and drains the queue.'],
    ['Power BI token error', 'Dashboard shows a clear message; rest of the app works.'],
  ], [160, CW - 160])

  D.h1('10. Cost model (indicative)')
  D.p('All core services are pay-per-use with no idle cost. Indicative monthly ranges:')
  D.table(['Service', 'Demo scale', 'Production (township)'], [
    ['Lambda + API Gateway', '~Free tier', 'Low tens of USD'],
    ['DynamoDB (on-demand)', '~Free tier', 'Low tens of USD'],
    ['CloudFront + S3', '< $1', 'Single-digit USD'],
    ['Cognito', 'Free tier (MAU)', 'Scales with active users'],
    ['Bedrock (Nova Lite)', 'Pennies per call', 'Usage-based'],
    ['SES / SNS', '< $1', 'Usage-based (SMS per-message)'],
    ['Power BI', 'Free dev embed', 'Capacity (A/F SKU) for prod'],
  ], [150, (CW - 150) / 2, (CW - 150) / 2])
  D.note('Power BI is the main step-change cost at production scale: login-free embedding needs a paid capacity (A/F SKU). Everything else remains pay-per-use.')

  await save(D, 'System-Design.pdf')
}

/* ===================================================================
   3) DB SCHEMA
   =================================================================== */
async function buildDbSchema() {
  const D = new Doc('Database Schema', 'DynamoDB tables, indexes, access patterns and samples',
    'The complete data model for the platform: four DynamoDB tables, their partition/sort key designs, global secondary indexes, the access patterns each index serves, and realistic sample items.')

  D.h1('1. Overview & conventions')
  D.p('Storage is Amazon DynamoDB. The design is access-pattern driven: each table uses composite keys (PK + SK) and a small set of global secondary indexes (GSIs) to serve the queries the application needs without scans on the hot path. Single-table-style overloading is used within each table (multiple entity kinds share a table, distinguished by key prefixes).')
  D.bullets([
    'PK = partition key, SK = sort key.',
    'Item kinds are namespaced by key prefixes (e.g. EMG#, VEH#, HOSP).',
    'SK = "META" denotes the primary item; child rows (events, rides, fuel) use other SK prefixes.',
    'On-demand capacity mode — no provisioned throughput to manage.',
  ])

  D.h1('2. Tables at a glance')
  D.table(['Table', 'Holds', 'PK / SK pattern'], [
    ['ReferenceData', 'Locations, zones, hospitals, fire stations, policy', 'PK = type (LOC/ZONE/HOSP/FIRE/POLICY), SK = id'],
    ['Fleet', 'Vehicles, drivers, allotments, fuel logs', 'PK = VEH#/DRV#/ALLOT#…, SK = META/FUEL#…'],
    ['TransportRequests', 'Emergencies, requests, bookings + audit events', 'PK = EMG#/REQ#/BK#<id>, SK = META / EVT#<ts>'],
    ['ShuttleCards', 'Shuttle entitlement cards and rides', 'PK = CARD#<id>, SK = META / RIDE#<date>#<id>'],
  ], [110, CW - 110 - 200, 200])

  // ReferenceData
  D.h1('3. ReferenceData')
  D.p('Reference/master data, partitioned by record type so each type is a single-partition query.')
  D.h2('3.1 Schema')
  D.table(['Attribute', 'Type', 'Notes'], [
    ['PK', 'S', 'LOC | ZONE | HOSP | FIRE | POLICY'],
    ['SK', 'S', 'The record id (e.g. hosp-tmh, zone-bistupur)'],
    ['id', 'S', 'Same as SK, surfaced for the app'],
    ['lat / lng', 'N', 'Coordinates (LOC/HOSP/FIRE)'],
    ['zone_id', 'S', 'Owning zone'],
    ['specialties / capability', 'L / N', 'HOSP only — case types handled, capability tier'],
    ['ref / polygon / color', 'M / L / S', 'ZONE only — centroid, boundary, map colour'],
    ['levels / params', 'L / M', 'POLICY only — operational parameters'],
  ], [120, 50, CW - 170])
  D.h2('3.2 Access patterns')
  D.table(['Pattern', 'How'], [
    ['List all locations / zones / hospitals / fire stations', 'Query PK = "LOC" / "ZONE" / "HOSP" / "FIRE"'],
    ['Latest policy', 'Query PK = "POLICY", newest first, limit 1'],
    ['Get one hospital/zone by id', 'GetItem PK=type, SK=id'],
  ], [230, CW - 230])
  D.h2('3.3 Sample item (hospital)')
  D.code(['{ "PK":"HOSP", "SK":"hosp-tmh", "id":"hosp-tmh",', '  "name":"Tata Main Hospital", "lat":22.7868, "lng":86.1958,', '  "specialties":["Cardiac","Trauma","General","Pediatric"],', '  "capability":5, "zone_id":"zone-bistupur" }'])

  // Fleet
  D.h1('4. Fleet')
  D.p('Vehicles and drivers (plus allotments and fuel logs), with GSIs that let the dispatcher find a free unit near a zone in one query.')
  D.h2('4.1 Schema')
  D.table(['Attribute', 'Type', 'Notes'], [
    ['PK', 'S', 'VEH#<id> | DRV#<id> | ALLOT#<emp>'],
    ['SK', 'S', 'META (entity) | FUEL#<date>#<id>'],
    ['type / status', 'S', 'ambulance|firetruck|bus|car ; idle|enroute|maintenance'],
    ['home_zone_id / driver_id', 'S', 'Vehicle home zone; bound driver'],
    ['reg / fuel / odometer', 'S/N/N', 'Registration and telemetry'],
    ['GSI1PK / GSI1SK', 'S', 'ZONE#<zone>#VEH  /  <status>#<type>#<id>'],
    ['GSI2SK / GSI3PK', 'S', 'driver status index / VEHSTATUS#<status>'],
  ], [130, 60, CW - 190])
  D.h2('4.2 Indexes & access patterns')
  D.table(['Index', 'Serves'], [
    ['GSI1-zoneveh (PK ZONE#<zone>#VEH)', 'Find nearest idle unit of a type: begins_with(GSI1SK, "idle#<type>#")'],
    ['GSI2 (driver status)', 'List drivers by availability'],
    ['GSI3 (VEHSTATUS#<status>)', 'Fleet utilisation by status'],
    ['Scan SK = META', 'Full fleet snapshot for the console'],
  ], [200, CW - 200])
  D.h2('4.3 Sample item (vehicle)')
  D.code(['{ "PK":"VEH#veh-sonari-amb-1", "SK":"META",', '  "id":"veh-sonari-amb-1", "type":"ambulance", "status":"idle",', '  "reg":"JH05-AM-1112", "home_zone_id":"zone-sonari",', '  "driver_id":"drv-sonari-amb-1",', '  "GSI1PK":"ZONE#zone-sonari#VEH", "GSI1SK":"idle#ambulance#veh-sonari-amb-1" }'])

  // TransportRequests
  D.h1('5. TransportRequests')
  D.p('The operational ledger: emergencies (EMG), transport requests (REQ) and shuttle bookings (BK), each with a META item plus append-only EVT# audit rows. Status/zone/source/vehicle GSIs support the dispatch board and queue handling.')
  D.h2('5.1 Schema (emergency)')
  D.table(['Attribute', 'Type', 'Notes'], [
    ['PK / SK', 'S', 'EMG#<id> / META (and EVT#<ts> for audit)'],
    ['entity / status', 'S', 'EMG ; EN_ROUTE|QUEUED|NO_HOSPITAL|COMPLETED|CANCELLED'],
    ['kind / case_type / severity', 'S', 'medical|fire|blood ; specialty ; Critical|Urgent|Normal'],
    ['pickup / pickup_zone_id', 'M / S', 'Location ref or lat/lng; nearest zone'],
    ['assigned_vehicle_id / driver', 'S', 'Dispatched unit and driver'],
    ['hospital_id / fire_station_id / blood_bank_id', 'S', 'Destination by kind'],
    ['distance_km / eta_min / eta_to_pickup_min', 'N', 'Traffic-aware ETA fields'],
    ['eta_complete / traffic_factor', 'N', 'Completion epoch; congestion multiplier'],
    ['incident_id / patients_count', 'S / N', 'Mass-casualty grouping'],
    ['contact / track_token', 'M / S', 'Notify target; live-tracking secret'],
    ['GSI2/3/4/5', 'S', 'status, zone, source, vehicle indexes'],
  ], [180, 55, CW - 235])
  D.h2('5.2 Indexes & access patterns')
  D.table(['Index', 'Serves'], [
    ['Scan SK = META (+ filter)', 'Board list of all emergencies/requests/bookings'],
    ['GetItem PK=EMG#<id>, SK=META', 'Single incident status / tracking'],
    ['GSI2 (entity#STATUS#<status>)', 'Queued/active by status, severity-ranked'],
    ['GSI3 (ZONE#<zone>)', 'Incidents by zone'],
    ['GSI5 (VEH#<id>)', 'Trips by vehicle'],
  ], [210, CW - 210])
  D.h2('5.3 Sample item (emergency)')
  D.code(['{ "PK":"EMG#EMG-784", "SK":"META", "entity":"EMG", "id":"EMG-784",', '  "kind":"medical", "case_type":"Cardiac", "severity":"Critical",', '  "status":"EN_ROUTE", "pickup":{"lat":22.8145,"lng":86.2207},', '  "assigned_vehicle_id":"veh-kadma-amb-1", "hospital_id":"hosp-tmh",', '  "eta_to_pickup_min":7.8, "eta_min":16.4, "distance_km":9.1,', '  "traffic_factor":1.3, "track_token":"ab12…", "created_at":"…" }'])

  // ShuttleCards
  D.h1('6. ShuttleCards')
  D.p('Employee shuttle entitlement cards and their ride history (secondary module sharing the platform).')
  D.h2('6.1 Schema & access')
  D.table(['Attribute / pattern', 'Notes'], [
    ['PK = CARD#<id>, SK = META', 'Card record: holder, grade, monthly cap, used_this_month'],
    ['SK = RIDE#<date>#<id>', 'A ride row under the card'],
    ['Scan / Query PK', 'List cards; list a card’s rides (SK begins_with RIDE#)'],
  ], [220, CW - 220])

  D.h1('7. Cross-table notes')
  D.bullets([
    'Reference data is cached in-Lambda per warm invocation to keep dispatch fast.',
    'Bed capacity is intentionally NOT tracked here — hospital systems own it.',
    'Audit/event rows (EVT#) are append-only for traceability.',
    'On-demand billing means tables cost ~nothing at idle and scale with traffic.',
  ])

  await save(D, 'DB-Schema.pdf')
}

await buildArchitecture()
await buildSystemDesign()
await buildDbSchema()
await buildPowerBI()
console.log('\nAll PDFs generated in', OUT_DIR)
