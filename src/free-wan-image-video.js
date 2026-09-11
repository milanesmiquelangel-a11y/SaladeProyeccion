import { Client, handle_file } from '@gradio/client';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const freeOutputDir = path.join(publicDir, 'free-image-video');
const freeTempDir = path.join(publicDir, 'free-image-video', 'tmp');
const WAN_SPACE = process.env.WAN_FREE_SPACE || 'multimodalart/wan2-1-fast';
const WAN_ENDPOINT = process.env.WAN_FREE_ENDPOINT || '/generate_video';
const HF_TOKEN = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || '').trim();

function pickVideoValue(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickVideoValue(item);
      if (picked) return picked;
    }
    return '';
  }
  if (typeof value === 'object') return value.url || value.path || value.video?.url || value.video?.path || '';
  return '';
}

function describeError(error, context = '') {
  const message = error?.message || String(error || 'Error desconocido');
  const cause = error?.cause?.message ? ` (${error.cause.message})` : '';
  const status = error?.status ? ` [HTTP ${error.status}]` : '';
  const code = error?.code ? ` [${error.code}]` : '';
  return `${context ? `${context}: ` : ''}${message}${cause}${code}${status}`;
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('FFmpeg no está disponible en el servidor.'));
    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`FFmpeg terminó con código ${code}: ${stderr.slice(-800)}`)));
  });
}

function parsePrompt(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    if (parsed && typeof parsed === 'object' && ('motion' in parsed || 'audioText' in parsed)) {
      return {
        motion: String(parsed.motion || '').trim(),
        audioText: String(parsed.audioText || '').trim().slice(0, 4000),
        audioLanguage: String(parsed.audioLanguage || 'en').trim() || 'en'
      };
    }
  } catch {}
  return { motion: String(value || '').trim(), audioText: '', audioLanguage: 'en' };
}

async function normalizeReferenceImage(imagePath) {
  await fs.mkdir(freeTempDir, { recursive: true });
  const output = path.join(freeTempDir, `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
  await runFfmpeg([
    '-y', '-loop', '1', '-i', imagePath, '-frames:v', '1',
    '-filter_complex',
    '[0:v]scale=576:320:force_original_aspect_ratio=increase,crop=576:320,gblur=sigma=18[bg];[0:v]scale=576:320:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[out]',
    '-map', '[out]', '-q:v', '2', output
  ]);
  return output;
}

async function saveVideoResult(value) {
  const videoValue = pickVideoValue(value);
  if (!videoValue) throw new Error('El motor de vídeo terminó sin devolver el vídeo generado.');

  await fs.mkdir(freeOutputDir, { recursive: true });
  await fs.mkdir(freeTempDir, { recursive: true });
  const filename = `wan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const rawDestination = path.join(freeTempDir, filename);
  const destination = path.join(freeOutputDir, filename);

  if (videoValue.startsWith('http://') || videoValue.startsWith('https://')) {
    const response = await fetch(videoValue);
    if (!response.ok) throw new Error(`No se pudo descargar el vídeo generado (HTTP ${response.status}).`);
    await fs.writeFile(rawDestination, Buffer.from(await response.arrayBuffer()));
  } else {
    await fs.copyFile(videoValue, rawDestination);
  }

  await runFfmpeg([
    '-y', '-i', rawDestination,
    '-vf', 'setpts=2.5*PTS', '-t', '5', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', destination
  ]);

  await fs.rm(rawDestination, { force: true }).catch(() => {});
  return `/free-image-video/${filename}`;
}

function safeJson(value, max = 1800) {
  if (value == null) return '';
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value).slice(0, max);
  }
}

function formatWanStatus(status) {
  if (!status) return '';
  const parts = [
    status.stage,
    status.code,
    status.message,
    status.detail,
    status.queue != null ? `queue=${status.queue}` : '',
    Number.isFinite(status.position) ? `position=${status.position}` : '',
    Number.isFinite(status.eta) ? `eta=${status.eta}s` : '',
    status.original_msg ? `original_msg=${safeJson(status.original_msg)}` : ''
  ].filter(Boolean);
  return parts.join(' | ');
}

