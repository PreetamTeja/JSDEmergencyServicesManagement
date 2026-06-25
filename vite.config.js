import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // strictPort: fail instead of silently hopping ports, so the dev origin always
  // matches the API CORS allow-list (http://localhost:5173).
  server: { port: 5173, strictPort: true, open: true },
})
