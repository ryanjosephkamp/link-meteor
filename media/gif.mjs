// Cuts the README's demo GIF from the site's demo video (media/videos/demo.mjs): the title card as
// a still, a region selected and saved, the separate fields, then the download and the workbook.
// Writes assets/demo/link-meteor-demo.gif and, for reduced motion, assets/demo/link-meteor-demo.png
// (the "7 links selected" frame, the video's poster time).
//
// Usage: node media/gif.mjs
// The cut times are seconds into the published 1.0.0 video, so the script stops if the video is a
// different file. Requires an installed ffmpeg; nothing is downloaded.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';

const root = resolve(import.meta.dirname, '..');
const video = resolve(root, 'site/assets/video/link-meteor-demo.mp4');
const videoSha256 = '3229ae9905a939ae2a8e8efa32db15f736a53a1e8d7db8049efd77a2dd1fc7d8';
const outDir = resolve(root, 'assets/demo');
const gif = resolve(outDir, 'link-meteor-demo.gif');
const still = resolve(outDir, 'link-meteor-demo.png');

const width = 1080, fps = 8, colors = 128;
const title = {at: 2, hold: 1.6};
const parts = [[4, 22.9], [43.1, 51]];
const fade = 0.3;
const stillAt = 12.4;

const sha = createHash('sha256').update(readFileSync(video)).digest('hex');
if (sha !== videoSha256) throw new Error(`${video} is not the video these cut times were chosen for. Check the times against the new video's captions (its .vtt), then update them and videoSha256.`);
mkdirSync(outDir, {recursive: true});

// One palette for the whole GIF. A frame identical to the one before costs a few bytes, since only
// the changed rectangle of each frame is stored.
const scale = `fps=${fps},scale=${width}:-2:flags=lanczos,setpts=PTS-STARTPTS`;
const [a, b] = parts;
const graph = [
  `[0:v]${scale},trim=end_frame=1,tpad=stop_mode=clone:stop_duration=${title.hold}[t]`,
  `[1:v]${scale}[a]`,
  `[2:v]${scale}[b]`,
  `[a][b]xfade=transition=fade:duration=${fade}:offset=${(a[1] - a[0] - fade).toFixed(2)}[ab]`,
  '[t][ab]concat=n=2:v=1:a=0,split[x][y]',
  `[x]palettegen=max_colors=${colors}:stats_mode=diff[p]`,
  '[y][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle',
].join(';');
const input = (from, to) => ['-ss', String(from), '-to', String(to), '-i', video];
execFileSync('ffmpeg', ['-v', 'error', '-y', ...input(title.at, title.at + 0.2), ...input(...a), ...input(...b),
  '-filter_complex', graph, '-loop', '0', gif], {stdio: 'inherit'});
execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(stillAt), '-i', video, '-frames:v', '1',
  '-vf', `scale=${width}:-2:flags=lanczos,split[x][y];[x]palettegen[p];[y][p]paletteuse=dither=bayer:bayer_scale=5`, still], {stdio: 'inherit'});

const probe = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames',
  '-show_entries', 'format=duration', '-of', 'json', gif], {encoding: 'utf8'});
const {streams: [s], format} = JSON.parse(probe);
const mb = (file) => (statSync(file).size / 1e6).toFixed(1);
console.log(`${gif}: ${s.width}×${s.height}, ${Number(format.duration).toFixed(1)} s, ${s.nb_read_frames} frames, ${mb(gif)} MB`);
console.log(`${still}: ${mb(still)} MB`);
