/** Integration tests need DATABASE_URL (a disposable database) and REDIS_URL. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.spec.json' }] },
  testTimeout: 30000,
  maxWorkers: 1,
};
