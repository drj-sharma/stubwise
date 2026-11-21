import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'stubwise.db';

/**
 * Schema migrations, applied in order and tracked with SQLite's user_version.
 * Append new steps; never edit one that has shipped, because phones in the
 * field have already run it.
 */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE business (
    id                TEXT PRIMARY KEY NOT NULL,
    name              TEXT NOT NULL,
    address           TEXT NOT NULL DEFAULT '',
    phone             TEXT NOT NULL DEFAULT '',
    employer_id       TEXT,
    logo_data_uri     TEXT,
    pay_schedule      TEXT NOT NULL CHECK (pay_schedule IN ('weekly','biweekly','semimonthly','monthly')),
    show_employer_id  INTEGER NOT NULL DEFAULT 1,
    template_id       TEXT NOT NULL DEFAULT 'classic',
    accent            TEXT NOT NULL DEFAULT '#3F3D9E',
    overtime_pct      INTEGER NOT NULL DEFAULT 150,
    appearance        TEXT NOT NULL DEFAULT 'automatic'
  );

  CREATE TABLE worker (
    id                  TEXT PRIMARY KEY NOT NULL,
    name                TEXT NOT NULL,
    address             TEXT NOT NULL DEFAULT '',
    type                TEXT NOT NULL CHECK (type IN ('employee','contractor')),
    pay_type            TEXT NOT NULL CHECK (pay_type IN ('hourly','salary')),
    rate_cents          INTEGER NOT NULL CHECK (rate_cents >= 0),
    default_deductions  TEXT NOT NULL DEFAULT '[]',
    starting_ytd        TEXT,
    created_at          TEXT NOT NULL
  );

  CREATE TABLE stub (
    id            TEXT PRIMARY KEY NOT NULL,
    worker_id     TEXT NOT NULL REFERENCES worker(id) ON DELETE CASCADE,
    period_start  TEXT NOT NULL,
    period_end    TEXT NOT NULL,
    pay_date      TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );
  CREATE INDEX stub_worker_pay_date ON stub (worker_id, pay_date);

  CREATE TABLE stub_line (
    id            TEXT PRIMARY KEY NOT NULL,
    stub_id       TEXT NOT NULL REFERENCES stub(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('earning','deduction')),
    label         TEXT NOT NULL,
    minutes       INTEGER,
    rate_cents    INTEGER,
    amount_cents  INTEGER NOT NULL CHECK (amount_cents >= 0),
    source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','calculated'))
  );
  CREATE INDEX stub_line_stub ON stub_line (stub_id, position);
  `,
];

export async function migrateDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const sql = MIGRATIONS[version];
    if (!sql) break;
    const next = version + 1;
    await db.withTransactionAsync(async () => {
      await db.execAsync(sql);
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}
