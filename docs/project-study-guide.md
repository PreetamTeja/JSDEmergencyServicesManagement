# JSD Emergency Services — Complete Study Guide

A single reference to study the business and technical scope of this project end to
end. Organized so you can go broad first (what/why), then deep (how), then check
specific areas as needed.

---

## 1. Business Context

**What it is:** A real-time emergency dispatch platform for **Tata Steel,
Jamshedpur** — coordinating ambulance and fire truck response, plus blood delivery
logistics, across the township.

**The problem it replaces:** Manual, phone-based coordination with no live
visibility into vehicle location/status, no self-service way for requesters to raise
or track a request, and no historical data to inform staffing/fleet decisions.

**Three distinct audiences, three different surfaces:**

| Audience | Surface | Access |
|---|---|---|
| Control room dispatchers | Admin Console | Cognito SSO, `transport-admin`/`MainAdmin` group |
| Requesters (staff needing help) | Self-service Portal | Cognito SSO, regular user |
| Partner hospitals / blood-bank team | Public tracking links + polling feed | Tracking token (per-dispatch) or API key |
| Anyone without app access | Voice emergency line | Phone call, no login |

---

## 2. User-Facing Features (What It Does)

### Admin Console (dispatchers)
- Live map of all active dispatches and fleet position.
- Dispatch board / request queue (`RequestsPage.jsx`) with copyable tracking links.
- Fleet management (vehicle/driver status, maintenance, fuel).
- **AI Insights page** — ~13 executive-question cards (SLA breach drivers, fleet
  right-sizing, cost per outcome, channel quality, demographic response-gap equity
  check, weather/seasonal impact, etc.) — not just charts, plain-language answers.
- **Power BI analytics** — a full multi-page BI report (Overview, SLA & Performance,
  Fleet & Cost, Growth Analytics, Geographic Analysis, Channel & Demographics,
  Anomalies & Readiness) built on years of historical + live data.
- Command palette (Ctrl/Cmd+K), infra health page, policy controls.

### Requester Portal (self-service)
- Raise a request (ambulance/fire truck), pick location, case type, severity.
- **Mass casualty incident (MCI) handling** — enter how many people are affected,
  the system auto-calculates and dispatches the right number of ambulances (based
  on a configurable `patients_per_ambulance` policy), instead of requiring multiple
  manual calls during a crisis.
- Live tracking of your own requests (status stepper: Requested → Unit assigned →
  En route → Arrived), with a live map.
- **Voice-driven emergency line** ("Call for help" button) — natural speech in,
  structured dispatch out, no operator needed.

### Public Tracking (hospitals, blood-bank team, anyone with a link)
- Each dispatch gets a unique, tokenized shareable link (`/track/:id?t=token`) —
  live map, ETA, status, no login required.
- A polling JSON feed (`GET /emergencies/status`) for programmatic integration
  (partner hospitals, blood-bank team) — API-key gated, returns `tracking_url` and
  live status for every dispatch.

---

## 3. Standout Technical Features (What Makes It Non-Trivial)

### Real road routing via OSRM
Dispatch distance/ETA isn't straight-line — `OsrmService.cs` calculates actual
drivable routes over the real road network, which is what makes ETAs and "nearest
vehicle" decisions actually trustworthy.

### Voice agent grounded via OKF, not RAG
The voice agent (separate Lambda, `lambda/VoiceAgent/`) uses Amazon Bedrock (Nova
Lite) for NLU. Its knowledge base is **OKF ("Open Knowledge Format")** — not a real
industry standard, just this project's own term for a deliberately simple pattern:
flat markdown files (30 locations, 5 case types, vehicles) concatenated into one
~17KB string at cold start, injected whole into every prompt. No vector database, no
embeddings, no retrieval step. This is a **deliberate cost/reliability tradeoff**,
not a shortcut — see `docs/okf-vs-rag.md` for the full case, and the cost comparison
below.

