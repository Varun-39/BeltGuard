import { networkInterfaces } from 'node:os'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Backs the "open on phone" QR code: the browser can't ask the OS for the
 *  machine's LAN address itself, so the dev server (which can) hands it out.
 *  Dev-only by construction -- `vite build` never runs `configureServer`, so
 *  a production bundle has no such endpoint and the QR feature degrades to
 *  its manual-URL fallback. */
function lanIpPlugin(): Plugin {
  return {
    name: 'lan-ip',
    configureServer(server) {
      server.middlewares.use('/__lan-ip', (_req, res) => {
        const ip = Object.values(networkInterfaces()).flat()
          .find((a) => a && a.family === 'IPv4' && !a.internal)?.address
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ip: ip ?? null }))
      })
    },
  }
}

// Proxy both services through the dev server so the browser talks to one
// origin. Avoids CORS entirely and mirrors how this would sit behind a single
// reverse proxy on a real plant network.
//   :8010 - backend API + WebSocket   (8000 is taken by another local project)
//   :8001 - vision service MJPEG stream
export default defineConfig({
  plugins: [react(), tailwindcss(), lanIpPlugin()],
  server: {
    port: 3000,
    host: true,          // bind 0.0.0.0: required for a phone on the same LAN to reach this
    proxy: {
      '/api': 'http://localhost:8010',
      '/ws': { target: 'ws://localhost:8010', ws: true },
      '/stream': 'http://localhost:8001',
    },
  },
})
