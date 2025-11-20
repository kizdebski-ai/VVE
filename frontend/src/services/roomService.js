const resolveDefaultOrigin = () => {
  if (typeof window === 'undefined') return '';
  const { protocol, hostname, port } = window.location;
  if (import.meta.env?.DEV && (!port || port === '5173' || port === '4173')) {
    return `${protocol}//${hostname}:8000`;
  }
  return window.location.origin;
};

const DEFAULT_ORIGIN = resolveDefaultOrigin();
const API_ORIGIN = (import.meta.env?.VITE_BACKEND_URL || DEFAULT_ORIGIN || '').replace(/\/+$/, '');
const API_BASE = `${API_ORIGIN}/api/rooms`;

const withTrailingSlash = (url) => (url.endsWith('/') ? url : `${url}/`);

const getCsrfToken = () => {
  if (typeof document === 'undefined') return '';
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
};

async function handleResponse(response) {
  let payload = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
  }

  if (!response.ok) {
    const message = payload?.error || payload?.message || `Room API request failed (HTTP ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function buildHeaders(ownerSecret) {
  return {
    'Content-Type': 'application/json',
    'X-CSRFToken': getCsrfToken(),
    ...(ownerSecret ? { 'X-Owner-Secret': ownerSecret } : {}),
  };
}

const collectionUrl = () => withTrailingSlash(API_BASE);
const detailUrl = (roomId) => withTrailingSlash(`${API_BASE}/${encodeURIComponent(roomId)}`);

if (import.meta.env?.DEV) {
  // eslint-disable-next-line no-console
  console.info('[RoomService] Using room API base:', collectionUrl());
}

export async function fetchRooms(options = {}) {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.includeArchived) params.set('include_archived', '1');
  if (options.limit) params.set('limit', String(options.limit));

  const url = params.toString() ? `${collectionUrl()}?${params}` : collectionUrl();
  const response = await fetch(url, {
    credentials: 'same-origin',
  });
  return handleResponse(response);
}

export async function createRoom(payload) {
  const response = await fetch(collectionUrl(), {
    method: 'POST',
    headers: buildHeaders(),
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function updateRoom(roomId, payload, ownerSecret) {
  const response = await fetch(detailUrl(roomId), {
    method: 'PATCH',
    headers: buildHeaders(ownerSecret),
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
}

export async function archiveRoom(roomId, ownerSecret) {
  const response = await fetch(detailUrl(roomId), {
    method: 'DELETE',
    headers: buildHeaders(ownerSecret),
    credentials: 'same-origin',
    body: JSON.stringify({ ownerSecret }),
  });
  return handleResponse(response);
}
