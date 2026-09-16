import path from 'node:path';
import fs from 'node:fs/promises';
import { generateSpeech } from './audio-service.js';
import { attachGeneratedAudio } from './patch-audio-mux.js';

const publicDir = path.join(process.cwd(), 'public');
const audioDir = path.join(publicDir, 'generated-audio');
const generatedDir = path.join(publicDir, 'generated');

function assertSafeRemoteUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:') throw new Error('El vídeo remoto debe utilizar HTTPS.');
  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === '169.254.169.254') {
    throw new Error('La dirección del vídeo remoto no está permitida.');
  }
  return parsed.toString();
}

export function mountAudioApi(app) {
  app.post('/api/audio/generate', async (req, res) => {
    try {
      const text = String(req.body?.text || '').trim();
      const language = String(req.body?.language || 'en').trim();
      if (!text) return res.status(400).json({ error: 'Falta el texto para generar la voz.' });
      const result = await generateSpeech({ text, language, outputDir: audioDir });
      return res.json({ ok: true, url: `/generated-audio/${path.basename(result.filePath)}`, provider: result.provider, language: result.language, fallback: result.fallback });
    } catch (error) {
      console.error('Audio generation error:', error);
      return res.status(502).json({ error: error.message || 'No se pudo generar el audio.' });
    }
  });

  app.post('/api/audio/mux', async (req, res) => {
    try {
      const videoName = path.basename(String(req.body?.video || ''));
      const audioName = path.basename(String(req.body?.audio || ''));
      const durationSeconds = Number(req.body?.durationSeconds) || undefined;
      if (!videoName || !audioName) return res.status(400).json({ error: 'Faltan el vídeo o el audio.' });
      const videoPath = path.join(generatedDir, videoName);
      const audioPath = path.join(audioDir, audioName);
      await fs.access(videoPath); await fs.access(audioPath);
      const outputName = `${path.parse(videoName).name}-voice.mp4`;
      const outputPath = path.join(generatedDir, outputName);
      await attachGeneratedAudio({ videoPath, audioPath, outputPath, durationSeconds });
      return res.json({ ok: true, url: `/generated/${outputName}` });
    } catch (error) {
      console.error('Audio mux error:', error);
      return res.status(502).json({ error: error.message || 'No se pudo unir el audio al vídeo.' });
    }
  });

  // Audio-only endpoint for a completed provider video returned as an HTTPS URL.
  // The existing video-generation endpoint is not modified or intercepted.
  app.post('/api/audio/mux-remote', async (req, res) => {
    let sourcePath = '';
    try {
      const videoUrl = assertSafeRemoteUrl(req.body?.videoUrl);
      const audioName = path.basename(String(req.body?.audio || ''));
      const durationSeconds = Math.max(1, Number(req.body?.durationSeconds) || 5);
      if (!audioName) return res.status(400).json({ error: 'Falta el audio.' });
      const audioPath = path.join(audioDir, audioName);
      await fs.access(audioPath);
      await fs.mkdir(generatedDir, { recursive: true });

      const remote = await fetch(videoUrl, { redirect: 'follow' });
      if (!remote.ok) throw new Error(`No se pudo descargar el vídeo para añadir el audio (HTTP ${remote.status}).`);
      const maxBytes = 250 * 1024 * 1024;
      const contentLength = Number(remote.headers.get('content-length') || 0);
      if (contentLength > maxBytes) throw new Error('El vídeo es demasiado grande para el montaje de audio.');
      const bytes = Buffer.from(await remote.arrayBuffer());
      if (bytes.length > maxBytes) throw new Error('El vídeo es demasiado grande para el montaje de audio.');

      sourcePath = path.join(generatedDir, `remote-audio-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
      const outputName = `natural-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
      const outputPath = path.join(generatedDir, outputName);
      await fs.writeFile(sourcePath, bytes);
      await attachGeneratedAudio({ videoPath: sourcePath, audioPath, outputPath, durationSeconds });
      return res.json({ ok: true, url: `/generated/${outputName}` });
    } catch (error) {
      console.error('Remote audio mux error:', error);
      return res.status(502).json({ error: error.message || 'No se pudo integrar el audio en el vídeo remoto.' });
    } finally {
      if (sourcePath) await fs.rm(sourcePath, { force: true }).catch(() => {});
    }
  });
}
