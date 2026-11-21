import type { Db } from './client';

/**
 * Migrations are append-only: never edit one that has shipped, add a new one.
 * They live in code (not loose .sql files) so the same list runs in tests,
 * in development and in production without any path handling.
 */
const MIGRATIONS: readonly { id: string; sql: string }[] = [
  {
    id: '0001_init',
    sql: `
      CREATE TABLE devices (
        id          uuid PRIMARY KEY,
        token_hash  text NOT NULL UNIQUE,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE businesses (
        device_id         uuid PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
        id                text NOT NULL,
        name              text NOT NULL,
        address           text NOT NULL,
        phone             text NOT NULL,
        employer_id       text,
        pay_schedule      text NOT NULL CHECK (pay_schedule IN ('weekly','biweekly','semimonthly','monthly')),
        show_employer_id  boolean NOT NULL,
        template_id       text NOT NULL,
        accent            text NOT NULL,
        saved_at          timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE workers (
        device_id           uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        id                  text NOT NULL,
        name                text NOT NULL,
        address             text NOT NULL,
        type                text NOT NULL CHECK (type IN ('employee','contractor')),
        pay_type            text NOT NULL CHECK (pay_type IN ('hourly','salary')),
        rate_cents          integer NOT NULL CHECK (rate_cents >= 0),
        default_deductions  jsonb NOT NULL,
        starting_ytd        jsonb,
        position            integer NOT NULL,
        PRIMARY KEY (device_id, id)
      );

      CREATE TABLE stubs (
        device_id     uuid NOT NULL,
        id            text NOT NULL,
        worker_id     text NOT NULL,
        period_start  date NOT NULL,
        period_end    date NOT NULL,
        pay_date      date NOT NULL,
        created_at    timestamptz NOT NULL,
        PRIMARY KEY (device_id, id),
        FOREIGN KEY (device_id, worker_id) REFERENCES workers(device_id, id) ON DELETE CASCADE,
        CHECK (period_end >= period_start)
      );
      CREATE INDEX stubs_worker_pay_date ON stubs (device_id, worker_id, pay_date);

      CREATE TABLE stub_lines (
        device_id     uuid NOT NULL,
        stub_id       text NOT NULL,
        position      integer NOT NULL,
        kind          text NOT NULL CHECK (kind IN ('earning','deduction')),
        label         text NOT NULL,
        minutes       integer CHECK (minutes IS NULL OR minutes >= 0),
        rate_cents    integer CHECK (rate_cents IS NULL OR rate_cents >= 0),
        amount_cents  integer NOT NULL CHECK (amount_cents >= 0),
        source        text NOT NULL CHECK (source IN ('manual','calculated')),
        PRIMARY KEY (device_id, stub_id, position),
        FOREIGN KEY (device_id, stub_id) REFERENCES stubs(device_id, id) ON DELETE CASCADE
      );
    `,
  },
];

export async function migrate(db: Db): Promise<string[]> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id          text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    );
  `);
  const applied = new Set((await db.query<{ id: string }>('SELECT id FROM schema_migrations')).map((row) => row.id));
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    await db.exec(`BEGIN; ${migration.sql} INSERT INTO schema_migrations (id) VALUES ('${migration.id}'); COMMIT;`);
    ran.push(migration.id);
  }
  return ran;
}
