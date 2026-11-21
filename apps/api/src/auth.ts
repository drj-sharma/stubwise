import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Db } from './db/client';
import { ApiError } from './errors';

/**
 * There are no user accounts yet. A phone registers itself once and receives
 * a random token; only the token's SHA-256 hash is stored, so a database leak
 * does not expose usable credentials.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function registerDevice(db: Db): Promise<{ deviceId: string; token: string }> {
  const deviceId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  await db.query('INSERT INTO devices (id, token_hash) VALUES ($1, $2)', [deviceId, hashToken(token)]);
  return { deviceId, token };
}

export async function requireDevice(db: Db, request: FastifyRequest): Promise<string> {
  const header = request.headers.authorization ?? '';
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
  if (!match?.[1]) throw new ApiError(401, 'unauthorized', 'Send the device token as "Authorization: Bearer <token>".');
  const expected = hashToken(match[1]);
  const rows = await db.query<{ id: string; token_hash: string }>('SELECT id, token_hash FROM devices WHERE token_hash = $1', [expected]);
  const row = rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.token_hash), Buffer.from(expected))) {
    throw new ApiError(401, 'unauthorized', 'Unknown device token.');
  }
  return row.id;
}
