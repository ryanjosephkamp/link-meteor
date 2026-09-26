// Schematic illustrations for steps that happen in Chrome's own windows (file picker, toolbar
// menu) or the operating system (unzipping). They are flat diagrams in the brand style, not
// imitations of native windows, and every scene using one is tagged "Illustration" on screen.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (x) => { x = clamp(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const LIME = '#c3f344', INK = '#eef0f4', MUTED = '#a9b0bd', CARD = '#1d2740', LINE = 'rgba(255,255,255,.14)';
const folderPath = (x, y, w, h, c) => `<path d="M${x} ${y + 18}a12 12 0 0 1 12-12h${w * .32}l${16} ${16}h${w * .68 - 28}a12 12 0 0 1 12 12v${h - 34}a12 12 0 0 1-12 12h${-w + 24}a12 12 0 0 1-12-12Z" fill="${c}"/>`;
const fileIcon = (x, y, label, color) => `<g transform="translate(${x} ${y})"><path d="M0 0h96l40 40v130a10 10 0 0 1-10 10H10A10 10 0 0 1 0 170Z" fill="#f4f6fa"/><path d="M96 0v30a10 10 0 0 0 10 10h30" fill="#d8dde6"/><rect x="18" y="104" width="100" height="40" rx="8" fill="${color}"/><text x="68" y="132" text-anchor="middle" font-size="24" font-weight="800" fill="#fff">${label}</text></g>`;

