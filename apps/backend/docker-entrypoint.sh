#!/bin/sh
# Brings the database schema up to date, then starts the server.
# If the database cannot be reached the container exits, so a bad deploy is
# visible at once and never serves requests against a missing schema.
set -e

echo "stubwise: applying database migrations"
if ! alembic upgrade head; then
  echo "stubwise: migrations failed. Check DATABASE_URL and that the database exists and is reachable." >&2
  exit 1
fi

echo "stubwise: starting server on ${HOST:-0.0.0.0}:${PORT:-4000}"
# Behind Coolify's proxy: trust its forwarded headers so client IPs and https are seen correctly.
exec uvicorn --factory app.main:create_app \
  --host "${HOST:-0.0.0.0}" --port "${PORT:-4000}" \
  --proxy-headers --forwarded-allow-ips "*"
