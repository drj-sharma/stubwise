/**
 * Starts a throwaway Postgres for the API tests: PGlite (Postgres compiled to
 * WASM) served over the normal Postgres wire protocol on a free local port.
 * The tests then connect with the same `pg` driver production uses, so they
 * need no Docker and no installed database, and they exercise the real driver.
 *
 * This runs in Jest's parent process on purpose: PGlite loads itself with a
 * dynamic import(), which Jest's per-test sandbox does not allow.
 */
const net = require('node:net');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

module.exports = async function globalSetup() {
  const { PGlite } = require('@electric-sql/pglite');
  const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

  const db = await PGlite.create();
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 8 });
  await server.start();

  process.env.STUBWISE_TEST_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  globalThis.__STUBWISE_TEST_PG__ = { db, server };
};
