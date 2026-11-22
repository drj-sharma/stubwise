/** Root Jest config: `npx jest` runs the shared packages' tests, the API tests and the mobile app's plain-TypeScript tests. */
const swcTransform = {
  '^.+\\.ts$': [
    '@swc/jest',
    {
      jsc: { parser: { syntax: 'typescript' }, target: 'es2022' },
      module: { type: 'commonjs' },
    },
  ],
};

/** Workspace packages are consumed as TypeScript source, so tests map them straight to `src`. */
const workspaceModules = {
  '^@stubwise/domain$': '<rootDir>/../../packages/domain/src/index.ts',
  '^@stubwise/templates$': '<rootDir>/../../packages/templates/src/index.ts',
};

const project = (displayName, dir) => ({
  displayName,
  rootDir: `<rootDir>/${dir}`,
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  testEnvironment: 'node',
  transform: swcTransform,
  moduleNameMapper: workspaceModules,
});

module.exports = {
  projects: [
    project('domain', 'packages/domain'),
    project('templates', 'packages/templates'),
    // Only modules with no React Native imports (the HTTP client) are tested here.
    project('mobile', 'apps/mobile'),
    {
      ...project('api', 'apps/api'),
      // Starts an in-process Postgres for the API tests; see the file for why.
      // `cookie` (used by Fastify's test injector) ships as ES modules only, so it is
      // the one dependency that has to be compiled for Jest's CommonJS runtime.
      transform: {
        ...swcTransform,
        '^.+\\.js$': ['@swc/jest', { jsc: { parser: { syntax: 'ecmascript' }, target: 'es2022' }, module: { type: 'commonjs' } }],
      },
      transformIgnorePatterns: ['/node_modules/(?!\\.pnpm/cookie@|cookie/)'],
      globalSetup: '<rootDir>/jest.global-setup.js',
      globalTeardown: '<rootDir>/jest.global-teardown.js',
    },
  ],
};