export function illustration(kind, box, scene) {
  if (kind === 'unzip') {
    const entries = scene.entries;
    box.innerHTML = `<svg viewBox="0 0 1520 855">
      <g id="zip">${fileIcon(300, 250, 'ZIP', '#5f6f8f')}<text x="368" y="480" text-anchor="middle" font-size="30" fill="${INK}" font-weight="700">${scene.zip}</text></g>
      <g id="arrow" opacity="0"><path d="M540 340h260" stroke="${LIME}" stroke-width="8" stroke-linecap="round"/><path d="M780 312l32 28-32 28" fill="none" stroke="${LIME}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><text x="670" y="310" text-anchor="middle" font-size="26" fill="${MUTED}">Unzip</text></g>
      <g id="folder" opacity="0">${folderPath(880, 220, 330, 230, '#3d6fd8')}<text x="1045" y="490" text-anchor="middle" font-size="30" fill="${INK}" font-weight="700">${scene.folder}</text>
        <g font-family="Atkinson Hyperlegible Mono, monospace" font-size="24" fill="${MUTED}">${entries.map((e, i) => `<text class="entry" x="900" y="${548 + i * 38}" opacity="0">${e === 'manifest.json' ? `<tspan fill="${LIME}">${e}</tspan>` : e}</text>`).join('')}</g></g>
    </svg>`;
    const arrow = box.querySelector('#arrow'), folder = box.querySelector('#folder'), rows = [...box.querySelectorAll('.entry')];
    return (t) => { arrow.setAttribute('opacity', ease((t - .5) / .6)); folder.setAttribute('opacity', ease((t - 1.1) / .5)); rows.forEach((r, i) => r.setAttribute('opacity', ease((t - 1.6 - i * .12) / .3))); };
  }
  if (kind === 'pick-folder') {
    const entries = scene.entries;
    box.innerHTML = `<svg viewBox="0 0 1520 855">
      <text x="420" y="170" font-size="30" fill="${MUTED}">In Chrome's file picker, choose the folder itself:</text>
      <g transform="translate(420 210)">
        <rect width="680" height="${110 + entries.length * 52}" rx="20" fill="${CARD}" stroke="${LINE}"/>
        <g transform="translate(30 30)">${folderPath(0, -6, 64, 48, '#5f6f8f')}<text x="84" y="30" font-size="28" fill="${MUTED}">Downloads</text></g>
        <g id="row"><rect x="18" y="86" width="644" height="60" rx="12" fill="rgba(195,243,68,.16)" stroke="${LIME}" stroke-width="3"/>
          <g transform="translate(60 94)">${folderPath(0, -6, 60, 46, '#3d6fd8')}<text x="80" y="31" font-size="30" font-weight="700" fill="${INK}">${scene.folder}</text></g></g>
        <g font-family="Atkinson Hyperlegible Mono, monospace" font-size="24" fill="${MUTED}">${entries.map((e, i) => `<text x="150" y="${190 + i * 52}">${e === 'manifest.json' ? `<tspan fill="${LIME}" font-weight="700">${e}</tspan>  ← this folder contains it` : e}</text>`).join('')}</g>
      </g>
      <g id="ptr" transform="translate(1180 560)"><path d="M0 0 L0 44 L11 34 L19 51 L27 47 L19 31 L34 31 Z" fill="#fff" stroke="#10131b" stroke-width="3" stroke-linejoin="round"/></g>
    </svg>`;
    const ptr = box.querySelector('#ptr'), row = box.querySelector('#row');
    return (t) => { const k = ease((t - .4) / 1.2); ptr.setAttribute('transform', `translate(${1180 - 470 * k} ${560 - 234 * k})`); row.setAttribute('opacity', .35 + .65 * ease((t - 1.5) / .4)); };
  }
  if (kind === 'pin') {
    box.innerHTML = `<svg viewBox="0 0 1520 855">
      <rect x="200" y="150" width="1120" height="96" rx="48" fill="${CARD}" stroke="${LINE}"/>
      <text x="260" y="210" font-size="30" fill="${MUTED}">Practice page · Link Meteor</text>
      <g id="pinned" opacity="0" transform="translate(1102 172)"><rect width="52" height="52" rx="14" fill="#1b2336"/><circle cx="34" cy="17" r="10" fill="${LIME}"/><path d="M29 12 L39 22 L14 40 Q10 38 12 34Z" fill="${LIME}" opacity=".55"/></g>
      <g transform="translate(1178 172)"><rect width="52" height="52" rx="14" fill="rgba(255,255,255,.08)"/><path d="M17 16h7a4 4 0 1 1 8 0h5v8a4 4 0 1 1 0 8v8H29a4 4 0 1 0-8 0h-4Z" fill="none" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/><text x="26" y="84" text-anchor="middle" font-size="22" fill="${MUTED}">Extensions</text></g>
      <g id="menu" opacity="0"><rect x="820" y="290" width="440" height="200" rx="18" fill="#f4f6fa"/>
        <text x="850" y="340" font-size="24" fill="#5c6372" font-weight="700">Extensions</text>
        <g transform="translate(850 370)"><rect width="36" height="36" rx="10" fill="#1b2336"/><circle cx="24" cy="12" r="7" fill="${LIME}"/><path d="M20 8 L28 16 L10 29 Q7 27 9 24Z" fill="${LIME}" opacity=".6"/><text x="52" y="27" font-size="28" fill="#141b2b" font-weight="700">Link Meteor</text></g>
        <g id="pin" transform="translate(1196 372)"><path d="M10 2 L24 2 L22 14 L28 20 L6 20 L12 14 Z" fill="none" stroke="#141b2b" stroke-width="3" stroke-linejoin="round"/><path d="M17 20v12" stroke="#141b2b" stroke-width="3" stroke-linecap="round"/></g>
        <rect id="pinhl" x="1180" y="360" width="60" height="56" rx="12" fill="none" stroke="#3d6fd8" stroke-width="3" opacity="0"/></g>
      <g id="ptr" transform="translate(1260 420)"><path d="M0 0 L0 44 L11 34 L19 51 L27 47 L19 31 L34 31 Z" fill="#fff" stroke="#10131b" stroke-width="3" stroke-linejoin="round"/></g>
    </svg>`;
    const menu = box.querySelector('#menu'), ptr = box.querySelector('#ptr'), pin = box.querySelector('#pin path'), hl = box.querySelector('#pinhl'), pinned = box.querySelector('#pinned');
    return (t) => {
      const toPuzzle = ease(t / .8), toPin = ease((t - 1.5) / .7);
      const x = 1260 + (1204 - 1260) * toPuzzle + (1212 - 1204) * toPin, y = 420 + (196 - 420) * toPuzzle + (386 - 196) * toPin;
      ptr.setAttribute('transform', `translate(${x} ${y})`);
      menu.setAttribute('opacity', ease((t - .9) / .3) * (1 - ease((t - 3.4) / .3)));
      hl.setAttribute('opacity', ease((t - 2.2) / .2));
      pin.setAttribute('fill', t > 2.5 ? '#3d6fd8' : 'none');
      pinned.setAttribute('opacity', ease((t - 2.7) / .4));
    };
  }
  throw new Error(`Unknown illustration ${kind}`);
}
