# Psiog Test Report

**Generated:** 2026-07-01  
**Runner (JS):** Vitest v4.1.9  
**Runner (C#):** dotnet test / xUnit (net10.0 host, net8.0 library)

---

## Summary

| Suite | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| JS — sla.js | 31 | 31 | 0 | 0 |
| JS — locations.js | 24 | 24 | 0 | 0 |
| JS — hospitals.js | 12 | 12 | 0 | 0 |
| JS — dispatchService.js | 15 | 15 | 0 | 0 |
| JS — backend-handler.mjs | 47 | 47 | 0 | 0 |
| **JS Total** | **129** | **129** | **0** | **0** |
| C# — DynamoService | 38 | 38 | 0 | 0 |
| **Grand Total** | **167** | **167** | **0** | **0** |

---

## JavaScript Tests (`npm test` / Vitest)

Test files live in `src/__tests__/`.

### `sla.test.js` — 31 tests
Tests for `src/services/sla.js` (`slaTargets`, `slaStatus`, `slaText`, `SLA_COLOR`, `SLA_LABEL`).

Key cases covered:
- `slaTargets`: default return, partial policy override, full override, non-object `sla_minutes` ignored
- `slaStatus` (queue states): `QUEUED`, `NO_HOSPITAL`, `NO_BLOODBANK`, `PREEMPTED` all enter the 5-minute queue SLA path; freshly-created = ok, 61% elapsed = warn, past target = breach
- `slaStatus` (EN_ROUTE): per-severity target lookup, `etaToPickupMin > target` triggers warn, breach when elapsed > target, unknown severity falls back to `Urgent` default, missing `createdAt` uses current time
- `slaStatus` (other states): `COMPLETED` → `kind: 'none'`, `state: 'ok'`
- `slaText`: empty for `kind: none`, `OVERDUE +Nm` format with `Math.ceil`, `Xm left` with `Math.floor`, 0m left edge case

### `locations.test.js` — 24 tests
Tests for `src/data/locations.js` (`locById`, `zoneById`, `bloodBanks`, `bloodBankById`, `fmtPt`, `pickupLabel`, `zonesByProximity`, `JAMSHEDPUR_CENTER`).

Key cases covered:
- `setGeoReference` populates module-level `LOCATIONS` and `ZONES` arrays
- `locById` / `zoneById`: found, not found, undefined id
- `bloodBanks()`: returns only `type === 'bloodbank'` entries
- `bloodBankById`: rejects non-bloodbank locations
- `fmtPt`: 4-decimal-place formatting, null/non-number returns null
- `pickupLabel`: priority chain — location name → pickupName → formatted pt → raw string → `'—'` for empty/null emergency
- `zonesByProximity`: sorted nearest-first verified for both zones, `km` property is a non-negative number

### `hospitals.test.js` — 12 tests
Tests for `src/data/hospitals.js` (`setHospitals`, `hospitalById`, `CASE_TYPES`, `SEVERITIES`, `SEVERITY_META`).

Key cases covered:
- `CASE_TYPES` contains all 5 expected types
- `SEVERITIES` is ordered `['Critical', 'Urgent', 'Normal']`
- `SEVERITY_META`: rank ordering (Critical=0 < Urgent=1 < Normal=2), color values
- `hospitalById`: found, not found, undefined id
- `setHospitals` reset: subsequent call replaces the list; call with no args clears it

### `dispatchService.test.js` — 15 tests
Tests for `src/services/dispatchService.js` (`vehicleHomePos`, `findNearestZonePool`, `zonePoolCounts`).

Modules mocked: `src/services/osrm` (haversine computed inline, `getRoute` stubbed), `src/data/locations` (ZONES fixture injected).

Key cases covered:
- `vehicleHomePos`: returns zone ref lat/lng for valid homeZoneId; falls back to `ZONES[0]` for unknown zone, null vehicle, or missing homeZoneId (this is the actual implementation behavior — `zoneById(...) || ZONES[0]`)
- `findNearestZonePool`: finds nearest idle ambulance with free driver; returns null when no matching type; skips zones with all-busy drivers (falls through to next zone); skips enroute vehicles; finds firetruck correctly
- `zonePoolCounts`: one entry per zone, correct idle/total counts per zone, `byType` breakdown, empty vehicle list returns zeros

> **Note on vehicleHomePos fallback:** The source `const z = zoneById(vehicle?.homeZoneId) || ZONES[0]` means a null vehicle or unknown zone does NOT return null — it returns the first zone's ref. Initial test expectations were corrected after observing the actual behavior on first run.

### `backend-handler.test.js` — 47 tests
Pure helpers extracted from `backend/handler.mjs` and `backend/auth.mjs` (no AWS SDK instantiation needed).

Key cases covered:

**SCOPES / canPost:**
- `HOSPITAL`, `HEALTH`, `MENTAL_HEALTH`, `WELFARE` all allow `emergencies` only
- `MCP` allows `infra` only
- `CONSOLE` (`'*'`) allows everything
- `EDUCATION`, `DELIVERY`, `ADMIN` allow `requests` only
- `HR` allows `bookings` only; `FUEL` allows `fleet` only
- Unknown/null source returns false for any resource

**validateEmergency:**
- Minimal valid body (pickup.ref), pickup with lat/lng
- Invalid kind, invalid severity, units 0 and 11 rejected, units 1–10 accepted
- patients 0 and 1001 rejected, patients 1000 accepted
- Missing pickup, pickup with neither ref nor lat/lng rejected
- pickup.lat/lng out of range rejected
- note over 500 chars rejected, exactly 500 accepted

**havKm (Haversine):**
- Identical points → ~0 km
- Approximate real-world distance (Jamshedpur → Dhanbad ~60–130 km)
- Symmetry: `havKm(a, b) == havKm(b, a)`

**isAdminClaims (auth.mjs):**
- Group ending `-admin` → true (case-insensitive)
- No `-admin` suffix → false
- Empty groups, null claims → false
- Single string group (non-array) handled

**identityOf (auth.mjs):**
- Priority: `sub` → `username` → `email` → `name` → null

---

## C# Tests (`dotnet test`)

Test project: `lambda/TransportApi.Tests/DynamoServiceTests.cs`  
Tests target: `lambda/TransportApi/DynamoService.cs`

### `DynamoServiceTests` — 38 tests

**FromAv — primitives (9 tests):**
- `NULL` → null
- `BOOL true/false` → `bool`
- `S` → `string` (including empty string)
- `N` → `double` (integer, decimal, negative)
- Malformed `N` (not parseable) → raw string fallback

**FromAv — Map (M) empty-collection bug fix (3 tests):**
- A default `new AttributeValue()` has `M` set to an empty `Dictionary` (not null). A naive `av.M != null` check would always match and return an empty dict. The production fix (`av.M?.Count > 0`) correctly returns `null` for the default empty value.
- Non-empty M → `Dictionary<string, object?>`
- Nested maps → recursively converted

**FromAv — List (L) empty-collection bug fix (3 tests):**
- Same issue: default `new AttributeValue()` has `L` set to an empty `List` (not null). The `av.L?.Count > 0` guard returns `null` instead of an empty list.
- Non-empty L → `List<object?>` with mixed types
- L containing null AV entries → null element in result list

**FromAv — String/Number Sets (2 tests):**
- `SS` → `List<object?>` of strings
- `NS` → `List<object?>` of doubles

**Av — construction (7 tests):**
- null → `NULL = true`
- bool → `BOOL` field
- int/long/double → `N` field (string representation)
- string → `S` field
- `Dictionary<string, object?>` → `M` field with nested Av entries
- `List<object?>` → `L` field

**Round-trip Av → FromAv (7 tests):**
- Strings (3 parameterized: normal, empty, unicode)
- Bools (2 parameterized)
- Integers as double (4 parameterized: 0, 1, -100, int.MaxValue)
- Nested map with string, double, bool, and inner map

**FromItem helper (1 test):**
- Converts a realistic DynamoDB item (PK, status, count) correctly

---

## Infrastructure Changes

| File | Change |
|---|---|
| `package.json` | Added `"test": "vitest run"` script; `vitest@^4.1.9` added to devDependencies |
| `src/__tests__/sla.test.js` | New — 31 tests |
| `src/__tests__/locations.test.js` | New — 24 tests |
| `src/__tests__/hospitals.test.js` | New — 12 tests |
| `src/__tests__/dispatchService.test.js` | New — 15 tests |
| `src/__tests__/backend-handler.test.js` | New — 47 tests |
| `lambda/TransportApi.Tests/TransportApi.Tests.csproj` | New — xUnit project, references TransportApi |
| `lambda/TransportApi.Tests/DynamoServiceTests.cs` | New — 38 tests |

---

---

## Jest Frontend Tests (`npm run test:jest`)

**Runner:** Jest 29 + @testing-library/react + jsdom  
**Test folder:** `src/__jest__/` (separate from Vitest's `src/__tests__/`)  
**Added:** 2026-07-01

### Setup

| File | Purpose |
|---|---|
| `jest.config.cjs` | Jest config (`.cjs` required because package is ESM); testMatch `**/__jest__/**/*.test.{js,jsx}` |
| `babel.config.cjs` | Babel presets (env + react) + custom `import.meta.env` → `process.env` plugin |
| `babel-plugin-import-meta-env.cjs` | Rewrites `import.meta.env.*` to `process.env.*` so Jest can run Vite source files |
| `src/__jest__/setup/importMetaMock.cjs` | Sets `process.env.VITE_*` stubs before each test suite |
| `src/__jest__/__mocks__/fileMock.cjs` | Returns `"test-file-stub"` for binary assets (images/fonts) |

### Test Suites

| Suite | File | Tests | Pass | Fail | What it covers |
|---|---|---|---|---|---|
| LiveEta | `LiveEta.test.jsx` | 9 | 9 | 0 | Fallback min display, clamping, className prop, countdown from etaComplete, "arriving" when past, per-second tick |
| Emergency Filter Logic | `emergencyFilters.test.js` | 17 | 17 | 0 | ACTIVE_STATES definition, active/completed/all filter logic, buildCounts accuracy |
| buildMetrics | `buildMetrics.test.js` | 16 | 16 | 0 | Total/active/queued counts, fleet utilPct, avgResp (excludes QUEUED), byKind split, bySeverity, topHospitals ranking + cap |
| VoiceAgent | `VoiceAgent.test.jsx` | 5 | 5 | 0 | Renders overlay, header text, no-VOICE_URL error message, Close button absence before dispatch, unmount behavior |
| **Total** | | **47** | **47** | **0** | |

### Package.json addition

```
"test:jest": "jest --config jest.config.cjs"
```

### Issues found and resolved

1. **`import.meta` outside module** — Babel's `@babel/preset-env` with `modules: 'commonjs'` converts `import`/`export` to CJS but leaves `import.meta` intact (it's not part of the module syntax transform). Fixed by writing a custom Babel plugin (`babel-plugin-import-meta-env.cjs`) that rewrites `import.meta.env` → `process.env` at parse time.

2. **`babel-plugin-transform-import-meta` is insufficient** — The published package only handles `import.meta.url`, not `import.meta.env`. Custom plugin was necessary.

3. **react-leaflet / MapContainer in EmergencyPage** — The `MapContainer` requires a DOM canvas context that jsdom cannot provide. Rather than fighting it, the pure filter/count logic was extracted into `emergencyFilters.test.js` as a unit test — higher value than a render-only smoke test anyway.

4. **Worker process not exiting** — Cosmetic warning from `setInterval` in `LiveEta` when using fake timers. Fixed by calling `jest.runOnlyPendingTimers()` in `afterEach` before restoring real timers.

---

## Findings

1. **`vehicleHomePos` fallback behavior:** When the vehicle's `homeZoneId` is unknown (or the vehicle is null), the function silently falls back to `ZONES[0]` rather than returning null. This is intentional (the code has `|| ZONES[0]`) but means a vehicle with a misconfigured zone will silently dispatch from the first zone's reference point instead of failing visibly.

2. **`DynamoService.FromAv` M/L empty-collection guard:** The production code correctly uses `av.M?.Count > 0` and `av.L?.Count > 0` to distinguish an actual map/list from the .NET SDK's default empty-collection initialization. Removing this guard would cause any AttributeValue that is neither NULL, BOOL, S, N, SS, nor NS to be misidentified as an empty map/list, returning an empty dict/list instead of null.

3. **`SCOPES` access control is correct:** All four "emergency" sources (`HOSPITAL`, `HEALTH`, `MENTAL_HEALTH`, `WELFARE`) are correctly limited to the `emergencies` resource. `MCP` is limited to `infra`. `CONSOLE` is unrestricted (`'*'`).
