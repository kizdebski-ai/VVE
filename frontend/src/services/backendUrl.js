// Utility to produce a safe backend base URL for API/WS calls.
// - Prefers VITE_BACKEND_URL when provided.
// - In Vite dev (ports 5173/4173) falls back to http://localhost:8000.
// - When the page is served over HTTPS and the backend URL is HTTP (mixed content),
//   it falls back to the current origin so requests can flow through the frontend's nginx proxy.
const stripTrailingSlash = (value) => (value || '').replace(/\/+$/, '');

export function resolveBackendBaseUrl() {
  const inBrowser = typeof window !== 'undefined';
  const devFallback =
    inBrowser && import.meta?.env?.DEV && (window.location.port === '5173' || window.location.port === '4173')
      ? 'http://localhost:8000'
      : '';

  const rawEnv = import.meta?.env?.VITE_BACKEND_URL || '';
  const fallbackOrigin = inBrowser ? window.location.origin : '';
  const candidate = rawEnv.trim() || devFallback || fallbackOrigin;

  if (!candidate) return '';

  try {
    const url = new URL(candidate, fallbackOrigin || 'http://localhost');
    // Avoid mixed content: if page is HTTPS but backend is HTTP, route via current origin (nginx proxy).
    if (inBrowser && window.location.protocol === 'https:' && url.protocol === 'http:') {
      return stripTrailingSlash(fallbackOrigin);
    }
    return stripTrailingSlash(`${url.protocol}//${url.host}`);
  } catch (error) {
    return stripTrailingSlash(fallbackOrigin || devFallback || candidate);
  }
}

export function resolveWsUrl(roomId) {
  const inBrowser = typeof window !== 'undefined';
  const base = resolveBackendBaseUrl() || (inBrowser ? window.location.origin : '');
  if (!roomId) return '';
  try {
    const url = new URL(base, inBrowser ? window.location.origin : 'http://localhost');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    // If the page is HTTPS, force WSS to avoid mixed content.
    if (inBrowser && window.location.protocol === 'https:' && url.protocol === 'ws:') {
      url.protocol = 'wss:';
    }
    url.pathname = url.pathname.replace(/\/+$/, '') + `/ws/whiteboard/${roomId}`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch (error) {
    if (!inBrowser) return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/whiteboard/${roomId}`;
  }
}
