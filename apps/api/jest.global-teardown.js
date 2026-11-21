module.exports = async function globalTeardown() {
  const running = globalThis.__STUBWISE_TEST_PG__;
  if (!running) return;
  await running.server.stop();
  await running.db.close();
};
