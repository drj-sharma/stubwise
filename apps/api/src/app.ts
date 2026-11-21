import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { type StubLine, calcStub, computeYtd, draftNextStub, withComputedAmount } from '@stubwise/domain';
import { TEMPLATES, type TemplateId, buildStubDocument, renderStubHtml } from '@stubwise/templates';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerDevice, requireDevice } from './auth';
import { deleteDevice, loadSnapshot, saveSnapshot, verifySnapshot } from './backup';
import type { Db } from './db/client';
import { ApiError, parseOrThrow } from './errors';
import { computeRequest, draftNextRequest, renderRequest, snapshot } from './schemas';

export interface AppOptions {
  db: Db;
  logLevel?: string;
  rateLimitPerMinute?: number;
}

export const API_VERSION = '0.1.0';

/**
 * Builds the HTTP app without starting it, so tests can drive it in-process.
 *
 * Two groups of endpoints:
 *  - /v1/stubs/*   stateless: calculate, draft and render a stub from the data
 *                  in the request. Nothing is stored. Same code as the app.
 *  - /v1/backup    opt-in copy of a device's records, replaced as a whole.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { db } = options;
  const app = Fastify({
    logger: {
      level: options.logLevel ?? 'info',
      redact: ['req.headers.authorization'],
    },
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet);
  await app.register(rateLimit, { max: options.rateLimitPerMinute ?? 120, timeWindow: '1 minute' });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const status = typeof (error as { statusCode?: unknown }).statusCode === 'number' ? (error as { statusCode: number }).statusCode : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'unhandled error');
      return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong on our side.' } });
    }
    // Fastify's own client errors: malformed JSON, body too large, rate limited.
    const code = status === 429 ? 'rate_limited' : status === 413 ? 'body_too_large' : 'bad_request';
    return reply.status(status).send({ error: { code, message: (error as Error).message } });
  });

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: { code: 'not_found', message: 'No such endpoint.' } }),
  );

  app.get('/health', async () => {
    await db.query('SELECT 1');
    return { status: 'ok', version: API_VERSION };
  });

  app.get('/v1/meta', async () => ({
    version: API_VERSION,
    minAppVersion: '1.0.0',
    templates: TEMPLATES,
  }));

  app.post('/v1/devices', async (_request, reply) => reply.status(201).send(await registerDevice(db)));

  // ---- Stateless stub endpoints --------------------------------------------

  app.post('/v1/stubs/compute', async (request) => {
    await requireDevice(db, request);
    const body = parseOrThrow(computeRequest, request.body);
    const lines = body.stub.lines.map((line) => withComputedAmount(line as StubLine));
    const stub = { ...body.stub, lines };
    const ytd = computeYtd(stub, body.workerStubs as never, body.startingYtd);
    return {
      lines,
      totals: calcStub(lines),
      ytd: {
        grossCents: ytd.grossCents,
        deductionsCents: ytd.deductionsCents,
        netCents: ytd.netCents,
        byLine: Object.fromEntries(ytd.byLine),
      },
    };
  });

  app.post('/v1/stubs/draft-next', async (request) => {
    await requireDevice(db, request);
    const body = parseOrThrow(draftNextRequest, request.body);
    const draft = draftNextStub(body.worker, body.schedule, body.previous as never, body.today, body.overtimeMultiplierPct);
    return { ...draft, totals: calcStub(draft.lines) };
  });

  app.post('/v1/stubs/render', async (request, reply) => {
    await requireDevice(db, request);
    const body = parseOrThrow(renderRequest, request.body);
    const document = buildStubDocument({
      business: { ...body.business, logoDataUri: null },
      worker: body.worker,
      stub: body.stub as never,
      workerStubs: body.workerStubs as never,
    });
    const html = renderStubHtml(document, body.templateId as TemplateId, { accent: body.accent });
    return reply.type('text/html; charset=utf-8').send(html);
  });

  // ---- Backup ---------------------------------------------------------------

  app.put('/v1/backup', async (request) => {
    const deviceId = await requireDevice(db, request);
    const body = parseOrThrow(snapshot, request.body);
    verifySnapshot(body);
    const { savedAt } = await saveSnapshot(db, deviceId, body);
    return { savedAt, workers: body.workers.length, stubs: body.stubs.length };
  });

  app.get('/v1/backup', async (request) => {
    const deviceId = await requireDevice(db, request);
    const found = await loadSnapshot(db, deviceId);
    if (!found) throw new ApiError(404, 'no_backup', 'This device has no backup yet.');
    return found;
  });

  app.delete('/v1/backup', async (request, reply) => {
    const deviceId = await requireDevice(db, request);
    await deleteDevice(db, deviceId);
    return reply.status(204).send();
  });

  return app;
}
