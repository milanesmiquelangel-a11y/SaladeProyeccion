import fs from 'node:fs/promises';
import path from 'node:path';
import { muxAudioIntoVideo } from './audio-tts.js';

export async function attachGeneratedAudio({ videoPath, audioPath, outputPath, durationSeconds }) {
  if (!videoPath || !audioPath) throw new Error('Faltan el vídeo o el audio para realizar la mezcla.');
  const target = outputPath || path.join(path.dirname(videoPath), `${path.basename(videoPath, path.extname(videoPath))}-voice.mp4`);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await muxAudioIntoVideo({ videoPath, audioPath, outputPath: target, durationSeconds });
  return target;
}
