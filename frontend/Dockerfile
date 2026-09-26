# Build context is the repository root: the frontend consumes the shared
# PilotAvailability/board modules from server/src/pilot through the `@pilot`
# alias, so both trees must be in the image. Build with
#   docker build -f frontend/Dockerfile .
# Build stage
FROM node:20-slim AS builder
WORKDIR /app/frontend

# Optional and never a credential. Empty means same-origin requests through
# the nginx proxy below, which also keeps the HttpOnly session cookies first-party.
ARG VITE_BACKEND_URL=
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

# Install dependencies
COPY frontend/package*.json ./
RUN npm ci

# Copy sources: the frontend plus the shared pilot modules it imports
COPY frontend/ ./
COPY server/src/pilot /app/server/src/pilot

# Build static assets
RUN npm run build

# Runtime stage (nginx to serve SPA)
FROM nginx:1.27-alpine AS runner
WORKDIR /usr/share/nginx/html

# Default backend for baked config (Railway internal network). Can be overridden at runtime.
ENV BACKEND_URL=http://vve.railway.internal:8000
ENV PORT=80

# Copy built assets
COPY --from=builder /app/frontend/dist ./

# Copy nginx template
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template

# Pre-generate nginx config so it works even if a custom start command bypasses our entrypoint.
RUN envsubst "\$BACKEND_URL \$PORT" < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# Create entrypoint script for env substitution
RUN echo '#!/bin/sh' > /docker-entrypoint.sh && \
    echo 'BACKEND_URL="${BACKEND_URL:-${VITE_BACKEND_URL:-http://vve.railway.internal:8000}}"' >> /docker-entrypoint.sh && \
    echo 'PORT="${PORT:-80}"' >> /docker-entrypoint.sh && \
    echo 'echo "BACKEND_URL is: $BACKEND_URL"' >> /docker-entrypoint.sh && \
    echo 'echo "PORT is: $PORT"' >> /docker-entrypoint.sh && \
    echo 'envsubst "\$BACKEND_URL \$PORT" < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf' >> /docker-entrypoint.sh && \
    echo 'echo "Generated nginx config:"' >> /docker-entrypoint.sh && \
    echo 'cat /etc/nginx/conf.d/default.conf' >> /docker-entrypoint.sh && \
    echo 'exec nginx -g "daemon off;"' >> /docker-entrypoint.sh && \
    chmod +x /docker-entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
