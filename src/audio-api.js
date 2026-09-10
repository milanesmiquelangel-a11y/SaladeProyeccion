import path from 'node:path';
import fs from 'node:fs/promises';
import { generateSpeech } from './audio-service.js';
import { attachGeneratedAudio } from './patch-audio-mux.js';

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
}
