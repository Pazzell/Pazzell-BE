module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/tests/**/*.test.ts'], // This matches all test files in the tests directory
    // mongodb-memory-server startup + index building can take a while under
    // resource contention (parallel workers) — the 5000ms Jest default is too
    // tight for beforeAll hooks that spin up a fresh in-memory Mongo instance.
    testTimeout: 30000,
  };
