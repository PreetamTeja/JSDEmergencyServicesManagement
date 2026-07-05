// Shared mock fixtures + route-mocking helpers for both Playwright and
// Selenium suites, so expanded interaction tests (bulk actions, pagination,
// booking flow) have real, varied data to click through instead of empty
// lists that only prove a page didn't crash.
const SAMPLE_VEHICLES = {
  vehicles: [
    { id: 'AMB-1', reg: 'JH01AB1234', type: 'ambulance', status: 'idle', home_zone_id: 'zone-bistupur', fuel: 83, odometer: 12000 },
    { id: 'AMB-2', reg: 'JH01AB5678', type: 'ambulance', status: 'idle', home_zone_id: 'zone-sonari', fuel: 91, odometer: 8000 },
    { id: 'AMB-3', reg: 'JH01AB9999', type: 'ambulance', status: 'enroute', home_zone_id: 'zone-kadma', fuel: 52, odometer: 15000 },
    { id: 'FT-1', reg: 'JH01FT1035', type: 'firetruck', status: 'idle', home_zone_id: 'zone-factory', fuel: 41, odometer: 20000 },
    { id: 'AMB-4', reg: 'JH01AB1111', type: 'ambulance', status: 'maintenance', home_zone_id: 'zone-sakchi', fuel: 31, odometer: 5000 },
  ],
  drivers: [
    { id: 'DRV-1', name: 'Bikash Soren', status: 'available', home_zone_id: 'zone-bistupur' },
    { id: 'DRV-2', name: 'P. Roy', status: 'available', home_zone_id: 'zone-sonari' },
  ],
}

const SAMPLE_EMERGENCIES = {
  emergencies: [
    { id: 'EMG-000001', kind: 'medical', case_type: 'Cardiac', severity: 'Critical', status: 'EN_ROUTE', pickup: { ref: 'loc-1' }, assigned_vehicle_id: 'AMB-3', created_at: new Date().toISOString(), patients_count: 1 },
    { id: 'EMG-000002', kind: 'medical', case_type: 'Trauma', severity: 'Urgent', status: 'QUEUED', pickup: { ref: 'loc-2' }, created_at: new Date().toISOString(), patients_count: 1 },
    { id: 'EMG-000003', kind: 'fire', severity: 'Critical', status: 'COMPLETED', pickup: { ref: 'loc-3' }, created_at: new Date(Date.now() - 3600_000).toISOString(), patients_count: 1 },
    { id: 'EMG-000004', kind: 'medical', case_type: 'General', severity: 'Normal', status: 'NO_HOSPITAL', pickup: { ref: 'loc-1' }, created_at: new Date().toISOString(), patients_count: 1 },
  ],
}

const SAMPLE_INSIGHTS = {
  record_count: 5500,
  date_range: { from: '2021-07-03T00:00:00Z', to: '2026-06-29T00:00:00Z' },
  placement_recommendations: [
    { zone_id: 'zone-sonari', calls: 1496, current_staging: { lat: 22.786, lng: 86.164 }, recommended_staging: { lat: 22.79, lng: 86.16 }, nearest_landmark: 'Sonari Colony', drift_km: 0.68, recommendation: 'Reposition the standby unit toward Sonari Colony.' },
  ],
  staffing_recommendations: [
    { zone_id: 'zone-sonari', peak_hour: 18, peak_hour_calls_per_day: 1.9, avg_service_min: 34, recommended_units: 2, rationale: 'Peak hour 18:00 needs 2 units.' },
  ],
  peak_windows: [
    { window: 'Evening shift-change · 17:00-20:00', calls_per_hour: 2.4, multiplier_vs_overnight_baseline: 5.3, recommendation: 'Scale up 5.3x.' },
  ],
  seasonal_alerts: [
    { event_name: 'Diwali fire-cracker season', historical_calls: 87, multiplier_vs_average_day: 1.6, recommendation: 'Pre-position extra units.' },
  ],
}

const SAMPLE_COVERAGE_GAPS = {
  record_count: 5500,
  date_range: { from: '2021-07-03T00:00:00Z', to: '2026-06-29T00:00:00Z' },
  zones: [{ zone_id: 'zone-sonari', avg_eta_to_pickup_min: 8.25, gap_ratio: 2.08 }],
  coverage_gaps: [{ zone_id: 'zone-sonari', avg_eta_to_pickup_min: 8.25, avg_distance_km: 6.4, calls: 1343, sla_breach_pct: 8.7, gap_ratio: 2.08, recommendation: 'Consider a dedicated unit.' }],
}

const SAMPLE_INFRA_METRICS = {
  invocations: 500, errors: 1, error_rate_pct: 0.2, throttles: 0, duration_avg_ms: 320, duration_p99_ms: 6500, cold_starts: 0,
  recent_errors: [{ timestamp: new Date().toISOString(), message: 'ERROR ANALYTICS_ERROR sample error for testing' }],
  series: { invocations: [], errors: [], duration_avg: [] },
}

// Playwright-style: (page, opts) => Promise<void>, registers all common routes.
async function mockPlaywright(page) {
  await page.route('**/fleet', (r) => r.fulfill({ json: SAMPLE_VEHICLES }))
  await page.route('**/ops', (r) => r.fulfill({ json: SAMPLE_EMERGENCIES }))
  await page.route('**/analytics/insights', (r) => r.fulfill({ json: SAMPLE_INSIGHTS }))
  await page.route('**/analytics/coverage-gaps', (r) => r.fulfill({ json: SAMPLE_COVERAGE_GAPS }))
  await page.route('**/infra/metrics*', (r) => r.fulfill({ json: SAMPLE_INFRA_METRICS }))
  await page.route('**/emergencies', (r) => {
    if (r.request().method() === 'POST') {
      // Shape useFleetStore.createEmergency() actually reads: id, status,
      // assigned_vehicle_id (resolved against the /fleet list above).
      return r.fulfill({ json: { id: 'EMG-TEST01', status: 'EN_ROUTE', assigned_vehicle_id: 'AMB-1' } })
    }
    return r.continue()
  })
  await page.route('**/requests/*/cancel', (r) => r.fulfill({ json: { ok: true } }))
  await page.route('**/emergencies/*/cancel', (r) => r.fulfill({ json: { ok: true } }))
  await page.route('**/fleet/*/status', (r) => r.fulfill({ json: { ok: true } }))
}

module.exports = { SAMPLE_VEHICLES, SAMPLE_EMERGENCIES, SAMPLE_INSIGHTS, SAMPLE_COVERAGE_GAPS, SAMPLE_INFRA_METRICS, mockPlaywright }
