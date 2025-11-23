# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy sources
COPY . .

# Backend URL available at build time for Vite
ARG VITE_BACKEND_URL=http://localhost:8000
ENV VITE_BACKEND_URL=${VITE_BACKEND_URL}

# Build static assets
RUN npm run build

# Runtime stage (nginx to serve SPA)
FROM nginx:1.27-alpine AS runner
WORKDIR /usr/share/nginx/html

# Copy built assets
COPY --from=builder /app/dist ./

# Replace default nginx config to support SPA routing
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
