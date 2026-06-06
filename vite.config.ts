import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Edge functions live in functions/ and target the Deno runtime — keep them
// out of the Vite/browser build.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
})
