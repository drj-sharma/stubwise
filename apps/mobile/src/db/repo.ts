import { type IsoDate, type PayPeriod, type PaySchedule, type StartingYtd, type StubLine, type UsStateCode, isUsStateCode } from '@stubwise/domain';
import { DEFAULT_ACCENT, DEFAULT_TEMPLATE_ID, type TemplateId, isTemplateId } from '@stubwise/templates';
import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Appearance } from '@/ui/theme';
import type { Business, NewWorker, Stub, StubLineRow, Worker } from './types';

/** All reading and writing of the on-device database goes through this file. */

// ---- Business ---------------------------------------------------------------

interface BusinessRow {
  id: string;
  name: string;
  address: string;
  phone: string;
  state: string | null;
  employer_id: string | null;
  logo_data_uri: string | null;
  pay_schedule: PaySchedule;
  show_employer_id: number;
  template_id: string;
  accent: string;
  overtime_pct: number;
  appearance: string;
}

export async function getBusiness(db: SQLiteDatabase): Promise<Business | null> {
  const row = await db.getFirstAsync<BusinessRow>('SELECT * FROM business LIMIT 1');
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    state: isUsStateCode(row.state) ? row.state : null,
    employerId: row.employer_id,
    logoDataUri: row.logo_data_uri,
    paySchedule: row.pay_schedule,
    showEmployerId: row.show_employer_id === 1,
    templateId: isTemplateId(row.template_id) ? row.template_id : DEFAULT_TEMPLATE_ID,
    accent: row.accent,
    overtimePct: row.overtime_pct,
    appearance: (['automatic', 'light', 'dark'] as const).includes(row.appearance as Appearance)
      ? (row.appearance as Appearance)
      : 'automatic',
  };
}

export interface BusinessDetails {
  name: string;
  address: string;
  phone: string;
  employerId: string | null;
  logoDataUri: string | null;
  paySchedule: PaySchedule;
}

