<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:0F2027,50:1B3B36,100:D9704A&amp;height=220&amp;section=header&amp;text=Tata%20Fleet%20Command&amp;fontSize=48&amp;fontColor=F4F1EA&amp;animation=fadeIn&amp;fontAlignY=38&amp;desc=Emergency%20Dispatch%2C%20Tracking%20%C2%B7%20Analytics%20for%20Tata%20Steel%2C%20Jamshedpur&amp;descSize=18&amp;descAlignY=58" width="100%"/>

<br/>

<img src="https://readme-typing-svg.demolab.com?font=JetBrains+Mono&amp;size=20&amp;duration=2600&amp;pause=900&amp;color=D9704A&amp;center=true&amp;vCenter=true&amp;width=780&amp;lines=Medical+%C2%B7+Fire+%C2%B7+Blood-Bank+Dispatch+in+One+Console;Live+GPS-style+tracking+on+a+Leaflet+map;Voice-driven+intake+powered+by+Amazon+Bedrock;ETL-fed+Power+BI+Analytics+%2B+AI+Insights;React+18+%C2%B7+.NET+8+Lambda+%C2%B7+DynamoDB+%C2%B7+AWS" alt="Typing SVG" />

<br/><br/>

![React](https://img.shields.io/badge/React_18-1B3B36?style=for-the-badge&logo=react&logoColor=D9704A)
![Vite](https://img.shields.io/badge/Vite_5-1B3B36?style=for-the-badge&logo=vite&logoColor=D9704A)
![.NET](https://img.shields.io/badge/.NET_8-1B3B36?style=for-the-badge&logo=dotnet&logoColor=D9704A)
![AWS Lambda](https://img.shields.io/badge/AWS_Lambda-1B3B36?style=for-the-badge&logo=awslambda&logoColor=D9704A)
![DynamoDB](https://img.shields.io/badge/DynamoDB-1B3B36?style=for-the-badge&logo=amazondynamodb&logoColor=D9704A)
![Cognito](https://img.shields.io/badge/Cognito_SSO-1B3B36?style=for-the-badge&logo=amazoncognito&logoColor=D9704A)
![Power BI](https://img.shields.io/badge/Power_BI-1B3B36?style=for-the-badge&logo=powerbi&logoColor=D9704A)
![Bedrock](https://img.shields.io/badge/Amazon_Bedrock-1B3B36?style=for-the-badge&logo=amazon&logoColor=D9704A)

<sup>internal package name: <code>tata-fleet-command</code> · 191 tracked files · ~25,081 lines of source</sup>

</div>

<br/>

## What this is

**JSD Emergency Services Management** is the dispatch console for Tata Steel's Jamshedpur township. One system coordinates three kinds of emergency response — **medical** (ambulance), **fire** (fire truck), and **blood** (courier runs between hospitals and blood banks) — from the moment a request comes in, through live map tracking, to completion.

It's not just a dashboard. It's a full operational stack: a self-service requester portal, a voice-driven intake agent, a policy-document ingestion agent, a nightly ETL pipeline feeding Power BI, and an AI Insights page built on the same historical data.

<br/>

## Who uses it

Two roles, resolved from Cognito group membership — nobody logs in to *this app* directly.

<table>
<tr>
<th>Admin — the Console</th>
<th>User — the Portal</th>
</tr>
<tr>
<td valign="top">

Control-room dispatchers get the full console: Dashboard, Emergencies, Dispatch Board, Live Map, Fleet & Crews, Power BI, AI Insights, Infra Health.

</td>
<td valign="top">

Hospital / requester staff get a simplified portal to create and track their own requests — plus a **voice-call intake** option instead of typing.

</td>
</tr>
</table>

A third, unauthenticated surface exists purely for share links — `/track/:id` — reading one emergency's live position through a tokenized public endpoint, no login involved.

<br/>

## System architecture

```mermaid
flowchart TD
    Browser["React 18 SPA<br/>Vite build"] -->|static assets| CF["CloudFront"]
    CF --> S3["S3 (SPA build)"]
    Browser -->|"/api/* same-origin"| APIGW["API Gateway HTTP API"]

    APIGW --> TA["TransportApi Lambda<br/>.NET 8"]
    APIGW --> VA["VoiceAgent Lambda<br/>.NET 8"]

    TA --> Auth["Auth.cs<br/>JWT · SSO cookie · x-api-key"]
    TA --> Dyn["DynamoService.cs"]
    TA --> Osrm["OsrmService · TrafficService"]
    TA --> CW["CloudWatchService.cs"]
    TA --> Bridge["SsoBridge.cs"]

    VA --> Bedrock["Amazon Bedrock — Nova Lite"]
    VA --> OKF["Flat-injected OKF knowledge<br/>infra/knowledge/*.md"]

    Dyn --> DDB[("DynamoDB<br/>fleet · emergencies · reference data<br/>historical synthetic · SsoReplayTokens")]

    ETL["Nightly EventBridge<br/>oltp_to_olap.py"] --> DDB
    ETL --> S3B["S3 — fact/dimension CSVs"]
    S3B --> PBI["Power BI"]

    style Browser fill:#1B3B36,stroke:#D9704A,color:#F4F1EA
    style TA fill:#0F2027,stroke:#D9704A,color:#F4F1EA
    style VA fill:#0F2027,stroke:#D9704A,color:#F4F1EA
    style DDB fill:#D9704A,stroke:#0F2027,color:#0F2027
    style PBI fill:#D9704A,stroke:#0F2027,color:#0F2027
```

<br/>

## Under the hood — the interesting decisions

This project has some genuinely thoughtful engineering tucked into it. A few worth calling out:

<details>
<summary><b>Tokens live in memory, never in storage</b></summary>
<br/>

`src/auth.js` deliberately keeps SSO tokens in a module-scope JS variable — not `localStorage`, not `sessionStorage`. Why: anything sitting in web storage is readable by any injected script or storage-capable browser extension for as long as the tab lives. An in-memory variable has no such read API and vanishes on reload. The cost is a lost session on hard refresh — accepted, because the parent SSO portal keeps its own session and just bounces the user back through with a fresh token.
</details>

<details>
<summary><b>Replay-proof SSO bridge</b></summary>
<br/>

The cookie-based SSO bridge doesn't trust JWT expiry alone — that only bounds *how long* a token is valid, not *how many times* it can be used. A DynamoDB conditional write (`attribute_not_exists(jti)`) against a dedicated replay-guard table enforces true single-use, with a 5-minute freshness window layered on top as defense-in-depth (widened from an original 30-second target once real portal-redirect latency measured 70–110 seconds).
</details>

<details>
<summary><b>Client-computed routing, server-verified completion</b></summary>
<br/>

Route geometry is computed client-side against OSRM (filtering detours beyond 1.4× the shortest option, then picking the lowest traffic-adjusted duration), but a live vehicle is never marked complete just because its marker reached the end of the line. The backend's own `eta_complete` timestamp — set once at dispatch — is the single source of truth for "is this trip actually over," so animation drift can never cause a false completion.
</details>

<details>
<summary><b>A voice agent with no vector database</b></summary>
<br/>

The Bedrock-powered voice intake agent uses zero retrieval infrastructure — no embeddings, no vector store. Instead it flat-injects the entire ~17KB knowledge bundle (locations, case types) into the prompt on every turn. For a fixed domain of 30 locations and 5 case types, this trades a small constant token overhead for *zero retrieval-failure surface* — the model can never fail to retrieve a fact that exists, because nothing is ever filtered out.
</details>

<details>
<summary><b>Power BI, two ways</b></summary>
<br/>

Both a plain iframe embed and a secure token-based "app owns data" embed are fully built — the frontend already branches on a feature flag between them. Production currently runs the iframe path while an Azure AD app-registration issue blocks the token path; flipping back requires no code changes, just the flag.
</details>

<br/>

## Tech stack

<div align="center">

| Layer | Stack |
|---|---|
| **Frontend** | React 18 · Vite 5 · react-router-dom v6 · Zustand · Tailwind CSS · Leaflet + `leaflet.heat` · Recharts |
| **Backend** | C# / .NET 8 on AWS Lambda (`TransportApi`, `VoiceAgent`) · API Gateway HTTP API |
| **Data** | DynamoDB only — fleet, emergencies, reference data, synthetic history, SSO replay guard |
| **Auth** | Amazon Cognito (shared pool, ~42 apps) + custom HMAC-signed SSO session bridge |
| **Voice** | Amazon Bedrock (Nova Lite) + flat-injected knowledge bundle |
| **Analytics** | Python ETL (stdlib + boto3) → star-schema CSVs → Power BI |
| **CI/CD** | GitHub Actions → OIDC → S3 + CloudFront + Lambda, gated by Vitest + Jest + xUnit |

</div>

<br/>

## Request lifecycle

```mermaid
sequenceDiagram
    participant U as Requester
    participant FE as React SPA
    participant API as TransportApi Lambda
    participant DB as DynamoDB

    U->>FE: Create emergency (kind, pickup, severity)
    FE->>API: POST /emergencies
    API->>DB: Assign vehicle (+ hospital if medical)
    DB-->>API: Dispatched record / incident_id
    API-->>FE: Response
    FE->>FE: hydrateLive() computes OSRM route
    loop every 1s while EN_ROUTE
        FE->>FE: Advance marker, traffic-scaled step
    end
    API-->>FE: eta_complete reached → COMPLETED
```

<br/>

## Testing — three layers, one gate

<div align="center">

![Vitest](https://img.shields.io/badge/Vitest-services_%26_store-1B3B36?style=flat-square&labelColor=0F2027&color=D9704A)
![Jest](https://img.shields.io/badge/Jest-React_components-1B3B36?style=flat-square&labelColor=0F2027&color=D9704A)
![xUnit](https://img.shields.io/badge/xUnit-.NET_Lambda-1B3B36?style=flat-square&labelColor=0F2027&color=D9704A)
![Playwright](https://img.shields.io/badge/Playwright-9_E2E_specs-1B3B36?style=flat-square&labelColor=0F2027&color=D9704A)

</div>

All three unit/component runners must pass before CI runs either deploy job. Nine Playwright specs drive the real app end-to-end, headlined by `golden-paths.spec.cjs` — the full dispatch flow, browser to browser.

<br/>

## Deployment

```mermaid
flowchart LR
    A["push to main"] --> B["Job 1: test<br/>Vitest + Jest + xUnit"]
    B --> C["Job 2: deploy-frontend<br/>Vite build → S3 → CloudFront invalidate"]
    B --> D["Job 3: deploy-lambdas<br/>TransportApi + VoiceAgent"]
    C -.parallel.- D

    style A fill:#0F2027,stroke:#D9704A,color:#F4F1EA
    style B fill:#1B3B36,stroke:#D9704A,color:#F4F1EA
    style C fill:#D9704A,stroke:#0F2027,color:#0F2027
    style D fill:#D9704A,stroke:#0F2027,color:#0F2027
```

No long-lived AWS keys anywhere — GitHub Actions authenticates via OIDC. A CodeCommit remote also exists alongside the GitHub origin, suggesting a mirrored legacy deploy path.

<br/>

<div align="center">

### Built for one township, three kinds of emergency, and the seconds that matter in between.

<img src="https://capsule-render.vercel.app/api?type=waving&amp;color=0:D9704A,50:1B3B36,100:0F2027&amp;height=120&amp;section=footer" width="100%"/>

</div>
