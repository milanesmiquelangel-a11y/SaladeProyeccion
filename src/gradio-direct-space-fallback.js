import { Client } from '@gradio/client';

// Some Hugging Face Spaces fail through the Space-ID discovery/fetcher path
// while their direct *.hf.space host is reachable. Force the WAN client to
// use the direct Gradio origin for the active WAN Space.
const originalConnect = Client.connect.bind(Client);
const configuredSpace = String(process.env.WAN_SPACE_ID || '').trim();
const activeSpace = configuredSpace && configuredSpace !== 'fffiloni/Wan2.1'
  ? configuredSpace
  : '0AstroKnight0/wan2.1-t2v-1.3b-demo';

if (activeSpace.includes('/')) {
  const [owner, name] = activeSpace.split('/');
  const directOrigin = `https://${owner.toLowerCase()}-${name.toLowerCase().replace(/_/g, '-')}.hf.space`;
  Client.connect = (source, options = {}) => {
    const requested = String(source || '');
    const target = requested === activeSpace ? directOrigin : source;
    console.log(`[WAN] Gradio directo: ${target}`);
    return originalConnect(target, options);
  };
}
