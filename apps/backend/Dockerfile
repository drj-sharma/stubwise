# Stubwise backend. Build context is this folder (apps/backend).
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/srv/.venv \
    PATH="/srv/.venv/bin:$PATH" \
    HOST=0.0.0.0 \
    PORT=4000

WORKDIR /srv

# curl is what Coolify's health check calls inside the container.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, from the lockfile, so code changes do not reinstall them.
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh \
    && useradd --system --uid 10001 --no-create-home stubwise \
    && chown -R stubwise /srv
USER stubwise

EXPOSE 4000

# Liveness only: the process answers. /ready also checks the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-4000}/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
