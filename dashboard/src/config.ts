/** Base URL for the backend API and WebSocket. Empty in dev (vite.config.ts
 *  proxies /api, /ws and /stream to localhost:8010) and in any production
 *  deploy where the frontend and backend share an origin. Set VITE_API_BASE
 *  (e.g. https://your-backend.up.railway.app) when they're deployed
 *  separately, as with a Vercel frontend + Railway backend. */
// Optional-chained on `.env` itself, not just the property: this file is
// imported (transitively) by auth.check.ts, which runs under plain Node,
// where import.meta has no `env` at all -- only Vite's pipeline injects it.
export const API_BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '')

// Guarded the same way as API_BASE above: `location` doesn't exist under the
// plain Node this module also loads under (transitively, via auth.check.ts).
export const WS_URL = API_BASE
  ? `${API_BASE.replace(/^http/, 'ws')}/ws`
  : typeof location === 'undefined' ? ''
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
