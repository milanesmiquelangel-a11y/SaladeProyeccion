import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const PIXAZO_VIDEO_URL = process.env.PIXAZO_VIDEO_URL || 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';
const PIXAZO_STATUS_URL = process.env.PIXAZO_STATUS_URL || 'https://gateway.pixazo.ai/v2/requests/status';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sala-de-proyeccion-api',
    provider: 'Pixazo LTX 2.5 Free',
    generationReady: Boolean(PIXAZO_API_KEY),
    pixazoConfigured: Boolean(PIXAZO_API_KEY),
  });
});

function dimensionsFor(aspect, quality) {
  const size = quality === 'high' ? 1024 : 768;
  const map = {
    '16:9': [size, Math.round((size * 9) / 16 / 32) * 32],
    '9:16': [Math.round((size * 9) / 16 / 32) * 32, size],
    '1:1': [size, size],
  };
  return map[aspect] || map['16:9'];
}

function frameCountFor(duration, frameRate) {
  const requested = Math.max(1, Number(duration) || 5) * (Number(frameRate) || 24);
  const allowed = [];
  for (let frames = 25; frames <= 121; frames += 8) allowed.push(frames);
  return allowed.reduce((best, value) => Math.abs(value - requested) < Math.abs(best - requested) ? value : best, allowed[0]);
}

app.post('/api/video/generate', async (req, res) => {
  if (!PIXAZO_API_KEY) {
    return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  }

  const { prompt, negative, aspect, duration, resolution, frameRate } = req.body ?? {};

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt es obligatorio.' });
  }
  if (prompt.trim().length > 4000) {
    return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  }

  const allowedAspects = new Set(['16:9', '9:16', '1:1']);
  const selectedAspect = allowedAspects.has(aspect) ? aspect : '16:9';
  const selectedQuality = resolution === 'high' ? 'high' : 'standard';
  const selectedDuration = Number(duration) === 4 ? 4 : 5;
  const selectedFrameRate = Number(frameRate) === 30 ? 30 : 24;
  const [width, height] = dimensionsFor(selectedAspect, selectedQuality);
  const numFrames = frameCountFor(selectedDuration, selectedFrameRate);

  const payload = {
    prompt: prompt.trim(),
    aspect: selectedAspect,
    width,
    height,
    num_frames: numFrames,
    frame_rate: selectedFrameRate,
  };

  if (typeof negative === 'string' && negative.trim()) {
    payload.negative = negative.trim().slice(0, 4000);
  }

  try {
    const response = await fetch(PIXAZO_VIDEO_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = data?.message || data?.error || data?.detail;
      return res.status(response.status).json({
        error: providerMessage
          ? `Pixazo rechazó la solicitud: ${providerMessage}`
          : `Pixazo rechazó la solicitud (HTTP ${response.status}).`,
        details: data,
      });
    }

    return res.status(response.status === 200 ? 200 : 202).json({
      ...data,
      settings: { aspect: selectedAspect, duration: selectedDuration, resolution: selectedQuality, frameRate: selectedFrameRate, width, height, numFrames },
    });
  } catch (error) {
    console.error('Pixazo generation error:', error);
    return res.status(502).json({ error: 'No se pudo conectar con Pixazo.' });
  }
});

app.get('/api/video/status/:requestId', async (req, res) => {
  if (!PIXAZO_API_KEY) {
    return res.status(503).json({ error: 'PIXAZO_API_KEY no está configurada en el servidor.' });
  }

  const requestId = encodeURIComponent(req.params.requestId);

  try {
    const response = await fetch(`${PIXAZO_STATUS_URL}/${requestId}`, {
      headers: { 'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY },
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = data?.message || data?.error || data?.detail;
      return res.status(response.status).json({
        error: providerMessage
          ? `Pixazo no pudo consultar el trabajo: ${providerMessage}`
          : `Pixazo no pudo consultar el trabajo (HTTP ${response.status}).`,
        details: data,
      });
    }
    return res.json(data);
  } catch (error) {
    console.error('Pixazo status error:', error);
    return res.status(502).json({ error: 'No se pudo consultar el estado en Pixazo.' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Sala de Proyección escuchando en http://localhost:${PORT}`);
});
