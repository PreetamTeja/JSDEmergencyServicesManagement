// Flattens Playwright's nested JSON-reporter output into the same simple
// {results:[{name,status,duration_ms}], generated_at} shape the Selenium
// and smoke runners already write, so one PDF template can render all three.
const fs = require('fs')
const path = require('path')

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'playwright-results.json'), 'utf8'))
const results = []

function walk(suite, prefix = '') {
  for (const spec of suite.specs || []) {
    const test = spec.tests?.[0]
    const run = test?.results?.[0]
    results.push({
      name: `${prefix}${spec.title}`,
      status: run?.status === 'passed' ? 'passed' : 'failed',
      duration_ms: run?.duration ?? 0,
      error: run?.status !== 'passed' ? (run?.error?.message || 'failed') : undefined,
    })
  }
  for (const sub of suite.suites || []) walk(sub, prefix)
}
for (const s of raw.suites || []) walk(s)

fs.writeFileSync(
  path.join(__dirname, 'playwright-results-normalized.json'),
  JSON.stringify({ results, generated_at: new Date().toISOString() }, null, 2)
)
console.log(`Normalized ${results.length} Playwright test results`)
