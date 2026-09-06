/*
 * mock-bridge.js — compatibility shim. The mock host now lives in
 * paean-mock.js (same `mockBridgeSource(opts)` API plus every SDK 1.10
 * namespace, feed preview, paid apps, strict consent checks and a browser
 * `?mock=1` mode). Keep requiring this name if you like; new code should use
 * paean-mock.js directly.
 */
if (typeof module !== 'undefined' && module.exports) module.exports = require('./paean-mock.js');
