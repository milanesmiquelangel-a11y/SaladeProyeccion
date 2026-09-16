import './wan-mode-bootstrap.js';
import './pixazo-free-prompt-bootstrap.js';
import './pixazo-free-speed-patch.js';
import './gradio-direct-space-fallback.js';
import './generation-error-diagnostic.js';
import './admin-bootstrap.js';

// Install the WAN 2.2 transport before the route layers are mounted so the
// legacy Pixazo/LTX HTTP contract is redirected to WAN 2.2.
await import('./wan-provider-bridge.js');

// Mount the final generation pipeline before monetized-entry registers the
// Express routes. This pipeline preserves continuity, FFmpeg and narration.
await import('./final-generation-bootstrap.js');

// Billing/authentication is mounted last; its middleware remains in front of
// the final generation handlers when the routes are registered.
await import('./monetized-entry.js');
