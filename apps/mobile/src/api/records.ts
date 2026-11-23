import {
  type IsoDate,
  type PayPeriod,
  type PaySchedule,
  type StubLine,
  type UsStateCode,
  isTaxCode,
  isUsStateCode,
  normalizeTaxProfile,
  todayIso,
} from '@stubwise/domain';
import { DEFAULT_TEMPLATE_ID, type TemplateId, isTemplateId } from '@stubwise/templates';
import type { Business, NewWorker, Stub, Worker } from '@/db/types';
import type { Appearance } from '@/ui/theme';
import { ApiError, isNotFound } from './client';
import { api } from './index';
import type { BatchOut, BusinessOut, Page, StubOut, WorkerOut } from './types';

/**
 * Every read and write of the user's records. The server is the system of
 * record; nothing is kept on the phone between launches.
 */

// ---- Mapping the server's JSON onto the app's types ---------------------------

const APPEARANCES: readonly Appearance[] = ['automatic', 'light', 'dark'];

export function toBusiness(row: BusinessOut): Business {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    state: isUsStateCode(row.state) ? row.state : null,
    employerId: row.employerId,
    logoDataUri: row.logoDataUri,
    paySchedule: row.paySchedule,
    firstPayDate: row.firstPayDate,
    showEmployerId: row.showEmployerId,
    templateId: isTemplateId(row.templateId) ? row.templateId : DEFAULT_TEMPLATE_ID,
    accent: row.accent,
    overtimePct: row.overtimePct,
    appearance: APPEARANCES.includes(row.appearance as Appearance) ? (row.appearance as Appearance) : 'light',
    version: row.version,
  };
}

export function toWorker(row: WorkerOut): Worker {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    email: row.email ?? '',
    type: row.type,
    payType: row.payType,
    rateCents: row.rateCents,
    defaultDeductions: row.defaultDeductions,
    startingYtd: row.startingYtd,
    taxProfile: normalizeTaxProfile(row.taxProfile),
    createdAt: row.createdAt,
    version: row.version,
  };
}

export function toStub(row: StubOut): Stub {
  return {
    id: row.id,
    workerId: row.workerId,
    period: row.period,
    payDate: row.payDate,
    createdAt: row.createdAt,
    version: row.version,
    totals: row.totals,
    ytd: row.ytd,
    taxStatus: row.taxStatus,
    lines: row.lines.map((line) => ({
      id: line.id,
      kind: line.kind,
      label: line.label,
      minutes: line.minutes,
      rateCents: line.rateCents,
      amountCents: line.amountCents,
      source: line.source,
      taxCode: isTaxCode(line.taxCode) ? line.taxCode : null,
      taxOverride: line.taxOverride,
    })),
  };
}

/** Only the fields the server accepts for a line; `taxCode` is left out when there is none. */
function wireLine(line: StubLine) {
  const { kind, label, minutes, rateCents, amountCents, source, taxCode } = line;
  return taxCode ? { kind, label, minutes, rateCents, amountCents, source, taxCode } : { kind, label, minutes, rateCents, amountCents, source };
}

/** Lists are paged by the server; the app's lists are small, so it reads every page. */
async function allPages<T>(path: string, query: Record<string, string | undefined> = {}): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.request<Page<T>>('GET', path, { query: { ...query, limit: 200, cursor } });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

/** The date where the person is: the server only knows UTC, which is already tomorrow during US evenings. */
const today = (): { today: IsoDate } => ({ today: todayIso() });

// ---- Business -----------------------------------------------------------------

export interface BusinessInput {
  name: string;
  address: string;
  phone: string;
  state: UsStateCode | null;
  employerId: string | null;
  logoDataUri: string | null;
  paySchedule: PaySchedule;
  firstPayDate?: IsoDate | null;
  templateId?: TemplateId;
  accent?: string;
  overtimePct?: number;
}

export type BusinessPatch = Partial<BusinessInput & { showEmployerId: boolean; appearance: Appearance }>;

