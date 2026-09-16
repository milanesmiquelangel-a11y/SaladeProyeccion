import { Client } from '@gradio/client';

// Keep the direct Gradio workaround aligned with the WAN 2.2 provider.
// The provider itself also handles multiple WAN 2.2 fallback Spaces.
const originalConnect = Client.connect.bind(Client);
const configuredSpace = String(process.env.WAN_SPACE_ID || '').trim();
const activeSpace = configuredSpace && !/wan2\.1/i.test(configuredSpace)
  ? configuredSpace
  : 'Upsampler/wan-2-2-5b-video';

function makeDirectOrigin(space) {
  const [owner, name] = String(space).split('/');
  if (!owner || !name) return '';
  const normalizedOwner = owner.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return `https://${normalizedOwner}-${normalizedName}.hf.space`;
}

if (activeSpace.includes('/')) {
  const directOrigin = makeDirectOrigin(activeSpace);
  Client.connect = (source, options = {}) => {
    const requested = String(source || '');
    const target = requested === activeSpace ? directOrigin : source;
    console.log(`[WAN 2.2] Gradio directo: ${target}`);
    return originalConnect(target, options);
  };
}
