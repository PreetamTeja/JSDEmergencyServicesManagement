# Power BI Embed Security: Current State and Recommended Path

## 1. What we run today: "Website or portal" secure embed

The Analytics page (`src/features/dashboard/PowerBIPage.jsx`, reading
`VITE_POWERBI_EMBED_URL`) embeds the report via an iframe pointed at:

```
https://app.powerbi.com/reportEmbed?reportId=<id>&autoAuth=true&ctid=<our-tenant-id>
```

This is **not** "Publish to Web" (which is fully public, no auth, and disabled by our
tenant's org policy anyway). It is Power BI's authenticated portal-embed pattern:

- `ctid` pins the report to our specific Microsoft Entra tenant. An account outside
  that tenant cannot open the link at all, regardless of whether they have it.
- `autoAuth=true` triggers a live Microsoft sign-in check on load — silent if the
  browser already has a session in our tenant, otherwise an interactive login prompt
  inside the iframe.
- Once signed in, Power BI checks that account against the report's **workspace
  Access list** before rendering anything. No entry on that list, no data.

This is genuinely access-controlled, not link-based "security by obscurity." Anyone
who obtains the URL (it is not secret — it ships inside our public JS bundle) still
needs (a) a Microsoft account inside our Entra tenant, and (b) an explicit grant on
the workspace Access list.

## 2. Why this is a reasonable baseline

- No credential or token is exposed client-side — auth happens entirely inside
  Power BI's own hosted sign-in flow, which we don't manage or touch.
- The two real controls (`ctid` tenant restriction + workspace Access list) are both
  enforced server-side by Power BI, not by anything in our own code that could have a
  bug.
- Zero infrastructure cost: no Premium/PPU capacity, no service principal, no token
  minting/rotation logic to maintain or that could fail open.
- Appropriate for a small, known set of viewers who already hold legitimate Microsoft
  accounts in our tenant and have been explicitly added to the workspace.

## 3. The real gap: two identity systems, not one

This is the part worth being direct about. Our application's own authorization model
is Cognito-based: a user signs in via the shared Jamshedpur SSO pool
(`eu-central-1_74er6Yfnf`), and `src/auth.js:roleFromGroups()` (backed by
`VITE_ADMIN_GROUPS`) plus the backend's mirrored check in
`lambda/TransportApi/Auth.cs:IsAdminGroups()` (backed by `ADMIN_GROUPS`) decide who
gets admin-console access.

Power BI's workspace Access list has **no knowledge of Cognito whatsoever**. It is a
completely separate Entra-identity population. Concretely:

- Someone can be a valid Entra/Microsoft user in our tenant, added to the Power BI
  workspace, and view the full report **with no Cognito account, no login to our app,
  and no `MainAdmin`/`transport-admin` group membership at all** — simply by opening
  the raw `reportEmbed` URL in a browser signed into their Microsoft account.
- Conversely, being `MainAdmin` in Cognito grants zero automatic Power BI access —
  someone has to separately remember to add that person to the Power BI workspace.
- The two access lists can silently drift apart over time (someone leaves the admin
  Cognito group but is never removed from the Power BI workspace, or vice versa) with
  no code path that keeps them in sync.
- There is no Row-Level Security configured on the dataset today, so anyone who clears
  the above gate sees every row — all zones, all patient demographic fields, no
  per-viewer scoping.

None of this makes the current setup "insecure" in the sense of being open to the
public internet — it isn't. It means access is currently governed by whoever
maintains the Power BI workspace membership list by hand, independently of the
authorization logic the rest of the application enforces everywhere else.

## 4. Why "App owns data" is the better fit here

The "App owns data" embedding pattern collapses this to one identity system instead
of two:

1. The frontend requests an embed token from **our own backend**
   (`api.getPowerbiToken()`, already implemented in `PowerBIReport.jsx`), sending the
   same Cognito JWT the rest of the app already uses.
2. The backend endpoint checks that JWT against `ADMIN_GROUPS` — the exact same check
   that gates every other admin API route today — before it will mint anything.
3. Only if that check passes does the backend call the Power BI REST API, using a
   service principal, to generate a short-lived embed token (rotated ~2 minutes
   before expiry, per the existing `useEffect` refresh logic in `PowerBIReport.jsx`).
4. The viewer's browser never talks to Power BI's own sign-in flow at all. There is no
   standalone report URL to open outside our app — the embed token is the only way in,
   and it's minted per-session, per-authorized-user, and expires.

This directly closes every gap in section 3:

- **One authorization system.** `ADMIN_GROUPS`/Cognito group membership is the single
  source of truth for who can see the report — the same list that already governs the
  rest of the admin console. Nothing to keep in sync by hand.
- **No standalone access point.** Since there's no public-facing `reportEmbed` link at
  all in this model, a Microsoft account with workspace access but no relationship to
  our app can no longer see the data — because there's nothing for it to authenticate
  against outside our own backend.
- **Tokens expire.** Unlike the current static URL, a leaked or logged embed token is
  only useful for minutes, not indefinitely.
- **Room for real per-user scoping.** Row-Level Security can be layered on later, with
  the RLS role selected server-side based on the same JWT claims already being
  checked — e.g., scoping a zone-level admin to only their own zone's rows.

## 5. What it costs to switch

The application code for this already exists and is unused today, deferred earlier
for exactly this reason:

- `src/features/dashboard/PowerBIReport.jsx` — full embed-token flow, token refresh,
  error handling. Already correct, just not wired to a live backend.
- Backend endpoint expecting `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`,
  `PBI_WORKSPACE_ID`, `PBI_REPORT_ID` — needs a real Entra app registration
  (service principal) and those five values set as Lambda env vars.
- Power BI **Premium, Premium Per User (PPU), or Embedded** capacity assigned to the
  workspace — "App owns data" embedding requires the workspace to sit on paid
  capacity; a normal Pro workspace cannot serve embed tokens this way. This is the
  one real cost/approval item, and worth confirming before starting the migration.

## 6. Recommendation

Keep the current portal-embed method as-is for now — it is not broken, and closing
the workspace Access list to a tight, audited list of named individuals (already in
progress) meaningfully narrows the practical gap. But treat "App owns data" as the
target state, not an optional nice-to-have, specifically because dispatch data here
includes real patient GPS coordinates, medical case types, and demographics — data
where "governed by whoever remembers to update a Power BI workspace list" is a weaker
guarantee than we want long-term. Migrate once Premium/PPU/Embedded capacity is
confirmed available.