/** The signed-in user's business, or null before setup. */
export async function getBusiness(): Promise<Business | null> {
  try {
    return toBusiness(await api.request<BusinessOut>('GET', '/v1/business'));
  } catch (error) {
    if (isNotFound(error, 'business_not_found')) return null;
    throw error;
  }
}

/**
 * Creates the business, or updates it if an earlier attempt already created
 * it (the reply to that attempt may have been lost on a bad connection).
 */
export async function createBusiness(input: BusinessInput): Promise<Business> {
  try {
    return toBusiness(await api.request<BusinessOut>('POST', '/v1/business', { body: input }));
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'business_exists')) throw error;
    const existing = await getBusiness();
    if (!existing) throw error;
    return updateBusiness(existing.version, input);
  }
}

export async function updateBusiness(version: number, patch: BusinessPatch): Promise<Business> {
  return toBusiness(await api.request<BusinessOut>('PATCH', '/v1/business', { body: patch, ifMatch: version }));
}

// ---- Workers ------------------------------------------------------------------

export async function listWorkers(): Promise<Worker[]> {
  return (await allPages<WorkerOut>('/v1/workers')).map(toWorker);
}

export async function getWorker(id: string): Promise<Worker | null> {
  try {
    return toWorker(await api.request<WorkerOut>('GET', `/v1/workers/${encodeURIComponent(id)}`));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function createWorker(worker: NewWorker, idempotencyKey: string): Promise<Worker> {
  return toWorker(await api.request<WorkerOut>('POST', '/v1/workers', { body: worker, idempotencyKey }));
}

export async function updateWorker(id: string, version: number, worker: NewWorker): Promise<Worker> {
  return toWorker(await api.request<WorkerOut>('PATCH', `/v1/workers/${encodeURIComponent(id)}`, { body: worker, ifMatch: version }));
}

/** Deletes the worker and every stub made for them. */
export async function deleteWorker(id: string): Promise<void> {
  await api.request<void>('DELETE', `/v1/workers/${encodeURIComponent(id)}`);
}

// ---- Stubs --------------------------------------------------------------------

/** Every stub, or one worker's, newest pay date first. */
export async function listStubs(workerId?: string): Promise<Stub[]> {
  return (await allPages<StubOut>('/v1/stubs', { workerId })).map(toStub);
}

export async function getStub(id: string): Promise<Stub | null> {
  try {
    return toStub(await api.request<StubOut>('GET', `/v1/stubs/${encodeURIComponent(id)}`));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** "Next pay period": the server drafts and saves the worker's next stub, taxes included. */
export async function createNextStub(workerId: string, idempotencyKey: string): Promise<Stub> {
  return toStub(
    await api.request<StubOut>('POST', `/v1/workers/${encodeURIComponent(workerId)}/stubs/next`, { body: today(), idempotencyKey }),
  );
}

/** This period's stub for every worker who does not have one yet. */
export async function makeAllStubs(idempotencyKey: string): Promise<{ period: PayPeriod; created: Stub[] }> {
  const result = await api.request<BatchOut>('POST', '/v1/stubs/batch', { body: today(), idempotencyKey });
  return { period: result.period, created: result.created.map(toStub) };
}

/** Replaces the lines. The server recomputes hourly amounts and calculated taxes and returns the result. */
export async function replaceStubLines(id: string, version: number, lines: readonly StubLine[]): Promise<Stub> {
  return toStub(
    await api.request<StubOut>('PUT', `/v1/stubs/${encodeURIComponent(id)}/lines`, { body: { lines: lines.map(wireLine) }, ifMatch: version }),
  );
}

/** Moves the stub; the server recalculates its taxes for the new pay date. */
export async function updateStubDates(id: string, version: number, period: PayPeriod, payDate: IsoDate): Promise<Stub> {
  return toStub(await api.request<StubOut>('PATCH', `/v1/stubs/${encodeURIComponent(id)}`, { body: { period, payDate }, ifMatch: version }));
}

export async function deleteStub(id: string): Promise<void> {
  await api.request<void>('DELETE', `/v1/stubs/${encodeURIComponent(id)}`);
}