### Self-healing fleet state
A background reconciliation sweep (`ReconcileOrphanedVehicles`, runs on every
`/ops` poll) automatically detects and fixes vehicles stuck in a bad state — e.g. a
vehicle marked "enroute" with no actual active dispatch (a real production bug this
caught and fixed: `BuildEmergency` marks a vehicle enroute *before* the emergency
record is actually persisted — non-atomic, so a transient failure between those two
steps could orphan a vehicle forever without this fix).

### Configurable dispatch policy, not hardcoded
Mass-casualty thresholds, patients-per-ambulance ratio, max concurrent units,
severity ordering — all driven by a `POLICY_CONFIG` env var, tunable without a code
deploy.

### Full analytics pipeline on real + synthetic data
An ETL (`infra/etl/oltp_to_olap.py`) transforms live DynamoDB records plus a
**realistic synthetic historical dataset** (`infra/seed-history.mjs` — models real
structural events: COVID lockdown cliff and reopening waves, monsoon flood spikes,
Diwali fire season, steel-industry cycle effects — not random noise) into a proper
star schema (`fact_dispatch` + 11 dimension tables) for Power BI.

---

## 4. Architecture (How It's Built)

```
[Callers/Users] → [Frontend Apps] → [API Gateway] → [Lambda Functions] → [DynamoDB / S3]
                                                            ↓
                                                    [Bedrock (Voice AI)]
                                                            ↓
                                              [Power BI / Fabric (Analytics)]
```

### Frontend (React + Vite, single codebase, role-routed)
- `App.jsx` — routes to Console (admin) or `UserPortal.jsx` (requester) based on
  Cognito group.
- `TrackPage.jsx` — public tracking page, no auth.
- `useFleetStore.js` (Zustand) — central state, polls `/ops` + `/fleet`.
- `services/api.js` — API client; **note:** most calls use same-origin relative
  paths (not absolute URLs) by design, so cookie-based SSO sessions attach
  correctly via a CloudFront behavior in production — this means local `vite dev`
  testing requires mocking these routes, they don't resolve directly against the
  real API without CloudFront in front.
- Hosting: S3 (private, OAC-gated) → CloudFront → HTTPS.

### Backend — two Lambdas
- **`TransportApi`** (`lambda/TransportApi/Function.cs`) — the main API. Manual
  route dispatch (no framework router), handles fleet/ops/requests/emergencies,
  admin cost/analytics endpoints, Power BI embed-token minting, SSO bridge.
  - `Auth.cs` — JWT verification, API-key auth, admin-group check.
  - `DynamoService.cs`, `OsrmService.cs`, `CloudWatchService.cs`, `SsoBridge.cs`.
- **`VoiceAgent`** (`lambda/VoiceAgent/Function.cs`) — Bedrock-based NLU, OKF
  knowledge loading, slot extraction.

### Auth — defense in depth, checked independently
- Frontend (`src/auth.js`) and backend (`Auth.cs`) both check Cognito group
  membership against their **own separately configured** allow-list
  (`VITE_ADMIN_GROUPS` / `ADMIN_GROUPS`) — not shared code, so a bug in one doesn't
  silently bypass the other.
- Three accepted auth methods: Cognito Bearer JWT, SSO session cookie (memory-only
  token storage, not sessionStorage — reduces XSS/extension token-theft exposure),
  or scoped API key (`MCP`, `HOSPITAL`, `POWERBI` — each labeled and narrowly
  scoped to specific routes).

### Data layer
- **DynamoDB** (single-table design) — vehicles, drivers, dispatches, employees,
  SSO replay tokens.
- **S3** — `psiog-analytics-export` (star-schema CSVs, authenticated proxy access
  only — **no presigned URLs**, deliberately refused as a data-exfiltration risk
  given the data includes real patient GPS/medical/demographic fields) and
  `psiog-emergency-app` (frontend hosting).

