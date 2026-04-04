const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow WASM assets for @signalapp/libsignal-client
config.resolver.assetExts.push('wasm');

// Resolve libsignal-client to its Node-compatible entrypoint.
// In Hermes (RN 0.72+) WebAssembly is available, so the WASM build works.
config.resolver.alias = {
  ...config.resolver.alias,
};

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  crypto: require.resolve('./crypto-mock.js'),
  'node:crypto': require.resolve('./crypto-mock.js'),
  'node:buffer': require.resolve('buffer/'),
  'node:net': require.resolve('./crypto-mock.js'),
  'node:http': require.resolve('./crypto-mock.js'),
  'node:https': require.resolve('./crypto-mock.js'),
  'node:events': require.resolve('./crypto-mock.js'),
  'node:url': require.resolve('./crypto-mock.js'),
  'node:stream': require.resolve('./crypto-mock.js'),
  'node:string_decoder': require.resolve('./crypto-mock.js'),
  fs: require.resolve('./crypto-mock.js'),
  path: require.resolve('./crypto-mock.js'),
  os: require.resolve('./crypto-mock.js'),
  zlib: require.resolve('./crypto-mock.js'),
  tls: require.resolve('./crypto-mock.js'),
  child_process: require.resolve('./crypto-mock.js'),
  assert: require.resolve('./crypto-mock.js'),
  constants: require.resolve('./crypto-mock.js'),
};

// Ensure .cjs files are resolved for ESM-compat packages
config.resolver.sourceExts.push('cjs');

module.exports = config;
