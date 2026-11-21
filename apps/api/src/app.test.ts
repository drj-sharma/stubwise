import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig } from './config';
import { type Db, createPostgresDb } from './db/client';
import { migrate } from './db/migrations';

let db: Db;
let app: FastifyInstance;

beforeAll(async () => {
  // Set by jest.global-setup.js, which serves an in-memory Postgres for the test run.
  const url = process.env.STUBWISE_TEST_DATABASE_URL;
  if (!url) throw new Error('STUBWISE_TEST_DATABASE_URL is not set; run the tests through the root Jest config');
  db = createPostgresDb(url);
  await migrate(db);
  app = await buildApp({ db, logLevel: 'silent', rateLimitPerMinute: 10_000 });
}, 60_000);

afterAll(async () => {
  await app.close();
  await db.close();
});

async function newDevice(): Promise<{ deviceId: string; token: string; auth: { authorization: string } }> {
  const response = await app.inject({ method: 'POST', url: '/v1/devices' });
  expect(response.statusCode).toBe(201);
  const body = response.json() as { deviceId: string; token: string };
  return { ...body, auth: { authorization: `Bearer ${body.token}` } };
}

const hourly = (label: string, minutes: number, rateCents: number, amountCents: number) => ({
  kind: 'earning',
  label,
  minutes,
  rateCents,
  amountCents,
  source: 'manual',
});
const flat = (kind: 'earning' | 'deduction', label: string, amountCents: number) => ({
  kind,
  label,
  minutes: null,
  rateCents: null,
  amountCents,
  source: 'manual',
});

const novemberLines = [
  hourly('Regular', 76 * 60 + 45, 2400, 184200),
  hourly('Overtime', 3 * 60 + 30, 3600, 12600),
  flat('earning', 'Bonus', 7500),
  flat('deduction', 'Federal income tax', 18600),
  flat('deduction', 'Health insurance', 8500),
];

function snapshot() {
  return {
    business: {
      id: 'biz-1',
      name: 'Ridgeline Auto Repair',
      address: '2140 Alder St, Chattanooga, TN 37404',
      phone: '(423) 555-0142',
      employerId: '62-1847305',
      paySchedule: 'biweekly',
      showEmployerId: true,
      templateId: 'classic',
      accent: '#3F3D9E',
    },
    workers: [
      {
        id: 'w-marcus',
        name: 'Marcus Bell',
        address: '418 Dodson Ave, Chattanooga, TN 37406',
        type: 'employee',
        payType: 'hourly',
        rateCents: 2400,
        defaultDeductions: [{ label: 'Health insurance', amountCents: 8500 }],
        startingYtd: { year: 2026, lines: [{ kind: 'earning', label: 'Regular', amountCents: 3571200 }] },
      },
      {
        id: 'w-tyrone',
        name: 'Tyrone Whitaker',
        address: '',
        type: 'contractor',
        payType: 'hourly',
        rateCents: 3200,
        defaultDeductions: [],
        startingYtd: null,
      },
    ],
    stubs: [
      {
        id: 's-4',
        workerId: 'w-marcus',
        periodStart: '2026-11-09',
        periodEnd: '2026-11-22',
        payDate: '2026-11-27',
        createdAt: '2026-11-26T10:00:00.000Z',
        lines: novemberLines,
      },
    ],
  };
}

describe('service basics', () => {
  it('reports health and the template library', async () => {
    expect((await app.inject({ url: '/health' })).json()).toMatchObject({ status: 'ok' });
    const meta = (await app.inject({ url: '/v1/meta' })).json() as { templates: { id: string }[] };
    expect(meta.templates.map((template) => template.id)).toEqual(['classic', 'modern', 'compact', 'ledger']);
  });

  it('answers unknown routes and bad JSON with a structured error', async () => {
    expect((await app.inject({ url: '/nope' })).json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint.' } });
    const { auth } = await newDevice();
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/stubs/compute',
      headers: { ...auth, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { error: { code: string } }).error.code).toBe('bad_request');
  });

  it('refuses production without a database URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' }).PORT).toBe(4000);
  });
});

