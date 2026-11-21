import { formatCents, lineAmount } from '@stubwise/domain';
import type { Db, Queryable } from './db/client';
import { ApiError } from './errors';
import type { Snapshot } from './schemas';

/**
 * Cross-record checks that a schema cannot express. The server recalculates
 * every hourly line with the same shared code the app uses and refuses a
 * backup whose stored amount disagrees, so a bug or a tampered client cannot
 * plant wrong pay figures in a backup.
 */
export function verifySnapshot(snapshot: Snapshot): void {
  const problems: { stubId?: string; workerId?: string; message: string }[] = [];
  const workerIds = new Set<string>();
  for (const worker of snapshot.workers) {
    if (workerIds.has(worker.id)) problems.push({ workerId: worker.id, message: 'duplicate worker id' });
    workerIds.add(worker.id);
  }
  const stubIds = new Set<string>();
  for (const stub of snapshot.stubs) {
    if (stubIds.has(stub.id)) problems.push({ stubId: stub.id, message: 'duplicate stub id' });
    stubIds.add(stub.id);
    if (!workerIds.has(stub.workerId)) problems.push({ stubId: stub.id, message: `unknown worker ${stub.workerId}` });
    if (stub.periodEnd < stub.periodStart) problems.push({ stubId: stub.id, message: 'period ends before it starts' });
    for (const line of stub.lines) {
      const expected = lineAmount(line);
      if (expected !== line.amountCents) {
        problems.push({
          stubId: stub.id,
          message: `"${line.label}" should be ${formatCents(expected)} for its hours and rate, but ${formatCents(line.amountCents)} was sent`,
        });
      }
    }
  }
  if (problems.length > 0) {
    throw new ApiError(422, 'snapshot_rejected', 'The backup contains records that do not add up.', problems.slice(0, 20));
  }
}

/** Replaces the device's whole backup in one transaction: all of it is saved, or none of it. */
export async function saveSnapshot(db: Db, deviceId: string, snapshot: Snapshot): Promise<{ savedAt: string }> {
  return db.transaction(async (tx) => {
    await clear(tx, deviceId);
    const b = snapshot.business;
    const saved = await tx.query<{ saved_at: string }>(
      `INSERT INTO businesses (device_id, id, name, address, phone, employer_id, pay_schedule, show_employer_id, template_id, accent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING to_char(saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS saved_at`,
      [deviceId, b.id, b.name, b.address, b.phone, b.employerId, b.paySchedule, b.showEmployerId, b.templateId, b.accent],
    );
    for (const [position, w] of snapshot.workers.entries()) {
      await tx.query(
        `INSERT INTO workers (device_id, id, name, address, type, pay_type, rate_cents, default_deductions, starting_ytd, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
        [
          deviceId,
          w.id,
          w.name,
          w.address,
          w.type,
          w.payType,
          w.rateCents,
          JSON.stringify(w.defaultDeductions),
          w.startingYtd ? JSON.stringify(w.startingYtd) : null,
          position,
        ],
      );
    }
    for (const s of snapshot.stubs) {
      await tx.query(
        `INSERT INTO stubs (device_id, id, worker_id, period_start, period_end, pay_date, created_at)
         VALUES ($1,$2,$3,$4::date,$5::date,$6::date,$7::timestamptz)`,
        [deviceId, s.id, s.workerId, s.periodStart, s.periodEnd, s.payDate, s.createdAt],
      );
      for (const [position, line] of s.lines.entries()) {
        await tx.query(
          `INSERT INTO stub_lines (device_id, stub_id, position, kind, label, minutes, rate_cents, amount_cents, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [deviceId, s.id, position, line.kind, line.label, line.minutes, line.rateCents, line.amountCents, line.source],
        );
      }
    }
    return { savedAt: saved[0]?.saved_at ?? new Date().toISOString() };
  });
}

export async function loadSnapshot(db: Db, deviceId: string): Promise<(Snapshot & { savedAt: string }) | null> {
  const businesses = await db.query<Record<string, unknown>>(
    `SELECT id, name, address, phone, employer_id, pay_schedule, show_employer_id, template_id, accent,
            to_char(saved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS saved_at
     FROM businesses WHERE device_id = $1`,
    [deviceId],
  );
  const b = businesses[0];
  if (!b) return null;

  const workers = await db.query<Record<string, unknown>>(
    `SELECT id, name, address, type, pay_type, rate_cents, default_deductions, starting_ytd
     FROM workers WHERE device_id = $1 ORDER BY position`,
    [deviceId],
  );
  const stubs = await db.query<Record<string, unknown>>(
    `SELECT id, worker_id,
            to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end,
            to_char(pay_date, 'YYYY-MM-DD') AS pay_date,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at
     FROM stubs WHERE device_id = $1 ORDER BY pay_date, created_at`,
    [deviceId],
  );
  const lines = await db.query<Record<string, unknown>>(
    `SELECT stub_id, kind, label, minutes, rate_cents, amount_cents, source
     FROM stub_lines WHERE device_id = $1 ORDER BY stub_id, position`,
    [deviceId],
  );
  const linesByStub = new Map<string, Snapshot['stubs'][number]['lines']>();
  for (const line of lines) {
    const list = linesByStub.get(line.stub_id as string) ?? [];
    list.push({
      kind: line.kind as 'earning' | 'deduction',
      label: line.label as string,
      minutes: line.minutes as number | null,
      rateCents: line.rate_cents as number | null,
      amountCents: line.amount_cents as number,
      source: line.source as 'manual' | 'calculated',
    });
    linesByStub.set(line.stub_id as string, list);
  }

  return {
    savedAt: b.saved_at as string,
    business: {
      id: b.id as string,
      name: b.name as string,
      address: b.address as string,
      phone: b.phone as string,
      employerId: (b.employer_id as string | null) ?? null,
      paySchedule: b.pay_schedule as Snapshot['business']['paySchedule'],
      showEmployerId: b.show_employer_id as boolean,
      templateId: b.template_id as Snapshot['business']['templateId'],
      accent: b.accent as string,
    },
    workers: workers.map((w) => ({
      id: w.id as string,
      name: w.name as string,
      address: w.address as string,
      type: w.type as 'employee' | 'contractor',
      payType: w.pay_type as 'hourly' | 'salary',
      rateCents: w.rate_cents as number,
      defaultDeductions: json(w.default_deductions) as Snapshot['workers'][number]['defaultDeductions'],
      startingYtd: (json(w.starting_ytd) as Snapshot['workers'][number]['startingYtd']) ?? null,
    })),
    stubs: stubs.map((s) => ({
      id: s.id as string,
      workerId: s.worker_id as string,
      periodStart: s.period_start as string,
      periodEnd: s.period_end as string,
      payDate: s.pay_date as string,
      createdAt: s.created_at as string,
      lines: linesByStub.get(s.id as string) ?? [],
    })),
  };
}

/** Deletes everything stored for a device, including its registration. */
export async function deleteDevice(db: Db, deviceId: string): Promise<void> {
  await db.query('DELETE FROM devices WHERE id = $1', [deviceId]);
}

async function clear(tx: Queryable, deviceId: string): Promise<void> {
  // stub_lines and stubs go with their workers through ON DELETE CASCADE.
  await tx.query('DELETE FROM workers WHERE device_id = $1', [deviceId]);
  await tx.query('DELETE FROM businesses WHERE device_id = $1', [deviceId]);
}

/** The two Postgres drivers differ on whether jsonb arrives parsed. */
function json(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}
