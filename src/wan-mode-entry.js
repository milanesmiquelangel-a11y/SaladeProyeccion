import './wan-runtime-safety.js';
import './final-generation-bootstrap.js';
import './admin-bootstrap.js';
await import('./monetized-entry.js');

// The final-generation bootstrap must load before monetized-entry so its
// Express registration hooks replace the legacy Pixazo handlers when server.js
// registers its routes. Billing, authentication, PayPal and FFmpeg remain in
// their existing modules; only the generation transport is replaced.