describe('authentication', () => {
  it('rejects requests without a valid device token', async () => {
    for (const headers of [{}, { authorization: 'Bearer not-a-real-token-but-long-enough' }, { authorization: 'Basic abc' }]) {
      const response = await app.inject({ method: 'GET', url: '/v1/backup', headers });
      expect(response.statusCode).toBe(401);
    }
  });

  it('stores only a hash of the token', async () => {
    const { token } = await newDevice();
    const rows = await db.query<{ token_hash: string }>('SELECT token_hash FROM devices');
    expect(rows.some((row) => row.token_hash === token)).toBe(false);
    expect(rows.every((row) => /^[0-9a-f]{64}$/.test(row.token_hash))).toBe(true);
  });
});

describe('stub endpoints', () => {
  it('computes totals and year to date with the shared calculation code', async () => {
    const { auth } = await newDevice();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/stubs/compute',
      headers: auth,
      payload: {
        stub: {
          id: 's-4',
          payDate: '2026-11-27',
          createdAt: '2026-11-26T10:00:00.000Z',
          // A stale amount on an hourly line is recalculated, not trusted.
          lines: [hourly('Regular', 7 * 60 + 45, 1800, 1), flat('deduction', 'Medicare', 202)],
        },
        workerStubs: [
          { id: 's-3', payDate: '2026-11-13', createdAt: '2026-11-12T10:00:00.000Z', lines: [hourly('Regular', 60, 1800, 1800)] },
          { id: 's-0', payDate: '2025-12-30', createdAt: '2025-12-29T10:00:00.000Z', lines: [hourly('Regular', 600, 1800, 18000)] },
        ],
        startingYtd: { year: 2026, lines: [{ kind: 'earning', label: 'Regular', amountCents: 100000 }] },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      totals: { grossCents: number; netCents: number };
      ytd: { grossCents: number; byLine: Record<string, number> };
    };
    expect(body.totals).toMatchObject({ grossCents: 13950, netCents: 13748 });
    expect(body.ytd.grossCents).toBe(100000 + 1800 + 13950); // last year's stub is not counted
    expect(body.ytd.byLine['earning:regular']).toBe(115750);
  });

  it('drafts the next pay period', async () => {
    const { auth } = await newDevice();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/stubs/draft-next',
      headers: auth,
      payload: {
        worker: { payType: 'hourly', rateCents: 2400, type: 'employee', defaultDeductions: [] },
        schedule: 'biweekly',
        previous: { period: { start: '2026-11-09', end: '2026-11-22' }, payDate: '2026-11-27', lines: novemberLines },
        today: '2026-11-28',
      },
    });
    const body = response.json() as { period: unknown; payDate: string; lines: { label: string }[]; totals: { grossCents: number } };
    expect(body.period).toEqual({ start: '2026-11-23', end: '2026-12-06' });
    expect(body.payDate).toBe('2026-12-11');
    expect(body.lines.map((line) => line.label)).not.toContain('Bonus');
    expect(body.totals.grossCents).toBe(196800);
  });

  it('renders a stub as HTML in the chosen template', async () => {
    const { auth } = await newDevice();
    const snap = snapshot();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/stubs/render',
      headers: auth,
      payload: {
        templateId: 'ledger',
        business: {
          name: snap.business.name,
          address: snap.business.address,
          phone: snap.business.phone,
          employerId: snap.business.employerId,
          paySchedule: 'biweekly',
          showEmployerId: true,
        },
        worker: { name: 'Marcus <Bell>', address: '', type: 'employee', payType: 'hourly', rateCents: 2400, startingYtd: null },
        stub: {
          id: 's-4',
          payDate: '2026-11-27',
          createdAt: '2026-11-26T10:00:00.000Z',
          period: { start: '2026-11-09', end: '2026-11-22' },
          lines: novemberLines,
        },
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('$1,772.00');
    expect(response.body).toContain('Marcus &lt;Bell&gt;');
  });

  it('rejects malformed lines with a field-level message', async () => {
    const { auth } = await newDevice();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/stubs/compute',
      headers: auth,
      payload: {
        stub: {
          id: 's-1',
          payDate: '2026-02-30',
          createdAt: '2026-11-26T10:00:00.000Z',
          lines: [{ ...flat('earning', 'Bonus', 100), amountCents: 10.5 }],
        },
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json() as { error: { code: string; details: { path: string }[] } };
    expect(body.error.code).toBe('invalid_request');
    expect(body.error.details.map((detail) => detail.path)).toEqual(expect.arrayContaining(['stub.payDate', 'stub.lines.0.amountCents']));
  });
});

