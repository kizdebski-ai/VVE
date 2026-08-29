# Build stage
FROM node:20-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY knexfile.ts ./
COPY src ./src
COPY migrations ./migrations

RUN npm run build

# Runtime stage
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

COPY package*.json ./
RUN npm ci --omit=dev

# Ensure data directory exists for persistence
RUN mkdir -p /data

# Copy compiled code
COPY --from=builder /app/dist ./dist

# Copy pure JavaScript migrations (not TypeScript!)
COPY migrations-js ./migrations-js

EXPOSE 8000

CMD ["node", "dist/src/server.js"]
