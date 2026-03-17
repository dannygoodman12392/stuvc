# ── Build stage: compile the React client ──
FROM node:20-alpine AS builder

WORKDIR /app

# Install client dependencies
COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm install

# Copy client source and build
COPY client/ ./client/
RUN cd client && npx vite build

# ── Production stage ──
FROM node:20-alpine

WORKDIR /app

# Install server dependencies
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev

# Copy server source
COPY server/ ./server/

# Copy built client into server's expected path
COPY --from=builder /app/client/dist ./client/dist

# Create data directory for persistent SQLite volume
RUN mkdir -p /data

# Railway injects PORT env var
ENV NODE_ENV=production

EXPOSE 3002

CMD ["node", "server/index.js"]