export async function generateFreeWanImageVideo({ imagePath, prompt }) {
  let normalizedImagePath = '';
  let lastSpaceError = '';
  try {
    if (!HF_TOKEN) {
      throw new Error('Hugging Face requiere autenticación para usar la cuota ZeroGPU. Configura HF_TOKEN en Render con un token personal de Hugging Face (permiso Read).');
    }

    const request = parsePrompt(prompt);

    // This project uses the Node.js @gradio/client 2.x API.
    // Its Hugging Face authentication option is `token`.
    const app = await Client.connect(WAN_SPACE, {
      token: HF_TOKEN,
      events: ['data', 'status'],
      status_callback: (status) => {
        const state = String(status?.status || '').toLowerCase();
        const detail = String(status?.detail || '').toUpperCase();
        if (state === 'space_error' || state === 'error' || state === 'paused' || detail === 'RUNTIME_ERROR' || detail === 'BUILD_ERROR' || detail === 'CONFIG_ERROR' || detail === 'NO_APP_FILE' || detail === 'PAUSED') {
          lastSpaceError = formatWanStatus(status);
        }
      }
    });

    let api;
    try {
      api = await app.view_api();
    } catch (error) {
      const statusDetail = lastSpaceError ? ` Estado real del Space: ${lastSpaceError}.` : '';
      throw new Error(`${describeError(error, 'No se pudo consultar la API de Wan')}${statusDetail}`);
    }

    if (!api?.named_endpoints?.[WAN_ENDPOINT]) {
      const available = Object.keys(api?.named_endpoints || {}).join(', ');
      throw new Error(`El Space ${WAN_SPACE} no expone ${WAN_ENDPOINT}. Endpoints encontrados: ${available || 'ninguno'}.`);
    }

    normalizedImagePath = await normalizeReferenceImage(imagePath);
    const referenceImage = handle_file(normalizedImagePath);
    const animationPrompt = [
      'Photorealistic adult person animation.',
      'Preserve the exact person shown in the reference image, including face, hair, clothing, body proportions and scene.',
      'Do not create a different person, change clothing, redesign the body or change the background.',
      'Very subtle natural motion only: gentle breathing, realistic blinking when a face is visible, and a tiny natural head movement when appropriate.',
      'Stable identity, realistic anatomy, no morphing, no duplicate person, no face distortion, no camera movement.',
      request.motion
    ].filter(Boolean).join(' ');

    try {
      // Wan Fast is intentionally called with 2 seconds / 48 frames at 24 FPS.
      // The application stretches that generated clip to the final 5-second MP4 afterwards.
      const submission = app.submit(WAN_ENDPOINT, [
        referenceImage,
        animationPrompt.slice(0, 4000),
        320,
        576,
        'distorted face, identity drift, morphing, extra people, duplicate body parts, deformed hands, cartoon, CGI, low resolution, blurry, pixelated, text, watermark',
        2,
        1,
        4,
        42,
        false
      ]);

      let outputData = null;
      let terminalStatus = null;
      const startedAt = Date.now();
      const maxWaitMs = 18 * 60 * 1000;

      for await (const message of submission) {
        if (message?.type === 'data') {
          outputData = message.data;
          continue;
        }

        if (message?.type === 'status') {
          const stage = String(message.stage || '').toLowerCase();
          const text = formatWanStatus(message);
          if (stage === 'error' || message?.success === false) {
            terminalStatus = message;
            lastSpaceError = text || lastSpaceError || 'Wan devolvió un error sin detalles adicionales.';
            break;
          }
        }

        if (Date.now() - startedAt > maxWaitMs) {
          try { submission.return?.(); } catch {}
          throw new Error('Tiempo de espera agotado mientras Wan procesaba la generación.');
        }
      }

      if (terminalStatus || lastSpaceError) {
        const detail = formatWanStatus(terminalStatus) || lastSpaceError || 'sin detalles adicionales';
        throw new Error(`Wan devolvió un error durante /generate_video: ${detail}`);
      }

      const data = Array.isArray(outputData) ? outputData : outputData ? [outputData] : [];
      const output = data.find((item) => pickVideoValue(item)) || data[0];
      const outputUrl = await saveVideoResult(output);

      return {
        outputUrl,
        provider: `Wan2.1 I2V Fast (${WAN_SPACE})`,
        detail: request.audioText
          ? 'Vídeo generado con Wan2.1 I2V Fast; la narración se añadirá en una sola etapa.'
          : 'Vídeo generado con Wan2.1 I2V Fast y CausVid; clip final de 5 segundos.'
      };
    } catch (error) {
      const statusDetail = lastSpaceError ? ` Estado real del Space: ${lastSpaceError}.` : '';
      throw new Error(`${describeError(error, `La generación ${WAN_ENDPOINT} falló`)}${statusDetail}`);
    }
  } catch (error) {
    throw new Error(`Wan I2V no pudo generar el vídeo: ${describeError(error)}`);
  } finally {
    if (normalizedImagePath) await fs.rm(normalizedImagePath, { force: true }).catch(() => {});
  }
}
