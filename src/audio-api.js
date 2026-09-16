import path from 'node:path';
import fs from 'node:fs/promises';
import { generateSpeech } from './audio-service.js';
import { attachGeneratedAudio } from './patch-audio-mux.js';
import { generateAndAttachAudio } from './audio-natural-integration.js';

const publicDir = path.join(process.cwd(), 'public');
const audioDir = path.join(publicDir, 'generated-audio');
const generatedDir = path.join(publicDir, 'generated');

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

  // Audio-only integration for provider videos that are returned as remote URLs.
  // This does not alter, intercept or replace the video-generation route.
  app.post('/api/audio/mux-remote', async (req, res) => {
    try {
      const videoUrl = String(req.body?.videoUrl || '').trim();
      const audioName = path.basename(String(req.body?.audio || ''));
      const durationSeconds = Number(req.body?.durationSeconds) || 5;
      if (!videoUrl || !audioName) return res.status(400).json({ error: 'Faltan el vídeo remoto o el audio.' });
      const audioPath = path.join(audioDir, audioName);
      await fs.access(audioPath);
      const result = await generateAndAttachAudio({
        videoUrl,
        text: '',
        language: 'en',
        durationSeconds
      }).catch(async (error) => {
        // The helper also generates speech; for an already-generated audio file,
        // perform the same remote download/mux operation without regenerating TTS.
        const parsed = new URL(videoUrl);
        if (parsed.protocol !== 'https:') throw error;
        const host = parsed.hostname.toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) || host === '169.254.169.254') throw error;
        await fs.mkdir(generatedDir, { recursive: true });
        const sourceName = `remote-audio-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
        const outputName = `natural-audio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
        const sourcePath = path.join(generatedDir, sourceName);
        const outputPath = path.join(generatedDir, outputName);
        try {
          const remote = await fetch(parsed.toString(), { redirect: 'follow' });
          if (!remote.ok) throw new Error(`No se pudo descargar el vídeo (HTTP ${remote.status}).`);
          await fs.writeFile(sourcePath, Buffer.from(await remote.arrayBuffer()));
          await attachGeneratedAudio({ videoPath: sourcePath, audioPath, outputPath, durationSeconds });
          return { url: `/generated/${outputName}` };
        } finally {
          await fs.rm(sourcePath, { force: true }).catch(() => {});
        }
      });
      return res.json({ ok: true, ...(result || {}) });
    } catch (error) {
      console.error('Remote audio mux error:', error);
      return res.status(502).json({ error: error.message || 'No se pudo integrar el audio en el vídeo remoto.' });
    }
  });
}
