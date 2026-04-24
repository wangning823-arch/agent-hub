module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.js', '**/?(*.)+(spec|test).js'],
  moduleFileExtensions: ['js', 'json', 'node'],
  clearMocks: true,
  collectCoverageFrom: ['*.js', '!server.js', '!jest.config.js'],
  coverageReporters: ['text', 'lcov']
};