/** Creates the business on first run, or updates its details afterwards. There is only ever one. */
export async function saveBusinessDetails(db: SQLiteDatabase, details: BusinessDetails): Promise<void> {
  const existing = await getBusiness(db);
  if (existing) {
    await db.runAsync(
      'UPDATE business SET name = ?, address = ?, phone = ?, employer_id = ?, logo_data_uri = ?, pay_schedule = ? WHERE id = ?',
      details.name,
      details.address,
      details.phone,
      details.employerId,
      details.logoDataUri,
      details.paySchedule,
      existing.id,
    );
    return;
  }
  await db.runAsync(
    `INSERT INTO business (id, name, address, phone, employer_id, logo_data_uri, pay_schedule, template_id, accent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    Crypto.randomUUID(),
    details.name,
    details.address,
    details.phone,
    details.employerId,
    details.logoDataUri,
    details.paySchedule,
    DEFAULT_TEMPLATE_ID,
    DEFAULT_ACCENT,
  );
}

export async function updateBusinessSettings(
  db: SQLiteDatabase,
  patch: Partial<{ state: UsStateCode | null; showEmployerId: boolean; templateId: TemplateId; accent: string; overtimePct: number; appearance: Appearance }>,
): Promise<void> {
  const sets: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.state !== undefined) (sets.push('state = ?'), values.push(patch.state));
  if (patch.showEmployerId !== undefined) (sets.push('show_employer_id = ?'), values.push(patch.showEmployerId ? 1 : 0));
  if (patch.templateId !== undefined) (sets.push('template_id = ?'), values.push(patch.templateId));
  if (patch.accent !== undefined) (sets.push('accent = ?'), values.push(patch.accent));
  if (patch.overtimePct !== undefined) (sets.push('overtime_pct = ?'), values.push(patch.overtimePct));
  if (patch.appearance !== undefined) (sets.push('appearance = ?'), values.push(patch.appearance));
  if (sets.length === 0) return;
  await db.runAsync(`UPDATE business SET ${sets.join(', ')}`, ...values);
}

// ---- Workers ----------------------------------------------------------------

interface WorkerRow {
  id: string;
  name: string;
  address: string;
  type: 'employee' | 'contractor';
  pay_type: 'hourly' | 'salary';
  rate_cents: number;
  default_deductions: string;
  starting_ytd: string | null;
  created_at: string;
}

function toWorker(row: WorkerRow): Worker {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    type: row.type,
    payType: row.pay_type,
    rateCents: row.rate_cents,
    defaultDeductions: parseJson<Worker['defaultDeductions']>(row.default_deductions, []),
    startingYtd: row.starting_ytd ? parseJson<StartingYtd | null>(row.starting_ytd, null) : null,
    createdAt: row.created_at,
  };
}

export async function listWorkers(db: SQLiteDatabase): Promise<Worker[]> {
  return (await db.getAllAsync<WorkerRow>('SELECT * FROM worker ORDER BY created_at, name')).map(toWorker);
}

export async function getWorker(db: SQLiteDatabase, id: string): Promise<Worker | null> {
  const row = await db.getFirstAsync<WorkerRow>('SELECT * FROM worker WHERE id = ?', id);
  return row ? toWorker(row) : null;
}

export async function createWorker(db: SQLiteDatabase, worker: NewWorker): Promise<string> {
  const id = Crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO worker (id, name, address, type, pay_type, rate_cents, default_deductions, starting_ytd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    worker.name,
    worker.address,
    worker.type,
    worker.payType,
    worker.rateCents,
    JSON.stringify(worker.defaultDeductions),
    worker.startingYtd ? JSON.stringify(worker.startingYtd) : null,
    new Date().toISOString(),
  );
  return id;
}

export async function updateWorker(db: SQLiteDatabase, id: string, worker: NewWorker): Promise<void> {
  await db.runAsync(
    `UPDATE worker SET name = ?, address = ?, type = ?, pay_type = ?, rate_cents = ?, default_deductions = ?, starting_ytd = ?
     WHERE id = ?`,
    worker.name,
    worker.address,
    worker.type,
    worker.payType,
    worker.rateCents,
    JSON.stringify(worker.defaultDeductions),
    worker.startingYtd ? JSON.stringify(worker.startingYtd) : null,
    id,
  );
}

/** Deletes the worker and, through the foreign key, every stub made for them. */
export async function deleteWorker(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM worker WHERE id = ?', id);
}

// ---- Stubs ------------------------------------------------------------------

interface StubRow {
  id: string;
  worker_id: string;
  period_start: IsoDate;
  period_end: IsoDate;
  pay_date: IsoDate;
  created_at: string;
}

interface LineRow {
  id: string;
  stub_id: string;
  kind: StubLine['kind'];
  label: string;
  minutes: number | null;
  rate_cents: number | null;
  amount_cents: number;
  source: StubLine['source'];
}

function attachLines(stubs: StubRow[], lines: LineRow[]): Stub[] {
  const byStub = new Map<string, StubLineRow[]>();
  for (const line of lines) {
    const list = byStub.get(line.stub_id) ?? [];
    list.push({
      id: line.id,
      kind: line.kind,
      label: line.label,
      minutes: line.minutes,
      rateCents: line.rate_cents,
      amountCents: line.amount_cents,
      source: line.source,
    });
    byStub.set(line.stub_id, list);
  }
  return stubs.map((row) => ({
    id: row.id,
    workerId: row.worker_id,
    period: { start: row.period_start, end: row.period_end },
    payDate: row.pay_date,
    createdAt: row.created_at,
    lines: byStub.get(row.id) ?? [],
  }));
}

/** Newest first. */
export async function listStubsForWorker(db: SQLiteDatabase, workerId: string): Promise<Stub[]> {
  const stubs = await db.getAllAsync<StubRow>(
    'SELECT * FROM stub WHERE worker_id = ? ORDER BY pay_date DESC, created_at DESC',
    workerId,
  );
  const lines = await db.getAllAsync<LineRow>(
    `SELECT l.* FROM stub_line l JOIN stub s ON s.id = l.stub_id WHERE s.worker_id = ? ORDER BY l.stub_id, l.position`,
    workerId,
  );
  return attachLines(stubs, lines);
}

/** Every stub for every worker, newest first. */
export async function listAllStubs(db: SQLiteDatabase): Promise<Stub[]> {
  const stubs = await db.getAllAsync<StubRow>('SELECT * FROM stub ORDER BY pay_date DESC, created_at DESC');
  const lines = await db.getAllAsync<LineRow>('SELECT * FROM stub_line ORDER BY stub_id, position');
  return attachLines(stubs, lines);
}

export async function getStub(db: SQLiteDatabase, id: string): Promise<Stub | null> {
  const row = await db.getFirstAsync<StubRow>('SELECT * FROM stub WHERE id = ?', id);
  if (!row) return null;
  const lines = await db.getAllAsync<LineRow>('SELECT * FROM stub_line WHERE stub_id = ? ORDER BY position', id);
  return attachLines([row], lines)[0] ?? null;
}

export async function createStub(
  db: SQLiteDatabase,
  input: { workerId: string; period: PayPeriod; payDate: IsoDate; lines: readonly StubLine[] },
): Promise<string> {
  const id = Crypto.randomUUID();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO stub (id, worker_id, period_start, period_end, pay_date, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      input.workerId,
      input.period.start,
      input.period.end,
      input.payDate,
      new Date().toISOString(),
    );
    await insertLines(db, id, input.lines);
  });
  return id;
}

/** Replaces all lines of a stub in one transaction, preserving their order. */
export async function replaceStubLines(db: SQLiteDatabase, stubId: string, lines: readonly StubLine[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM stub_line WHERE stub_id = ?', stubId);
    await insertLines(db, stubId, lines);
  });
}

export async function updateStubDates(db: SQLiteDatabase, stubId: string, period: PayPeriod, payDate: IsoDate): Promise<void> {
  await db.runAsync(
    'UPDATE stub SET period_start = ?, period_end = ?, pay_date = ? WHERE id = ?',
    period.start,
    period.end,
    payDate,
    stubId,
  );
}

export async function deleteStub(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM stub WHERE id = ?', id);
}

async function insertLines(db: SQLiteDatabase, stubId: string, lines: readonly StubLine[]): Promise<void> {
  for (const [position, line] of lines.entries()) {
    await db.runAsync(
      `INSERT INTO stub_line (id, stub_id, position, kind, label, minutes, rate_cents, amount_cents, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      Crypto.randomUUID(),
      stubId,
      position,
      line.kind,
      line.label,
      line.minutes,
      line.rateCents,
      line.amountCents,
      line.source,
    );
  }
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}
