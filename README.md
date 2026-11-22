# Stubwise

Pay stubs and pay records for US employers with one to five workers.
Stubwise makes pay stub PDFs and keeps records. It never pays workers and never files taxes.

## What is in this repository

| Path | What it is |
|---|---|
| `packages/domain` | Pay calculations in pure TypeScript: money in cents, hours and minutes, pay periods, stub totals, year to date. No React, no I/O. |
| `packages/templates` | The pay stub document model and the template library (Classic, Modern, Compact, Ledger). Data in, print-ready HTML out. |
| `apps/mobile` | The iPhone and iPad app (Expo, Expo Router, SQLite on the device). |
| `apps/api` | The API (Fastify, Postgres): stub calculation and rendering endpoints, and opt-in cloud backup. |

The app and the API import the same `domain` and `templates` packages, so a stub is
calculated and laid out by the same code wherever it is produced.

## How the pieces fit

- **The phone is the source of truth.** Workers and stubs live in SQLite on the device, stubs are
  calculated on the device and the PDF is made on the device. The app works with no network.
- **The API is optional for the app.** It offers the same calculations over HTTP
  (`/v1/stubs/compute`, `/v1/stubs/draft-next`, `/v1/stubs/render`) for other clients, and a
  whole-snapshot backup (`/v1/backup`) that a user turns on. On backup the server recalculates
  every hourly line and rejects a snapshot whose amounts do not match its hours and rate.
- **Year to date is never stored.** It is recomputed from the worker's starting balances and saved
  stubs each time, which is why it cannot drift.

## Getting started

Requires Node 22 or newer and pnpm.

```bash
pnpm install
pnpm test        # shared packages and API
pnpm typecheck   # every package
```

Run the API (uses an embedded database in `apps/api/.pgdata` unless `DATABASE_URL` is set):

```bash
cp apps/api/.env.example apps/api/.env
pnpm api
```

Run the mobile app in the iOS simulator:

```bash
pnpm mobile
```

## API summary

All `/v1` endpoints except `/v1/meta` and `POST /v1/devices` need `Authorization: Bearer <device token>`.

| Method and path | Purpose |
|---|---|
| `GET /health` | Liveness and database check |
| `GET /v1/meta` | API version and the template library |
| `POST /v1/devices` | Register a device; returns its token once |
| `POST /v1/stubs/compute` | Totals and year to date for a stub |
| `POST /v1/stubs/draft-next` | The next pay period's draft stub |
| `POST /v1/stubs/render` | A stub as HTML in a chosen template |
| `PUT /v1/backup` | Replace this device's backup |
| `GET /v1/backup` | Fetch this device's backup |
| `DELETE /v1/backup` | Delete the backup and the device registration |

Errors are always `{ "error": { "code", "message", "details"? } }`.

## Conventions

- Money is an integer number of cents everywhere. Time worked is whole minutes. Dates are `YYYY-MM-DD` strings.
- New database changes are new entries in `apps/api/src/db/migrations.ts`; shipped migrations are never edited.
- Anything typed by a user is escaped before it reaches stub HTML (`packages/templates/src/html.ts`).

## Tax calculation

Taxes are calculated on the device, in `packages/domain/src/tax`. Rates and
brackets live in dated data files under `tax/data`, one per tax year, copied
from the official publications named at the top of each file.

| What | Status |
| --- | --- |
| Federal income tax | IRS Pub. 15-T (2026) percentage method, 2020-or-later Form W-4. Tested against the IRS wage bracket table. |
| Social Security, Medicare | 2026 rates, the $184,500 wage base, and Additional Medicare Tax past $200,000. |
| States with no wage income tax | AK, FL, NV, NH, SD, TN, TX, WA, WY: no state line. |
| States calculated | IL, KY, NC, PA. Each is tested against the worked example in that state's own 2026 guide (PA has only a flat rate). |
| The other 37 states and DC | Not built yet. The stub gets a state tax line to fill in by hand. |

Not handled: tax years other than 2026, Forms W-4 from 2019 or earlier,
pre-tax deductions (taxable wages are gross pay), local taxes, other
worker-paid state payroll taxes, and employer-side taxes.

To add a state: read its employer withholding guide, add its rule to
`tax/data/states-<year>.ts` with the source and the date read, and write a test
from the guide's own worked examples.

