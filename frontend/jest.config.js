module.exports = {
  preset: 'jest-expo/ios',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-gifted-charts)',
  ],
  // Generous per-test timeout: a cold first run (after npm install) can be slow
  // and a default 5s cap produced spurious failures.
  testTimeout: 30000,
  testMatch: ['<rootDir>/__tests__/**/*.test.tsx'],
  collectCoverageFrom: ['app/**/*.tsx', 'src/**/*.ts', 'src/**/*.tsx'],
};
