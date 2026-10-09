// Builds dist/goal-explainer.html: inlines src/styles.css, src/main.js and the
// three logo PNGs (as data URIs) into one self-contained page.
// Usage: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const MARK_MAX_WIDTH = 400;
const WORDMARK_MAX_WIDTH = 1200;

mkdirSync(dist, { recursive: true });

let html = readFileSync(join(src, 'index.html'), 'utf8');
const css = readFileSync(join(src, 'styles.css'), 'utf8');
const js = readFileSync(join(src, 'main.js'), 'utf8');

// Pre-resized assets live in assets/ so the build is identical on macOS and on Vercel's Linux builders.
// If one is missing, fall back to resizing with sips (macOS only), then to the original file.
function downscaled(name, maxWidth) {
  const pre = join(root, 'assets', name.replace('.png', '-' + maxWidth + '.png'));
  if (existsSync(pre)) return pre;
  const original = join(root, name);
  try {
    const width = Number(execFileSync('sips', ['-g', 'pixelWidth', original]).toString().match(/pixelWidth:\s*(\d+)/)[1]);
    if (width <= maxWidth) return original;
    const out = join(tmpdir(), name.replace('.png', '-' + maxWidth + '.png'));
    execFileSync('sips', ['--resampleWidth', String(maxWidth), original, '--out', out], { stdio: 'ignore' });
    return out;
  } catch (err) {
    console.warn('Could not downscale ' + name + ', using the original:', err.message);
    return original;
  }
}

const images = {
  '../goal-mark.png': downscaled('goal-mark.png', MARK_MAX_WIDTH),
  '../goal-wordmark-white.png': downscaled('goal-wordmark-white.png', WORDMARK_MAX_WIDTH)
};

for (const [ref, file] of Object.entries(images)) {
  if (!existsSync(file)) throw new Error('Missing image: ' + file);
  const uri = 'data:image/png;base64,' + readFileSync(file).toString('base64');
  const before = html.split('src="' + ref + '"').length - 1;
  html = html.split('src="' + ref + '"').join('src="' + uri + '"');
  console.log(`inlined ${ref} (${before} use${before === 1 ? '' : 's'}, ${(statSync(file).size / 1024).toFixed(0)} KB)`);
}

html = html.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>');

// Two builds from one source: the full player, and an autoplay version with the control bar hidden.
const builds = [
  { file: 'goal-explainer.html', js: js },
  { file: 'goal-explainer-autoplay.html', js: js.replace('controls: true', 'controls: false').replace('captions: true', 'captions: false') }
];
for (const b of builds) {
  if (b.file.includes('autoplay') && !(b.js.includes('controls: false') && b.js.includes('captions: false'))) throw new Error('Could not switch CONFIG controls and captions off.');
  const page = html.replace('<script src="main.js"></script>', '<script>\n' + b.js + '\n</script>');
  if (page.includes('styles.css') || page.includes('main.js"')) throw new Error('A src reference was not inlined.');
  const out = join(dist, b.file);
  writeFileSync(out, page);
  const kb = statSync(out).size / 1024;
  console.log(`wrote ${resolve(out)} (${kb.toFixed(0)} KB)`);
  if (kb > 1536) console.warn('WARNING: built file is over 1.5 MB');
}

// Deploy output for Vercel: the clean autoplay build at the site root, the full player at /player.
const pub = join(root, 'public');
mkdirSync(pub, { recursive: true });
writeFileSync(join(pub, 'index.html'), readFileSync(join(dist, 'goal-explainer-autoplay.html')));
writeFileSync(join(pub, 'player.html'), readFileSync(join(dist, 'goal-explainer.html')));
console.log('wrote public/index.html (autoplay) and public/player.html (full player)');
