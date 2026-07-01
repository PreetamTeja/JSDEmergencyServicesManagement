/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/__jest__/**/*.test.{js,jsx}'],
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
    '\\.(png|jpg|jpeg|gif|webp|svg|ico|ttf|woff|woff2|eot)$': '<rootDir>/src/__jest__/__mocks__/fileMock.cjs',
  },
  // Runs before test framework is installed — polyfill import.meta
  setupFiles: ['<rootDir>/src/__jest__/setup/importMetaMock.cjs'],
  // Runs after test framework (adds jest-dom matchers to expect)
  setupFilesAfterEnv: ['@testing-library/jest-dom'],
}
