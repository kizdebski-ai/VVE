# WhiteVue Collaboration Suite

Modern collaborative whiteboard built on top of a TypeScript realtime backend and a Vue 3 client powered by Yjs.

## Architecture

- **Realtime backend** (`server/`)
  - Node.js + TypeScript (`express` + `ws`)
  - Hosts REST endpoints for room management and `/api/ai/solve-equation/`
  - Maintains in-memory Yjs documents and awareness over `/ws/whiteboard/:roomId`
- **Frontend** (`frontend/`)
  - Vue 3 + Vite SPA
  - Connects to the Node backend for room CRUD, WebSocket sync, and AI math assistance

> The former Django backend has been removed. The repository is now entirely TypeScript-driven on the server side.

## Prerequisites

- Node.js 18+
- npm 9+
- Optional: `OPENROUTER_API_KEY` for AI equation solving (via [openrouter.ai](https://openrouter.ai))

## Getting Started

### Backend
```bash
cd server
npm install
# Development server with auto-reload
npm run dev
# Production build & start
npm run build
npm start
```

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HOST` | `0.0.0.0` | Bind host for HTTP/WebSocket server |
| `PORT` | `8000` | Listen port |
| `OPENROUTER_API_KEY` | _(required for AI route)_ | API key used to talk to OpenRouter |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | Optional override for the model name |

> **Env files:** Copy `server/.env.example` to `server/.env` for non-sensitive defaults. Secrets such as `OPENROUTER_API_KEY` belong in `server/.env.secrets` (ignored) or should be injected through your platform (Railway, Docker secrets, etc.).

The backend exposes:
- `/health` – service status
- `/api/rooms` – CRUD endpoints for whiteboard rooms
- `/api/ai/solve-equation/` – OCR + LLM powered math completion (requires `OPENROUTER_API_KEY`)
- `/ws/whiteboard/:roomId` – Yjs document sync

### Frontend
```bash
cd frontend
npm install
npm run dev     # http://localhost:5173
npm run build   # production bundle
```

The client automatically points to `http://localhost:8000` when running in dev mode. Override via `VITE_BACKEND_URL` if you host the server elsewhere.

## Docker / Railway

- Build & run locally:
  ```bash
  docker compose build
  docker compose up
  ```
  Frontend: http://localhost:4173, Backend API/WebSocket: http://localhost:8000.
- Railway deploy (two services from this repo):
  1. **Backend service** �?" root directory `server`, Dockerfile auto-detected. Set env vars: `OPENROUTER_API_KEY` (if needed), `OCR_MODEL` / `SOLVER_MODEL` overrides, and let Railway provide `PORT`. No extra start command needed.
  2. **Frontend service** �?" root directory `frontend`, Dockerfile auto-detected. Set build arg/env `VITE_BACKEND_URL` to your backend public URL (e.g. `https://<backend-service>.up.railway.app`). Exposes port 80 by default.
  3. Optional: attach a volume to the backend service and mount it at `/data` to persist room data (`DATA_DIR` defaults there).

## Testing

Automated tests live in `server/tests/` (Vitest + Supertest).
```bash
cd server
npm run test
```

The suite exercises the `RoomManager` utility and the Express routes (including the AI endpoint with a stub solver). No outbound network requests occur during tests.

## Development Notes

- Yjs docs are kept in memory. Set up persistence or periodic backups for production use.
- The math recognizer on the frontend renders the equation canvas locally, runs OCR via `tesseract.js`, and sends the extracted text to `/api/ai/solve-equation/`.
- Customize the AI prompt/temperature in `server/src/services/aiSolver.ts` if you need different behavior.
- The cleanup routine removes inactive rooms (default TTL 30 minutes). Adjust `roomTtlMs` within `server/src/config.ts` for your workload.

## License

Provided as-is for experimentation. Adapt and harden before deploying to production.
