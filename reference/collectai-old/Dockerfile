# Multi-stage Dockerfile for CollectAI Fullstack Application
# Stage 1: Build client
FROM node:20-alpine AS build-client
WORKDIR /app/client

# Copy client dependencies and source
COPY client/package*.json ./
RUN npm ci

COPY client/ ./
# Build arguments for Vite client environment variables (optional at build time)
ARG VITE_FIREBASE_API_KEY
ARG VITE_FIREBASE_AUTH_DOMAIN
ARG VITE_FIREBASE_PROJECT_ID
ARG VITE_FIREBASE_STORAGE_BUCKET
ARG VITE_FIREBASE_MESSAGING_SENDER_ID
ARG VITE_FIREBASE_APP_ID
ARG VITE_FIREBASE_MEASUREMENT_ID

RUN npm run build

# Stage 2: Production Server
FROM node:20-alpine AS production
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy server code
COPY src/ ./src/
COPY server.js ./

# Copy built frontend assets from builder stage
COPY --from=build-client /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
