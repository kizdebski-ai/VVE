# WhiteVue Collaboration Suite
A full-stack collaborative whiteboard composed of a Django + Channels backend and a Vue 3 + Vite frontend powered by Yjs realtime synchronization.
## Architecture
- **Backend** (backend/) *(legacy – kept for reference only)*
  - Django 5 with Django REST Framework for health/status endpoints.
  - Channels + Daphne manage WebSocket traffic.
  - Redis support is enabled when `REDIS_URL` is set; otherwise the in-memory channel layer is used for development.
- **Realtime Server** (server/)
  - Node.js + TypeScript runtime (`express` + `ws`) inspired by Excalidraw’s architecture.
  - Maintains Yjs docs & awareness in memory and exposes `/ws/whiteboard/:roomId`.
  - `npm run dev` (inside `server/`) starts the collaboration backend on port `8000`.
- **Frontend** (frontend/)
- Redis 6+ (optional in development; set `REDIS_URL` to enable the Redis channel layer)
```bash
# Realtime backend
cd server
npm install
npm run dev
```
```bash
# Frontend
cd frontend
npm install
npm run dev
```
- npm run build  (frontend/) produce a production bundle.
- python manage.py check  validate Django configuration.
- python manage.py test  run backend tests (currently placeholders).
- Update backend/backend/settings.py with deployment-ready SECRET_KEY, database, and allowed hosts.
- frontend/src/services/connectToYjs.ts contains the WebSocket URL template; adjust when serving the backend under a different host/port.
- Pass a room query parameter (e.g., ?room=team-session) to join or create a collaborative session.
This project is provided as-is for demonstration purposes. Adapt and extend to match your production requirements.
cd frontend
npm install
npm run dev
`

The dev server defaults to http://localhost:5173 and talks to the backend running on http://localhost:8000.

## Scripts

- 
pm run dev – start the Vite dev server.
- 
pm run build – produce a production bundle.
- python manage.py check – validate Django configuration.
- python manage.py test – run backend tests (currently placeholders).

## Configuration

- Update ackend/backend/settings.py with deployment-ready SECRET_KEY, database, and allowed hosts.
- rontend/src/services/connectToYjs.ts contains the WebSocket URL template; adjust when serving backend under a different host/port.
- Pass a oom query parameter (e.g., ?room=team-session) to join or create a collaborative session.

## Development Notes

- The backend stores Yjs document snapshots per room in WhiteboardRoom. Periodic cleanup can be implemented if rooms are ephemeral.
- Movable objects (shapes, images, plots) are rendered via Vue components, whereas freehand strokes remain on the canvas for better performance.
- Enable debugMode in App.vue while building new features to surface internal state logs.

## License

This project is provided as-is for demonstration purposes. Adapt and extend to match your production requirements.
