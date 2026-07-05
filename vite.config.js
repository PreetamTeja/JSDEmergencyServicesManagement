import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // strictPort: fail instead of silently hopping ports, so the dev origin always
  // matches the API CORS allow-list (http://localhost:5173).
  server: { port: 5173, strictPort: true, open: true },
  test: {
    // tests/ holds the standalone Playwright/Selenium/smoke suites, each with
    // their own runner — vitest's default glob would otherwise also try (and
    // fail) to run them directly, the same "wrong runner" pattern as __jest__.
    exclude: ['**/node_modules/**', 'tests/**'],
  },
})
