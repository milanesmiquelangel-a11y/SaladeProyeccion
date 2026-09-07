import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PIXAZO_API_KEY = process.env.PIXAZO_API_KEY;
const PIXAZO_VIDEO_URL = 'https://gateway.pixazo.ai/ltx-video/v1/text-to-video';
const PIXAZO_STATUS_URL = 'https://gateway.pixazo.ai/v2/requests/status';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'sala-de-proyeccion-api',
    pixazoConfigured: Boolean(PIXAZO_API_KEY),
  });
});

app.post('/api/video/generate', async (req, res) => {
  if (!PIXAZO_API_KEY) {
    return res.status(503).json({
      error: 'PIXAZO_API_KEY no está configurada en el servidor.',
    });
  }

  const { prompt, negative, aspect, width, height, num_frames, frame_rate, steps, cfg, seed } = req.body ?? {};

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'prompt es obligatorio.' });
  }

  if (prompt.length > 4000) {
    return res.status(400).json({ error: 'prompt no puede superar 4000 caracteres.' });
  }

  const payload = { prompt: prompt.trim() };
  if (typeof negative === 'string') payload.negative = negative;
  if (typeof aspect === 'string') payload.aspect = aspect;
  if (Number.isInteger(width)) payload.width = width;
  if (Number.isInteger(height)) payload.height = height;
  if (Number.isInteger(num_frames)) payload.num_frames = num_frames;
  if (typeof frame_rate === 'number') payload.frame_rate = frame_rate;
  if (Number.isInteger(steps)) payload.steps = steps;
  if (typeof cfg === 'number') payload.cfg = cfg;
  if (Number.isInteger(seed)) payload.seed = seed;

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
      return res.status(response.status).json({
        error: 'Pixazo rechazó la solicitud.',
        details: data,
      });
    }

    return res.status(202).json(data);
  } catch (error) {
    console.error('Pixazo generation error:', error);
    return res.status(502).json({
      error: 'No se pudo conectar con Pixazo.',
    });
  }
});

app.get('/api/video/status/:requestId', async (req, res) => {
  if (!PIXAZO_API_KEY) {
    return res.status(503).json({
      error: 'PIXAZO_API_KEY no está configurada en el servidor.',
    });
  }

  const requestId = encodeURIComponent(req.params.requestId);

  try {
    const response = await fetch(`${PIXAZO_STATUS_URL}/${requestId}`, {
      headers: {
        'Ocp-Apim-Subscription-Key': PIXAZO_API_KEY,
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json({
        error: 'Pixazo no pudo consultar el trabajo.',
        details: data,
      });
    }

    return res.json(data);
  } catch (error) {
    console.error('Pixazo status error:', error);
    return res.status(502).json({
      error: 'No se pudo consultar el estado en Pixazo.',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Sala de Proyección API escuchando en http://localhost:${PORT}`);
});
