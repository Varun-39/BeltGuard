import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Proxy both services through the dev server so the browser talks to one
// origin. Avoids CORS entirely and mirrors how this would sit behind a single
// reverse proxy on a real plant network.
//   :8010 - backend API + WebSocket   (8000 is taken by another local project)
//   :8001 - vision service MJPEG stream
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8010',
      '/ws': { target: 'ws://localhost:8010', ws: true },
      '/stream': 'http://localhost:8001',
      '/vision-state': {
        target: 'http://localhost:8001',
        rewrite: (p) => p.replace(/^\/vision-state/, '/state'),
      },
    },
  },
})
