import { Client } from '@gradio/client';

const SPACE = process.env.WAN_SPACE_ID || 'fffiloni/Wan2.1';
const ENDPOINT = process.env.WAN_ENDPOINT || '/t2v_generation';
const HF_TOKEN = process.env.HF_TOKEN || undefined;
let clientPromise;

async function getClient() {
  if (!clientPromise) {
    clientPromise = Client.connect(SPACE, {
      ...(HF_TOKEN ? { token: HF_TOKEN } : {}),
      events: ['status', 'data'],
      space_status: (status) => {
        console.log('[WAN]', status?.status || 'unknown', status?.message || '');
      }
    });
  }
  return clientPromise;
}

function outputUrl(data) {
  const first = Array.isArray(data) ? data[0] : data;
  if (typeof first === 'string' && /^https?:\/\//i.test(first)) return first;
  if (first && typeof first === 'object') {
    if (typeof first.url === 'string' && /^https?:\/\//i.test(first.url)) return first.url;
    if (typeof first.path === 'string' && /^https?:\/\//i.test(first.path)) return first.path;
  }
  return '';
}

export async function generateWanVideo({ prompt, negative, aspect = '16:9', job }) {
  const app = await getClient();
  const resolution = aspect === '9:16' ? '480*832' : aspect === '1:1' ? '624*624' : '832*480';
  const steps = Number(process.env.WAN_STEPS || 20);
  const guide = Number(process.env.WAN_GUIDE_SCALE || 6);
  const shift = Number(process.env.WAN_SHIFT_SCALE || 8);
  const seed = -1;

  job.providerState = 'QUEUED';
  job.detail = 'Enviando el prompt a WAN 2.1…';

  const submission = app.submit(ENDPOINT, [
    prompt,
    resolution,
    steps,
    guide,
    shift,
    seed,
    String(negative || '')
  ]);
  job.gradioJob = submission;

  let finalData = null;
  for await (const message of submission) {
    if (message.type === 'status') {
      const status = message.status || {};
      job.providerState = String(status.stage || 'PROCESSING').toUpperCase();
      if (status.position != null) {
        job.detail = `WAN 2.1 está en cola (posición ${status.position})…`;
      } else if (status.eta != null) {
        job.detail = `WAN 2.1 está procesando (estimación ${Math.ceil(status.eta)} s)…`;
      } else {
        job.detail = 'WAN 2.1 está generando el vídeo…';
      }
    }
    if (message.type === 'data') finalData = message.data;
  }

  job.gradioJob = null;
  const url = outputUrl(finalData);
  if (!url) throw new Error('WAN 2.1 terminó sin devolver el archivo de vídeo.');
  job.providerState = 'COMPLETED';
  return url;
}

export function cancelWanVideo(job) {
  try { job.gradioJob?.cancel?.(); } catch (_) {}
  job.gradioJob = null;
}
