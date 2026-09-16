import './wan-mode-bootstrap.js';
import './pixazo-free-prompt-bootstrap.js';
import './pixazo-free-speed-patch.js';
import './gradio-direct-space-fallback.js';
import './generation-error-diagnostic.js';
import './admin-bootstrap.js';
await import('./monetized-entry.js');

// IMPORTANT: install the WAN 2.2 transport bridge last. The billing entry also
// wraps global fetch for legacy status polling; loading the WAN bridge before
// it would allow the legacy Pixazo/LTX transport to remain active during
// generation. Keeping this last preserves all existing routes, billing,
// authentication, FFmpeg and audio while making WAN 2.2 the actual engine.
await import('./wan-provider-bridge.js');
