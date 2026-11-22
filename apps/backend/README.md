# CrewStub backend

The server for CrewStub, a pay stub app for US employers with 1–5 workers. Python 3.11, FastAPI, SQLAlchemy 2, Postgres in production (SQLite for development and tests).

It does four things:

- **Accounts.** Sign in with Google or Apple; the server issues its own sessions.
- **Records.** A user's business, workers and pay stubs, with the server as the system of record.
- **Calculations.** A Python port of `packages/domain` (pay, pay periods, year-to-date, federal and state withholding), held to the TypeScript original by generated test cases.
- **Import/export.** `PUT/GET/DELETE /v1/backup` moves a user's whole data set in one snapshot.

Tax form e-filing through TaxBandits is written but **parked** — see [Filing](#filing-parked).

Money is integer cents, worked time is whole minutes, dates are `YYYY-MM-DD` strings. Every error is `{"error": {"code", "message", "details"?}}`.

## Run it locally

```sh
cd apps/backend
uv sync
uv run alembic upgrade head                       # creates ./stubwise.db (SQLite)
uv run uvicorn --factory app.main:create_app --port 4000
```

Open <http://127.0.0.1:4000/docs> for the API reference. With no environment set the server runs in development mode. To use settings from a file, copy `.env.example` to `.env` and start with `uv run --env-file .env uvicorn ...`.

Signing in needs a real Google or Apple ID token, so for local work there is a seed script. It creates a sample account with three workers and prints a refresh token to exchange at `POST /v1/auth/refresh`:

```sh
uv run python scripts/seed.py
```

Checks:

```sh
uv run pytest            # in-memory SQLite
uv run ruff check
TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/some_empty_db uv run pytest   # same suite on Postgres
```

`TEST_DATABASE_URL` must name a database used for nothing else: every test drops and recreates all tables.

## Deploy

The image is built from this folder alone (`Dockerfile`, build context `apps/backend`).

| Variable | Required | Meaning |
| --- | --- | --- |
| `APP_ENV` | yes | `production`. Turns on the start-up checks below and HSTS, and turns `/docs` off. |
| `DATABASE_URL` | yes | `postgresql://user:pass@host:port/db`. `postgres://` is accepted too. |
| `AUTH_JWT_SECRET` | yes | Signs access tokens. At least 32 characters; `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Changing it signs everyone out for up to 15 minutes (until their app refreshes). |
| `GOOGLE_CLIENT_IDS` | one of these | Comma-separated OAuth client IDs accepted as a Google ID token's `aud` (the iOS, Android and web client IDs). |
| `APPLE_CLIENT_IDS` | one of these | Comma-separated values accepted as an Apple identity token's `aud`: the app's bundle ID, plus a Services ID if there is a web sign-in. |
| `HOST`, `PORT` | no | Listen address. The image defaults to `0.0.0.0` and `4000`. |
| `LOG_LEVEL` | no | `info` by default. |
| `CORS_ALLOWED_ORIGINS` | no | Exact browser origins, comma-separated. Empty (default) means no CORS; the mobile app needs none. |
| `DOCS_ENABLED` | no | `true` serves `/docs` and `/openapi.json` in production. |
| `RATE_LIMIT_PER_MINUTE`, `AUTH_RATE_LIMIT_PER_MINUTE`, `WRITE_RATE_LIMIT_PER_MINUTE` | no | 300 per client address, 20 per address on sign-in routes, 120 changes per user. |
| `REFRESH_TOKEN_DAYS` | no | 60. |

With `APP_ENV=production` the process refuses to start, naming the variable, if `DATABASE_URL` or `AUTH_JWT_SECRET` is missing, the secret is too short, or neither sign-in provider is configured.

**Health checks.** `GET /health` is liveness: no authentication, no database, answers at once. Point the platform's health check at it. `GET /ready` also runs `SELECT 1` and returns 503 when the database does not answer.

**Migrations.** The schema is managed by Alembic (`migrations/`). The container's entrypoint runs `alembic upgrade head` before starting the server and exits non-zero if that fails, so a deploy against an unreachable database never goes live. Alembic reads `DATABASE_URL` from the same settings as the app. After changing `app/models.py`:

```sh
uv run alembic revision --autogenerate -m "what changed"
```

A test fails if the models and the migrations disagree. `python -m app.migrate` does the same upgrade with two additions — it waits up to `DB_WAIT_SECONDS` (30) for the database and takes a Postgres advisory lock so two instances starting together do not migrate at once. The entrypoint does not use it today; switch to it before running more than one instance.

**Behind a proxy.** Rate limits are per client address, so the server must be told the real address. The entrypoint passes `--proxy-headers --forwarded-allow-ips "*"`, which is right when the container is reachable only through the platform's proxy. If the port is ever published directly, restrict that value to the proxy's address, or clients can spoof `X-Forwarded-For`.

**One instance.** Rate limits live in process memory. Several instances would each allow the full rate; move the limiter to a shared store before scaling out.

`docker-compose.backend.yml` runs the image with its own Postgres. `ci-backend.yml` is a GitHub Actions workflow to move into `.github/workflows/`.

## Accounts

`POST /v1/auth/google` takes `{ idToken }`; `POST /v1/auth/apple` takes `{ identityToken, fullName? }` (Apple gives the app the name only on the first sign-in). The server verifies the token against the provider's published keys — signature (RS256), `iss`, `aud` against the configured client IDs, `exp`, and for Google `email_verified` — and caches the keys for as long as the provider's `Cache-Control` allows. If the token carries a `nonce`, the request must carry the same value.

It then issues its own session:

- an **access token** (JWT, 15 minutes), sent as `Authorization: Bearer`. It is checked against the database on every request, so signing out or deleting the account takes effect immediately;
- a **refresh token**, random, stored only as a SHA-256 hash, and replaced on every use (`POST /v1/auth/refresh`). Presenting a refresh token a second time means it was copied: the whole session is revoked.

`POST /v1/auth/logout`, `GET /v1/auth/sessions` and `DELETE /v1/auth/sessions/{id}` manage sessions. `GET/PATCH /v1/me` is the profile; `GET /v1/me/export` returns everything held about the user; `DELETE /v1/me` deletes the account and all its data.

**Google and Apple sign-ins are separate accounts, even with the same email.** An account is identified by `(provider, subject)`, never by email address. Merging by email would let whoever controls an address at one provider take over an account created through the other, Apple users can hide their address behind a relay, and Google's own guidance is to key on `sub`. Linking two sign-ins to one account can be added later as an explicit, signed-in action.

**Device tokens are gone.** The earlier API (`apps/api`, and the first version of this service) registered a device and stored its backup under an anonymous token. Every route now needs a signed-in user, and `POST /v1/devices` no longer exists. Data stored under device tokens is not migrated: the app keeps its records locally and can upload them with `PUT /v1/backup` after sign-in.

`users.plan` is `free` for everyone. `app/plans.py` maps a plan to what it allows (`entitlements(plan)`); there is no billing.

An audit log records sign-ups, sign-ins, sign-outs, refresh-token reuse, exports, imports and account deletion — ids and counts only. The entry for a deleted account is kept; it holds the old account id and a time.

## Records

All under `/v1`, all scoped to the signed-in user. A record that belongs to someone else is reported as not found.

| | |
| --- | --- |
| `GET/POST/PATCH/DELETE /business` | One business per user for now; the table allows more. |
| `GET/POST /workers`, `GET/PATCH/DELETE /workers/{id}` | Fields match `Worker` in `apps/mobile/src/db/types.ts`, including `taxProfile` with `w4` and `stateW4`. |
| `GET /stubs`, `GET/PATCH/DELETE /stubs/{id}` | `PATCH` changes the period or pay date and recalculates taxes. |
| `POST /workers/{id}/stubs/next` | Drafts and saves the worker's next stub. |
| `POST /stubs/batch` | This period's stub for every worker without one. |
| `PUT /stubs/{id}/lines` | Replaces the lines; hourly amounts and calculated tax lines are recomputed. |

Every stub response carries `totals`, `ytd` and `taxStatus`, computed on each read and never stored.

- **Pagination.** Lists take `limit` (1–200, default 50) and `cursor`, and return `{ items, nextCursor }`.
- **Retries.** `POST` requests accept an `Idempotency-Key` header: repeating the request returns the first response (with `Idempotency-Replayed: true`) instead of creating a second record. Keys are kept for 24 hours.
- **Lost updates.** Each record has a `version`. Send `If-Match: <version>` with a change and it fails with 412 `version_conflict` if the record changed since it was read. Without the header the last write wins.
- **`today`.** Stub actions accept `{ "today": "YYYY-MM-DD" }`, the date where the user is. Without it the server uses the UTC date, which is already tomorrow during US evenings.

As in the app, changing one stub does not rewrite later ones: a later stub's Social Security or Additional Medicare figure is refreshed the next time that stub is saved.

`PUT /v1/backup` replaces all of a user's records with a snapshot (all or nothing), `GET` exports them, `DELETE` removes them and keeps the account. The snapshot keeps the original backup format so an older app's backup still imports. **Ids are not preserved on import**: rows get new server ids, so read them back after importing.

## Calculations

`app/domain/` is a line-for-line port of `packages/domain/src`: pure functions, integers only. The TypeScript is the specification.

- **Tax figures are never typed into Python.** `app/domain/data/tax-data.json` is a byte-for-byte copy of `packages/domain/parity/tax-data.json`, which is generated from the TypeScript data files. Refresh it with `uv run python scripts/sync_tax_data.py`; a test fails when the two differ.
- **Parity.** `tests/test_parity.py` runs every case in `packages/domain/parity/vectors.json` through the port and requires exact equality. When the TypeScript changes: regenerate the vectors, run the sync script, then make the tests pass.
- **State rules load from the data.** Adding a state with the existing rule shape needs no Python change. A rule `kind` this code does not implement stops the server at start-up instead of withholding nothing.

Stateless endpoints for the app, all requiring sign-in: `POST /v1/calc/stub`, `/taxes`, `/ytd`, `/next-stub`, `/pay-period`. `GET /v1/meta/tax-coverage` (public) lists, per loaded tax year, each state as `none`, `calculated` or `manual`, with the state certificate's labels where there is one.

Not ported: the display formatters for dates (`formatShortDate` and friends), and rendering stubs to HTML or PDF, which stays in the app.

## Filing (parked)

W-2 and 1099-NEC e-filing through TaxBandits (API v2.0.0) is implemented and tested against a mock, and has **never been run against TaxBandits**, not even the sandbox. It is off: the `/v1/filing/consent` and `/v1/filings` routes are mounted only when `FILING_ENABLED=true` **and** `TAXBANDITS_CLIENT_ID`, `TAXBANDITS_CLIENT_SECRET` and `TAXBANDITS_USER_TOKEN` are all set (`TAXBANDITS_ENV` is `sandbox` unless set to `production`). Otherwise those paths answer 404.

How it works when on: the user records consent (`POST /v1/filing/consent`); `POST /v1/filings` validates the request and creates the forms at TaxBandits without sending them anywhere; `POST /v1/filings/{id}/transmit` sends them to the IRS/SSA as a separate, irreversible step; `GET /v1/filings` reports status. Full SSNs, TINs and EINs go to TaxBandits and are not stored or logged here — the database keeps the last four digits.

Before turning it on, resolve the points marked `# UNVERIFIED:` in `app/taxbandits.py` and `app/taxbandits_payloads.py` against the sandbox:

1. Whether the token request's `Authentication` header takes the bare JWS (the docs' table) or `Bearer <JWS>` (the docs' prose).
2. Whether endpoint paths are case-insensitive; the docs spell them inconsistently.
3. The body of 400/404 error responses from Create and Transmit; only the field list was readable.
4. Whether `NameCtrl` (business) and, for tax year 2026, `TTOC1` (W-2) are required. Neither is sent.
5. Whether Status accepts several `recordIds` in one call; one call per record is made.

One more for Apple sign-in, marked in `app/auth/providers.py`: Apple's "Verifying a user" page says to verify "the JWS E256 signature", while Apple's OpenID configuration lists only RS256 and its published keys are RSA. Only RS256 is accepted.

## Layout

```
app/
  main.py            application factory, router and middleware wiring
  config.py          settings from the environment, validated at start-up
  models.py  db.py   tables; engine and session
  schemas.py         request and response shapes for records and backup
  calc_schemas.py    request shapes for /v1/calc
  errors.py  logs.py middleware.py  rate_limit.py  plans.py  migrate.py
  auth/              provider token verification, sessions, request dependencies
  domain/            the calculation port (+ data/tax-data.json)
  services/          records, stubs, backup, account, audit, idempotency
  routes/            system, auth, records, calc, filing
  filing.py  filing_schemas.py  taxbandits.py  taxbandits_payloads.py   (parked)
migrations/          Alembic
scripts/             sync_tax_data.py, seed.py
tests/
```