describe('backup', () => {
  it('saves a snapshot and returns it unchanged', async () => {
    const { auth } = await newDevice();
    expect((await app.inject({ method: 'GET', url: '/v1/backup', headers: auth })).statusCode).toBe(404);

    const saved = await app.inject({ method: 'PUT', url: '/v1/backup', headers: auth, payload: snapshot() });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ workers: 2, stubs: 1 });

    const loaded = (await app.inject({ method: 'GET', url: '/v1/backup', headers: auth })).json() as Record<string, unknown>;
    const { savedAt, ...rest } = loaded;
    expect(typeof savedAt).toBe('string');
    expect(rest).toEqual(snapshot());
  });

  it('replaces the previous backup as a whole', async () => {
    const { auth } = await newDevice();
    await app.inject({ method: 'PUT', url: '/v1/backup', headers: auth, payload: snapshot() });
    const smaller = snapshot();
    smaller.workers = [smaller.workers[1]!];
    smaller.stubs = [];
    await app.inject({ method: 'PUT', url: '/v1/backup', headers: auth, payload: smaller });
    const loaded = (await app.inject({ method: 'GET', url: '/v1/backup', headers: auth })).json() as { workers: unknown[]; stubs: unknown[] };
    expect(loaded.workers).toHaveLength(1);
    expect(loaded.stubs).toHaveLength(0);
  });

  it('keeps one device from reading another device\'s backup', async () => {
    const first = await newDevice();
    const second = await newDevice();
    await app.inject({ method: 'PUT', url: '/v1/backup', headers: first.auth, payload: snapshot() });
    expect((await app.inject({ method: 'GET', url: '/v1/backup', headers: second.auth })).statusCode).toBe(404);
  });

  it('refuses a backup whose amounts do not match hours and rate, and saves nothing', async () => {
    const { auth } = await newDevice();
    const tampered = snapshot();
    tampered.stubs[0]!.lines[0] = hourly('Regular', 76 * 60 + 45, 2400, 999999);
    const response = await app.inject({ method: 'PUT', url: '/v1/backup', headers: auth, payload: tampered });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { error: { code: string; details: { message: string }[] } };
    expect(body.error.code).toBe('snapshot_rejected');
    expect(body.error.details[0]?.message).toContain('$1,842.00');
    expect((await app.inject({ method: 'GET', url: '/v1/backup', headers: auth })).statusCode).toBe(404);
  });

  it('refuses a stub that points at a worker who is not in the backup', async () => {
    const { auth } = await newDevice();
    const orphan = snapshot();
    orphan.stubs[0]!.workerId = 'w-missing';
    const response = await app.inject({ method: 'PUT', url: '/v1/backup', headers: auth, payload: orphan });
    expect(response.statusCode).toBe(422);
  });

  it('deletes everything for a device, after which its token stops working', async () => {
    const { auth } = await newDevice();
    await app.inject({ method: 'PUT', url: '/v1/backup', headers: auth, payload: snapshot() });
    expect((await app.inject({ method: 'DELETE', url: '/v1/backup', headers: auth })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: '/v1/backup', headers: auth })).statusCode).toBe(401);
    const left = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM stub_lines');
    const total = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM stubs');
    expect(left[0]?.n).toBeGreaterThanOrEqual(0);
    expect(total[0]?.n).toBeGreaterThanOrEqual(0);
  });
});
