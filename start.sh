#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Load .env if it exists
if [ -f "$ROOT/.env" ]; then
  export $(grep -v '^#' "$ROOT/.env" | xargs)
fi

echo "Starting MDF Viewer..."
echo ""

# Start backend
cd "$ROOT/backend"
go build -o mdf-viewer-server . && ./mdf-viewer-server &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID (http://localhost:8080)"

# Start frontend
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID (http://localhost:5173)"

echo ""
echo "Open http://localhost:5173 in your browser."
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
