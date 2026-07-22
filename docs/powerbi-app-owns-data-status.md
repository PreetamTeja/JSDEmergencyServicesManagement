# Power BI "App owns data" — Status (on hold as of 2026-07-13)

## Current state

The Analytics page is reverted to the plain iframe embed
(`VITE_POWERBI_SECURE=false` in `.env.local`/`.env.production`) so it works today.
Nothing about the "App owns data" setup was deleted — it's paused, not undone.

## What's already done and still in place

- **Backend code**: `GET /powerbi/embed-token` is fully implemented in
  `lambda/TransportApi/Function.cs` (~line 273) — calls Azure AD for a service-principal
  token, then the Power BI REST API to generate a report embed token. Gated by the
  same admin-group check (`ADMIN_GROUPS`) as every other admin route.
- **Backend env vars** — all five are set on the `psiog-transport-api` Lambda right now:
  `PBI_TENANT_ID`, `PBI_CLIENT_ID`, `PBI_CLIENT_SECRET`, `PBI_WORKSPACE_ID`, `PBI_REPORT_ID`.
- **Frontend code**: `PowerBIPage.jsx` already branches on `VITE_POWERBI_SECURE` —
  `true` renders `PowerBIReport.jsx` (token-based embed, no Power BI login prompt),
  anything else renders the iframe. No further code changes needed to switch back on.
- **Fabric trial capacity** is active, workspace ID and report ID confirmed correct.

## What's blocking it

Azure AD is rejecting the service principal's client-credentials token request:

```
AADSTS700016: Application with identifier '<client-id>' was not found in the
directory 'psiog.com'. This can happen if the application has not been installed
by the administrator of the tenant or consented to by any user in the tenant.
```

This was reproduced by directly calling Azure AD's token endpoint with the exact
credentials stored on the Lambda (bypassing the app entirely), confirming the issue
is on the Azure AD app-registration side, not a typo or bug in our code.

## What's already been ruled out

- Not a copy-paste error in our env vars — confirmed by testing the live Lambda's
  exact stored credentials directly against Azure AD.
- Not the "secret ID vs secret value" mistake (hit once earlier, already corrected).

## What's still unverified — next steps when resuming

1. Confirm the app registration's **Directory (tenant) ID** matches
   `8399c1c2-9c1b-4d0d-97fb-e0cfed231878` (psiog's main tenant).
2. Confirm a **service principal actually exists** for this app under
   **Microsoft Entra ID → Enterprise applications** (a different blade than
   App registrations — an app registration existing there doesn't guarantee a
   service principal was provisioned in this tenant).
3. Confirm **admin consent** is granted (green check, not a warning triangle) on
   the app's API permissions for Power BI Service (`Report.Read.All`).
4. Once resolved, no code changes are needed — just flip `VITE_POWERBI_SECURE=true`
   in both env files, rebuild, and redeploy the frontend.

## To resume

Flip `VITE_POWERBI_SECURE=true`, rebuild (`npm run build`), redeploy
(`infra/deploy-frontend.sh`). If Azure AD credentials changed in the meantime,
update the Lambda's `PBI_CLIENT_ID`/`PBI_CLIENT_SECRET` first (merge into existing
env vars via `aws lambda update-function-configuration`, don't replace wholesale).
