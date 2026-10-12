module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts'], // This matches all test files in the tests directory
    // Pins NODE_ENV=test and stubs every external credential before any module loads.
    setupFiles: ['<rootDir>/tests/env.ts'],
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
    // mongodb-memory-server startup + index building can take a while under
    // resource contention (parallel workers) — the 5000ms Jest default is too
    // tight for beforeAll hooks that spin up a fresh in-memory Mongo instance.
    testTimeout: 180000,
    // One worker: parallel suites each start their own mongod, which starves startup on small machines.
    maxWorkers: 1,
  };
