// https://docs.expo.dev/guides/using-eslint/
// eslint-config-expo v7 (the version pinned for Expo SDK 51) ships the
// legacy config format only, so the flat-config `eslint.config.js` that
// shipped in this repo could never load — `npm run lint` crashed with
// ERR_PACKAGE_PATH_NOT_EXPORTED before reaching a single file.
module.exports = {
  root: true,
  extends: ['expo'],
  ignorePatterns: ['dist/*', '.expo/*', 'node_modules/*'],
};
