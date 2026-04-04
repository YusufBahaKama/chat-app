const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Allow WASM assets for @signalapp/libsignal-client
config.resolver.assetExts.push('wasm');

// Resolve libsignal-client to its Node-compatible entrypoint.
// In Hermes (RN 0.72+) WebAssembly is available, so the WASM build works.
config.resolver.alias = {
  ...config.resolver.alias,
};

// Ensure .cjs files are resolved for ESM-compat packages
config.resolver.sourceExts.push('cjs');

module.exports = config;