### Analytics / BI — two systems
1. In-app AI Insights (`InsightsPage.jsx`, backed by `GET /analytics/insights`).
2. Power BI report — **two embed modes**, switched by `VITE_POWERBI_SECURE`:
   - Iframe ("Website or portal" embed) — currently active, org-authenticated via
     Microsoft/Entra, independent of the app's own login.
   - **"App owns data"** — token-based, no separate Microsoft login, gated purely
     by the app's own Cognito admin check. Mostly built (backend code + env vars
     all in place), **currently on hold** — see `docs/powerbi-app-owns-data-status.md`
     for the exact blocker and what's left to verify.

### Infrastructure
- Fully serverless: Lambda + DynamoDB + S3/CloudFront + API Gateway. Pay-per-use,
  scales to zero when idle — fits an inherently spiky emergency-call workload.
- Deploy: `infra/deploy-frontend.sh` (S3 sync + CloudFront invalidation), backend
  via `dotnet lambda package` + `aws lambda update-function-code`.
- **Two separate CORS layers exist** — the Lambda's own application-level CORS
  logic (`ADMIN_GROUPS`/origin allow-lists in env vars) **and** a completely
  independent CORS configuration on the API Gateway HTTP API resource itself. Both
  need updating when adding a new allowed origin — this cost real debugging time
  once already (the blood-bank team's CORS issue).
- CloudWatch observability exposed directly to AI tooling via an MCP server
  (`infra/mcp/cloudwatch-server.mjs`).

---

## 5. Key Engineering Decisions Worth Understanding Deeply

| Decision | Why | Where documented |
|---|---|---|
| OKF over RAG for voice agent | Small closed domain (30 locations); real AWS cost math favors it (~$5/mo vs. RAG's ~$345/mo fixed OpenSearch Serverless floor) at this scale | `docs/okf-vs-rag.md` |
| Self-healing over manual fixes | Non-atomic dispatch-then-persist pattern can orphan vehicle state; sweep-based reconciliation matches the codebase's existing philosophy | `Function.cs` `ReconcileOrphanedVehicles` |
| No presigned URLs, ever | Sensitive patient/location data; authenticated backend proxy instead, even though presigned URLs would've been faster to build | Analytics export endpoint |
| Serverless-first infra | Spiky, unpredictable emergency-call load; pay-per-use beats idle server cost | `infra/deploy-frontend.sh`, Lambda-based backend |
| Two independent admin-auth checks (frontend + backend) | A bug in one shouldn't silently grant access via the other | `src/auth.js`, `Auth.cs` |

---

## 6. Currently Open / In-Progress Work

- **Power BI "App owns data" migration** — on hold, blocked on an Azure AD service
  principal permission-type issue (Delegated vs Application). Full status and next
  steps in `docs/powerbi-app-owns-data-status.md`.
- **API Gateway has its own separate CORS config** from the Lambda's — worth
  remembering any time a new external integration origin needs allow-listing; both
  layers need the update.
- Power BI report pages not yet built: Channel & Demographics, full Anomalies &
  Readiness (anomaly detection + Q&A visual were being added).
- Geographic Analysis page — zone/hospital bubble maps planned, point-density map
  abandoned (Power BI Map visual's rendering cap at real data volume).

---

## 7. Abbreviation Glossary

**AWS:** S3 (object storage), CDN (CloudFront), Lambda (serverless compute),
DynamoDB (NoSQL DB), GSI (Global Secondary Index), IAM (Identity and Access
Management), CORS (Cross-Origin Resource Sharing), OAC (Origin Access Control),
OSRM (Open Source Routing Machine).

**Identity:** SSO (Single Sign-On), JWT (JSON Web Token), JWKS (JSON Web Key Set),
AAD (Azure Active Directory, aka Microsoft Entra ID), ctid (customer tenant ID, a
Power BI URL param).

**Power BI:** PBI (Power BI), DAX (Data Analysis Expressions, its formula
language), RLS (Row-Level Security, not yet configured), PPU (Premium Per User).

**This project's own terms:** OKF ("Open Knowledge Format" — not an industry
standard, just this codebase's name for flat-file LLM knowledge injection), MCI
(Mass Casualty Incident).

---

## 8. Where to Look For Each Area (Quick Index)

- Dispatch/business logic: `lambda/TransportApi/Function.cs`
- Auth: `lambda/TransportApi/Auth.cs`, `src/auth.js`
- Voice agent + OKF: `lambda/VoiceAgent/Function.cs`, `infra/knowledge/`
- Frontend state: `src/store/useFleetStore.js`, `src/services/api.js`
- Admin console shell: `src/App.jsx`
- Requester portal: `src/portal/UserPortal.jsx`
- Public tracking: `src/features/track/TrackPage.jsx`
- AI Insights: `src/features/insights/InsightsPage.jsx`
- ETL / star schema: `infra/etl/oltp_to_olap.py`
- Synthetic historical data model: `infra/seed-history.mjs`
- Deploy scripts: `infra/deploy-frontend.sh`
- OKF vs RAG deep-dive: `docs/okf-vs-rag.md`
- Power BI security posture: `docs/powerbi-embed-security.md`
- Power BI App-owns-data status: `docs/powerbi-app-owns-data-status.md`

---

## 9. Suggested Study Order

Each stage builds on the last — auth and data flow first, since almost everything
else references them.

**Stage 1 — Ground yourself in the business (30-45 min)**
Read §1-2 of this doc, then skim `docs/project-study-guide.md`'s own quick index
targets in order: open `App.jsx` and trace how a user lands on either the Console
or the Portal. Don't read implementation detail yet — just follow the routing
decision (`roleFromGroups()` in `src/auth.js`) so you know *who sees what*.

**Stage 2 — Auth, since everything else assumes it (45-60 min)**
Read `src/auth.js` fully, then `lambda/TransportApi/Auth.cs` fully. Understand:
where the JWT comes from, how group membership decides admin vs. user, and why
the frontend and backend check independently rather than sharing one source of
truth. This is the single most load-bearing piece of the whole system — almost
every other file assumes you understand this first.

**Stage 3 — Core dispatch flow (1-2 hrs)**
Read `lambda/TransportApi/Function.cs` — don't try to read it top to bottom, trace
one real flow instead: `POST /emergencies` → vehicle assignment → `PutOps` →
`SweepDue()`'s background reconciliation. Cross-reference `OsrmService.cs` for how
ETA/distance is actually computed. This is the heart of the system; everything
else (analytics, tracking links, insights) is downstream of this data.

**Stage 4 — Frontend state + the three surfaces (1 hr)**
Read `src/store/useFleetStore.js`, then `src/portal/UserPortal.jsx` and
`src/features/track/TrackPage.jsx` side by side — notice how the public tracking
page deliberately does *not* share the authenticated store (`fraction()` is
reimplemented independently) since it has to work with zero auth.

**Stage 5 — Voice agent + OKF (30-45 min)**
Read `lambda/VoiceAgent/Function.cs`'s `LoadOkf()` and `ExtractSlots()`, then
`docs/okf-vs-rag.md` in full — this doc is dense but it's the clearest example in
the whole codebase of a documented, defensible engineering tradeoff. Understand it
well enough to explain *why* to someone else, not just *what*.

**Stage 6 — Analytics layer (1-2 hrs, can split across sessions)**
`infra/etl/oltp_to_olap.py` for the star schema shape, `infra/seed-history.mjs` for
how the synthetic historical data models real events, then
`src/features/insights/InsightsPage.jsx` for how that data surfaces in-app. Power
BI itself you can explore live rather than read code for.

**Stage 7 — Infra + the "gotchas" (30 min)**
Read `docs/powerbi-embed-security.md` and `docs/powerbi-app-owns-data-status.md`
last — these document real debugging trails (CORS existing at two separate layers,
Azure AD service-principal permission types) that will save you hours if you hit
similar issues later, but they only make sense once you understand the auth model
from Stage 2.

Total: roughly a full day of focused reading, spread across sessions is fine. The
goal isn't memorization — it's knowing *where* to look and *why* something was
built the way it was, which this doc plus the inline code comments throughout the
codebase are both written to support.
