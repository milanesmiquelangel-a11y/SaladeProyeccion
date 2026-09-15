import { Client } from '@gradio/client';

// Some Hugging Face Spaces fail through the Space-ID discovery/fetcher path
// while their direct *.hf.space host is reachable. Force the WAN client to
// use the direct Gradio origin when a Space ID is supplied.
const originalConnect = Client.connect.bind(Client);
const originalSpaceId = String(process.env.WAN_SPACE_ID || '').trim();

if (originalSpaceId && originalSpaceId.includes('/') && originalSpaceId !== 'fffiloni/Wan2.1') {
  const [owner, name] = originalSpaceId.split('/');
  const directOrigin = `https://${owner.toLowerCase()}-${name.toLowerCase().replace(/_/g, '-')}.hf.space`;
  Client.connect = (source, options = {}) => {
    const requested = String(source || '');
    const target = requested === originalSpaceId ? directOrigin : source;
    console.log(`[WAN] Gradio directo: ${target}`);
    return originalConnect(target, options);
  };
}
