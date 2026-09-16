import { Client } from '@gradio/client';

// Some Hugging Face Spaces fail through the Space-ID discovery/fetcher path
// while their direct *.hf.space host is reachable. Force the WAN client to
// use the direct Gradio origin for the active WAN Space.
const originalConnect = Client.connect.bind(Client);
const configuredSpace = String(process.env.WAN_SPACE_ID || '').trim();
const activeSpace = configuredSpace && configuredSpace !== 'fffiloni/Wan2.1'
  ? configuredSpace
  : '0AstroKnight0/wan2.1-t2v-1.3b-demo';

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
    console.log(`[WAN] Gradio directo: ${target}`);
    return originalConnect(target, options);
  };
}
