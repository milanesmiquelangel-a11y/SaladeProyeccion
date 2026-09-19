import fs from 'node:fs/promises';
import path from 'node:path';

const BASE_URL = String(process.env.KLING_API_BASE_URL || 'https://api.klingai.com').replace(/\/$/, '');
const API_KEY = String(process.env.KLING_API_KEY || '').trim();
const MODEL = String(process.env.KLING_MODEL || 'kling-v3').trim();
const MODE = String(process.env.KLING_MODE || 'auto').trim();
const TIMEOUT_MS = Number(process.env.KLING_TIMEOUT_MS || 20 * 60 * 1000);
const POLL_MS = Number(process.env.KLING_POLL_MS || 6000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function aspectRatio(value) {
  return ['16:9', '9:16', '1:1'].includes(value) ? value : '16:9';
}

function durationFor(value) {
  const n = Math.round(Number(value) || 5);
  if (n < 3 || n > 15) throw new Error('Kling VIDEO 3.0 admite clips de 3 a 15 segundos. Para diálogo nativo no se debe fragmentar automáticamente el discurso.');
  return n;
}

function buildDialoguePrompt(prompt, audioText, audioLanguage = 'en') {
  const scene = String(prompt || '').trim();
  const dialogue = String(audioText || '').trim();
  if (!dialogue) return scene;

  return [
    scene,
    '',
    'DIALOGUE / PERFORMANCE DIRECTIVE:',
    'The visible character is the speaker. Generate the spoken dialogue as native audio inside the video, not as an added voice-over track.',
    'The speaker must visibly articulate every spoken word with accurate, natural mouth movement and facial performance synchronized to the generated speech.',
    'Keep the speaker in a medium close-up or medium shot with the face clearly visible for the entire spoken passage. Do not cover the mouth.',
    `Generate the dialogue in the requested language: ${String(audioLanguage || 'en')}.`,
    'No narration from an off-screen narrator. No voice without a visible speaking character. No silent mouth while speech is heard.',
    'Use natural pauses, breathing, eye movement and subtle facial expressions that match the meaning and tone of the dialogue.',
    `Exact dialogue to speak: "${dialogue.replaceAll('"', '\\\"')}"`
  ].join('\n');
}

function extractTaskId(data) {
  return data?.data?.task_id || data?.data?.id || data?.task_id || data?.id || '';
}

function extractVideoUrl(data) {
  const candidates = [
    data?.data?.task_result?.videos?.[0]?.url,
    data?.data?.task_result?.videos?.[0]?.download_url,
    data?.data?.task_result?.videos?.[0]?.video_url,
    data?.data?.task_result?.video_url,
    data?.output?.media_url,
    data?.output?.url,
    data?.video_url
  ];
  return candidates.find((v) => typeof v === 'string' && /^https?:\/\//i.test(v)) || '';
}

function statusOf(data) {
  return String(data?.data?.task_status || data?.status || data?.state || '').toLowerCase();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.message || data?.error || data?.data?.task_status_msg || `HTTP ${response.status}`;
    throw new Error(`Kling rechazó la solicitud: ${message}`);
  }
  return data;
}

export function klingConfigured() {
  return Boolean(API_KEY);
}

export async function generateKlingVideo({ prompt, negative, audioText, audioLanguage = 'en', aspect = '16:9', duration = 5, resolution = 'high', job }) {
  if (!API_KEY) throw new Error('Kling VIDEO 3.0 no está configurado. Añade KLING_API_KEY en Render.');

  const seconds = durationFor(duration);
  const ratio = aspectRatio(aspect);
  const hasDialogue = Boolean(String(audioText || '').trim());
  const finalPrompt = buildDialoguePrompt(prompt, audioText, audioLanguage);

  if (hasDialogue && seconds > 15) throw new Error('El diálogo nativo de Kling debe generarse en una sola toma de 3–15 segundos para mantener la sincronización de boca.');

  const selectedMode = MODE === 'auto' ? (resolution === 'high' ? 'pro' : 'std') : MODE;
  const payload = {
    model_name: MODEL,
    prompt: finalPrompt.slice(0, 7000),
    negative_prompt: String(negative || 'blurry, low quality, distorted face, deformed mouth, extra teeth, frozen expression, duplicated people, malformed hands, text artifacts, watermark').slice(0, 4000),
    duration: String(seconds),
    mode: selectedMode,
    aspect_ratio: ratio,
    sound: hasDialogue ? 'on' : 'off'
  };

  // Do not silently downgrade a dialogue request to a video with muxed TTS.
  // Native audio is the quality path we are deliberately validating.
  job.provider = `Kling ${MODEL} ${hasDialogue ? 'Native Audio' : 'Video'}`;
  job.providerState = 'SUBMITTING';
  job.detail = hasDialogue ? 'Enviando escena y diálogo al motor nativo de Kling…' : 'Enviando escena a Kling VIDEO 3.0…';

  const created = await requestJson(`${BASE_URL}/v1/videos/text2video`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const taskId = extractTaskId(created);
  if (!taskId) throw new Error(`Kling no devolvió task_id: ${JSON.stringify(created).slice(0, 1200)}`);
  job.providerRequestId = taskId;
  job.providerState = 'SUBMITTED';

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (job.cancelled) throw Object.assign(new Error('Generación cancelada por el usuario.'), { code: 'CANCELLED' });
    await sleep(POLL_MS);
    const data = await requestJson(`${BASE_URL}/v1/videos/text2video/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    });
    const state = statusOf(data);
    job.providerState = state.toUpperCase() || 'PROCESSING';
    job.detail = hasDialogue
      ? `Kling está generando vídeo + diálogo sincronizado (${job.providerState}).`
      : `Kling está generando el vídeo (${job.providerState}).`;

    if (['succeed', 'succeeded', 'completed', 'success'].includes(state)) {
      const url = extractVideoUrl(data);
      if (!url) throw new Error('Kling terminó correctamente pero no devolvió la URL del vídeo.');
      return { url, taskId, nativeAudio: hasDialogue, duration: seconds, resolution };
    }
    if (['failed', 'error', 'cancelled', 'canceled'].includes(state)) {
      const message = data?.data?.task_status_msg || data?.message || `estado ${state}`;
      throw Object.assign(new Error(`Kling terminó la generación con error: ${message}`), { code: state === 'cancelled' || state === 'canceled' ? 'CANCELLED' : 'FAILED' });
    }
  }

  throw Object.assign(new Error('La generación de Kling superó el límite de 20 minutos.'), { code: 'TIMEOUT' });
}

export async function downloadKlingVideo(url, targetPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`No se pudo descargar el vídeo de Kling (HTTP ${response.status}).`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, Buffer.from(await response.arrayBuffer()));
}
