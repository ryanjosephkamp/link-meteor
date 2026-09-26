// Renders the approved README masthead's flowing-light loop at full resolution for video,
// using the same displacement field as scripts/make-readme-animation.mjs (scaled from its
// 768 px working size). The lettering and floor reflection stay fixed; the PNG is not modified.
import {spawn, spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {resolve} from 'node:path';

export async function renderMeteorFrames(root, outDir, {frames = 90} = {}) {
  const source = resolve(root, 'assets/brand/readme-meteor.png');
  const width = 1536, height = 1024, k = width / 768;
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', source, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], {maxBuffer: width * height * 3 + 1024 * 1024});
  if (decoded.status !== 0) throw new Error(decoded.stderr?.toString() || 'ffmpeg decode failed');
  const original = decoded.stdout;
  if (original.length !== width * height * 3) throw new Error('Unexpected artwork dimensions');
  const field = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 3, g = original[i + 1], b = original[i + 2], sx = x / k, sy = y / k;
    const fade = Math.max(0, Math.min(1, (768 * .59 - sx) / 20)) * Math.max(0, Math.min(1, (512 * .84 - sy) / 16));
    field[i] = fade * Math.max(0, Math.min(1, (g - b - 20) / 95));
    field[i + 1] = (sx - sy) * .028;
    field[i + 2] = (sx + sy) * .043;
  }
  const sample = (x, y, c) => {
    x = Math.max(0, Math.min(width - 1.001, x)); y = Math.max(0, Math.min(height - 1.001, y));
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, i = (iy * width + ix) * 3 + c;
    return (original[i] * (1 - fx) + original[i + 3] * fx) * (1 - fy) + (original[i + width * 3] * (1 - fx) + original[i + width * 3 + 3] * fx) * fy;
  };
  await mkdir(outDir, {recursive: true});
  const encoder = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgb24', '-video_size', `${width}x${height}`, '-framerate', '30', '-i', 'pipe:0', '-q:v', '2', resolve(outDir, '%03d.jpg')], {stdio: ['pipe', 'inherit', 'inherit']});
  const done = once(encoder, 'close');
  for (let frame = 0; frame < frames; frame++) {
    const phase = frame / frames * Math.PI * 2, out = Buffer.from(original);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3, m = field[i]; if (m < .005) continue;
      const u = field[i + 1], v = field[i + 2];
      const flow = (Math.sin(u - phase * 2) - Math.sin(u)) * .8 + (Math.sin(v + u * .7 - phase * 3) - Math.sin(v + u * .7)) * .35;
      const ripple = (Math.sin(v - phase) - Math.sin(v)) * .65;
      const dx = m * (flow + ripple) * 5 * k, dy = m * (flow - ripple) * 3.6 * k;
      const light = 1 + m * (Math.sin(u * 1.4 - phase * 2) - Math.sin(u * 1.4)) * .17;
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(sample(x + dx, y + dy, c) * light)));
    }
    if (!encoder.stdin.write(out)) await once(encoder.stdin, 'drain');
  }
  encoder.stdin.end();
  const [code] = await done;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
  await writeFile(resolve(outDir, 'frames.json'), JSON.stringify({width, height, frames, fps: 30, loopSeconds: frames / 30}, null, 2));
  return {width, height, frames};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(import.meta.dirname, '../..');
  console.log(JSON.stringify(await renderMeteorFrames(root, resolve(root, '.scratch/media/intro'))));
}
