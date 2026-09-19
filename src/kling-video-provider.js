import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE_URL = String(process.env.KLING_API_BASE_URL || 'https://api.klingai.com').replace(/\/$/, '');
const ACCESS_KEY = String(process.env.KLING_ACCESS_KEY || '').trim();
const SECRET_KEY = String(process.env.KLING_SECRET_KEY || '').trim();
const LEGACY_API_KEY = String(process.env.KLING_API_KEY || '').trim();
const MODEL = String(process.env.KLING_MODEL || 'kling-v3').trim();
const TIMEOUT_MS = Number(process.env.KLING_TIMEOUT_MS || 20 * 60 * 1000);
const POLL_MS = Number(process.env.KLING_POLL_MS || 6000);

const SUPPORTED_NATIVE_LANGUAGES = new Set(['en', 'es', 'zh-CN', 'ja', 'ko']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function base64url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function klingJwt() {
  if (!ACCESS_KEY || !SECRET_KEY) return '';
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iss: ACCESS_KEY, exp: now + 1800, nbf: now - 5 }));
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(header + '.' + payload).digest('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return header + '.' + payload + '.' + signature;
}

function authHeaders() {
  const token = klingJwt();
  if (token) return { Authorization: `Bearer ${token}` };
  if (LEGACY_API_KEY) return { Authorization: `Bearer ${LEGACY_API_KEY}` };
  return {};
}

function aspectRatio(value) {
  return ['16:9', '9:16', '1:1'].includes(value) ? value : '16:9';
}

function durationFor(value) {
  const n = Math.round(Number(value) || 5);
  if (n < 3 || n > 15) throw new Error('Kling VIDEO 3.0 permite tomas de 3 a 15 segundos.');
  return n;
}

function normalizeLanguage(value) {
  const v = String(value || 'en').trim();
  if (v === 'zh' || v === 'zh_CN') return 'zh-CN';
  return v;
}

function languageName(code) {
  return ({ en: 'English', es: 'Spanish', 'zh-CN': 'Chinese', ja: 'Japanese', ko: 'Korean' })[code] || code;
}

function buildDialoguePrompt(prompt, audioText, audioLanguage = 'en') {
  const scene = String(prompt || '').trim();
  const dialogue = String(audioText || '').trim();
  if (!dialogue) return scene.slice(0, 2500);

  const lang = normalizeLanguage(audioLanguage);
  return [
    scene,
    '',
    'NATIVE AUDIO DIALOGUE:',
    'Generate the visuals and spoken audio together in one pass.',
    'The visible character is the speaker and must remain clearly visible with natural, accurate lip movement synchronized to every spoken word.',
    `Language: ${languageName(lang)}.`,
    'No off-screen narrator. No silent mouth while speech is heard.',
    'Use natural facial expression, breathing, eye movement and delivery matching the dialogue.',
    `[Speaker]: "${dialogue.replaceAll('"', '\\\"')}"`
  ].join('\n').slice(0, 2500);
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
  return Boolean((ACCESS_KEY && SECRET_KEY) || LEGACY_API_KEY);
}

export function nativeDialogueLanguageSupported(value) {
  return SUPPORTED_NATIVE_LANGUAGES.has(normalizeLanguage(value));
}

export function klingSupportedNativeLanguages() {
  return [...SUPPORTED_NATIVE_LANGUAGES];
}

export async function generateKlingVideo({ prompt, negative, audioText, audioLanguage = 'en', aspect = '16:9', duration = 5, resolution = 'high', job }) {
  if (!klingConfigured()) throw new Error('Kling no está configurado. Añade KLING_ACCESS_KEY y KLING_SECRET_KEY en Render.');

  const seconds = durationFor(duration);
  const ratio = aspectRatio(aspect);
  const dialogue = String(audioText || '').trim();
  const hasDialogue = Boolean(dialogue);
  const lang = normalizeLanguage(audioLanguage);

  if (hasDialogue && !nativeDialogueLanguageSupported(lang)) {
    throw new Error(`Kling Native Audio admite actualmente English, Spanish, Chinese, Japanese y Korean. Se solicitó: ${lang}. No se sustituirá por TTS ni se traducirá silenciosamente.`);
  }

  const finalPrompt = buildDialoguePrompt(prompt, dialogue, lang);
  const selectedMode = resolution === 'high' ? 'pro' : 'std';

  const payload = {
    model_name: MODEL,
    prompt: finalPrompt,
    negative_prompt: String(negative || 'blurry, low quality, soft focus, oversaturated, crushed highlights, distorted face, deformed mouth, extra limbs, duplicated people, malformed hands, text artifacts, watermark').slice(0, 2500),
    duration: String(seconds),
    mode: selectedMode,
    aspect_ratio: ratio,
    sound: hasDialogue ? 'on' : 'off',
    cfg_scale: 0.7
  };

  job.provider = `Kling VIDEO 3.0${hasDialogue ? ' · Native Audio' : ''}`;
  job.providerState = 'SUBMITTING';
  job.detail = hasDialogue ? 'Enviando vídeo + diálogo nativo a Kling VIDEO 3.0…' : 'Enviando vídeo a Kling VIDEO 3.0…';

  const created = await requestJson(`${BASE_URL}/v1/videos/text2video`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
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
      headers: authHeaders()
    });
    const state = statusOf(data);
    job.providerState = state.toUpperCase() || 'PROCESSING';
    job.detail = hasDialogue
      ? `Kling está generando vídeo + diálogo nativo (${job.providerState}).`
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
