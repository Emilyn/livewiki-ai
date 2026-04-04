# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: build the Go binary ─────────────────────────────────────────────
FROM golang:1.25-alpine AS backend
WORKDIR /app
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# Embed the compiled frontend into the Go image so a single binary is deployed
COPY --from=frontend /app/frontend/dist ./static
RUN CGO_ENABLED=0 GOOS=linux go build -o server .

# ── Stage 3: minimal runtime image ───────────────────────────────────────────
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=backend /app/server  ./server
COPY --from=backend /app/static  ./static

# Railway mounts a volume at /data — uploads live there
ENV UPLOADS_DIR=/data/uploads
ENV STATIC_DIR=/app/static
ENV GIN_MODE=release

EXPOSE 8080
CMD ["./server"]
