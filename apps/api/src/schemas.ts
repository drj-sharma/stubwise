import { isIsoDate } from '@stubwise/domain';
import { isTemplateId } from '@stubwise/templates';
import { z } from 'zod';

/** Request shapes. Every limit here is also a guard against oversized or hostile input. */

const id = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'ids may contain letters, digits, - and _');
const text = (max: number) => z.string().trim().max(max);
const cents = z.number().int().min(0).max(1_000_000_000);
const isoDate = z.string().refine(isIsoDate, 'must be a real date in YYYY-MM-DD form');

export const paySchedule = z.enum(['weekly', 'biweekly', 'semimonthly', 'monthly']);

export const stubLine = z
  .object({
    kind: z.enum(['earning', 'deduction']),
    label: text(60).min(1),
    minutes: z.number().int().min(0).max(100_000).nullable(),
    rateCents: cents.nullable(),
    amountCents: cents,
    source: z.enum(['manual', 'calculated']),
  })
  .refine((line) => (line.minutes === null) === (line.rateCents === null), {
    message: 'minutes and rateCents must both be set (hourly line) or both be null (flat amount)',
  })
  .refine((line) => line.kind === 'earning' || line.minutes === null, {
    message: 'deductions are flat amounts and cannot carry hours',
  });

export const startingYtd = z.object({
  year: z.number().int().min(2000).max(2100),
  lines: z.array(z.object({ kind: z.enum(['earning', 'deduction']), label: text(60).min(1), amountCents: cents })).max(40),
});

const worker = z.object({
  id,
  name: text(120).min(1),
  address: text(240),
  type: z.enum(['employee', 'contractor']),
  payType: z.enum(['hourly', 'salary']),
  rateCents: cents,
  defaultDeductions: z.array(z.object({ label: text(60).min(1), amountCents: cents })).max(20),
  startingYtd: startingYtd.nullable(),
});

const stub = z.object({
  id,
  workerId: id,
  periodStart: isoDate,
  periodEnd: isoDate,
  payDate: isoDate,
  createdAt: z.iso.datetime(),
  lines: z.array(stubLine).min(1).max(40),
});

export const snapshot = z.object({
  business: z.object({
    id,
    name: text(120).min(1),
    address: text(240),
    phone: text(40),
    employerId: text(20).nullable(),
    paySchedule,
    showEmployerId: z.boolean(),
    templateId: z.string().refine(isTemplateId, 'unknown template'),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
  workers: z.array(worker).max(50),
  stubs: z.array(stub).max(5000),
});
export type Snapshot = z.infer<typeof snapshot>;

const ytdStub = z.object({ id, payDate: isoDate, createdAt: z.iso.datetime(), lines: z.array(stubLine).max(40) });

export const computeRequest = z.object({
  stub: ytdStub,
  /** Other saved stubs for the same worker, for year-to-date. */
  workerStubs: z.array(ytdStub).max(400).default([]),
  startingYtd: startingYtd.nullable().default(null),
});

const period = z.object({ start: isoDate, end: isoDate }).refine((p) => p.end >= p.start, 'period ends before it starts');

export const draftNextRequest = z.object({
  worker: z.object({
    payType: z.enum(['hourly', 'salary']),
    rateCents: cents,
    type: z.enum(['employee', 'contractor']),
    defaultDeductions: z.array(z.object({ label: text(60).min(1), amountCents: cents })).max(20),
  }),
  schedule: paySchedule,
  previous: z.object({ period, payDate: isoDate, lines: z.array(stubLine).max(40) }).nullable(),
  today: isoDate,
  overtimeMultiplierPct: z.number().int().min(100).max(400).default(150),
});

export const renderRequest = z.object({
  templateId: z.string().refine(isTemplateId, 'unknown template').default('classic'),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  business: z.object({
    name: text(120).min(1),
    address: text(240),
    phone: text(40),
    employerId: text(20).nullable(),
    paySchedule,
    showEmployerId: z.boolean(),
  }),
  worker: z.object({
    name: text(120).min(1),
    address: text(240),
    type: z.enum(['employee', 'contractor']),
    payType: z.enum(['hourly', 'salary']),
    rateCents: cents,
    startingYtd: startingYtd.nullable(),
  }),
  stub: ytdStub.extend({ period }),
  workerStubs: z.array(ytdStub).max(400).default([]),
});
