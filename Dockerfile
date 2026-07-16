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

# The DB path lives in the image, not only in Railway's dashboard.
# It was dashboard-only: `mkdir -p /data` created the directory and nothing ever
# pointed at it, so persistence depended entirely on a variable set by hand in a
# UI the repo can't see or test. It IS currently set (prod's April assessments
# survived dozens of deploys), but a variable that can be renamed or dropped in a
# console is not a guarantee. Declaring it here makes the image self-sufficient;
# db.js now refuses to boot in production without it, so the two agree or nothing
# starts.
ENV DATABASE_PATH=/data/superior-os.db

EXPOSE 3002

CMD ["node", "server/index.js"]
