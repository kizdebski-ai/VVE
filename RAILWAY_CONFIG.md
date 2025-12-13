# Railway Deployment Configuration

## Environment Variables

### Backend (Server)

These environment variables must be set in the **server** service on Railway:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string (Railway provides this automatically) |
| `ADMIN_SECRET` | ✅ | Secret key for admin API authentication (must match `VITE_ADMIN_SECRET`) |
| `OPENROUTER_API_KEY` | ⚠️ | API key for OpenRouter AI services (required for AI features) |
| `NODE_ENV` | ⚠️ | Set to `production` for production deployments |
| `PORT` | ❌ | Automatically provided by Railway |
| `TEACHER_APP_BASE_URL` | ⚠️ | Base URL for teacher magic links (e.g., `https://your-app.up.railway.app`) |

### Frontend

These environment variables must be set in the **frontend** service on Railway.

⚠️ **IMPORTANT**: `VITE_*` variables are **compiled at build time**, not runtime! After changing them, you MUST trigger a new deployment/rebuild.

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_ADMIN_SECRET` | ✅ | Must match `ADMIN_SECRET` on server |
| `VITE_BACKEND_URL` | ⚠️ | Backend URL (e.g., `https://server.up.railway.app`). Often not needed if nginx proxies to same domain. |

## Troubleshooting

### 401 Unauthorized on Admin Panel

If you see `401 Unauthorized` errors when accessing `/api/admin/teachers`:

1. **Check Backend logs** - Look for messages like:
   - `"Admin request blocked because ADMIN_SECRET env var is not configured"` → Set `ADMIN_SECRET` on server
   - `"Admin auth failed - secret mismatch"` → Secrets don't match

2. **Check Browser console** - Look for:
   - `"Admin secret status: { isSet: false }"` → `VITE_ADMIN_SECRET` not set during build
   - `"prefix: 'NOT_SET'"` → Secret is empty

3. **Fix the issue:**
   ```bash
   # On Railway:
   # 1. Set ADMIN_SECRET on server service
   # 2. Set VITE_ADMIN_SECRET on frontend service (SAME VALUE!)
   # 3. IMPORTANT: Trigger a new frontend deployment (VITE_ vars need rebuild)
   ```

### UUID Error: "invalid input syntax for type uuid"

If you see errors like:
```
invalid input syntax for type uuid: "rnYnlKN4enl94DUfgkgqi1"
```

This happens when:
- A non-UUID room ID (like nanoid) is treated as a database board
- **Fix applied**: `boardYjsPersistence.ts` now validates UUID format before querying

Non-UUID room IDs work fine - they're just treated as ephemeral rooms (not persisted to DB).

### Database Migrations

Migrations run automatically on server start. If they fail:

```bash
# Check logs for migration errors
# Tables might already exist - that's usually OK
```

## Service Dependencies

```
┌─────────────┐      ┌─────────────┐
│  Frontend   │ ──→  │   Server    │ ──→  PostgreSQL
│   (Vite)    │      │  (Node.js)  │
└─────────────┘      └─────────────┘
      ↓
  nginx proxy at /api/* → server
```

## Quick Setup Checklist

- [ ] PostgreSQL database created (Railway provides this)
- [ ] `DATABASE_URL` set on server
- [ ] `ADMIN_SECRET` set on server
- [ ] `VITE_ADMIN_SECRET` set on frontend (same as `ADMIN_SECRET`)
- [ ] Frontend rebuilt after setting `VITE_*` variables
- [ ] `OPENROUTER_API_KEY` set on server (for AI features)
- [ ] `TEACHER_APP_BASE_URL` set on server
