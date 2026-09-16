import './wan-runtime-safety.js';
import './final-generation-bootstrap.js';
import './admin-bootstrap.js';
await import('./monetized-entry.js');

// Load the final generation and runtime-safety layers before monetization so
// Express registration hooks use the WAN 2.2 pipeline for video generation.
// Billing, authentication, PayPal and FFmpeg remain in their existing modules.
