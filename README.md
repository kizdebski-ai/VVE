# WhiteVue Collaboration Suite

A full-stack collaborative whiteboard composed of a Django + Channels backend and a Vue 3 + Vite frontend powered by Yjs realtime synchronization.

## Architecture

- **Backend** (ackend/)
  - Django 5 with Django REST Framework for health/status endpoints.
  - Channels + Daphne manage WebSocket traffic.
  - Redis is required for channels_redis and should be running locally (edis-server) or reachable via the CHANNEL_LAYERS config.
  - SQLite is bundled for convenience; swap to PostgreSQL/MySQL when deploying.
- **Frontend** (rontend/)
  - Vue 3 single page app bundled by Vite.
  - Yjs manages shared document state, and Awareness provides cursor/presence data.
  - Plotting/handwriting helpers live under src/modules and are optional.

## Prerequisites

- Node.js 20+
- npm 10+
- Python 3.13+
- Redis 6+ (for Channels)

## Backend Setup

`ash
cd backend
python -m venv .venv
.\.venv\Scripts\activate  # PowerShell on Windows
pip install -r requirements.txt
python manage.py migrate
`

Start the backend during development:

`ash
redis-server  # Run in a separate terminal if not already running
python manage.py runserver 0.0.0.0:8000
`

Use daphne backend.asgi:application behind a production-grade HTTP proxy when deploying.

## Frontend Setup

`ash
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
