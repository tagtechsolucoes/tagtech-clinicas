// Gera as ilustrações do restaurante de demonstração (packages/db/seed-media/*.webp).
// São desenhos próprios, só para o demo ter imagem; restaurante de verdade envia fotos.
// Rodar de novo só se quiser mudar os desenhos:  node apps/api/scripts/render-seed-media.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/db/seed-media');
const S = 1080;
const svg = (bg, body, w = S, h = S) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;

const shadow = (cx, cy, rx) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${rx * 0.11}" fill="#000" opacity=".16"/>`;
const seeds = [
  [410, 330],
  [520, 290],
  [640, 320],
  [470, 400],
  [590, 390],
  [700, 400],
  [360, 410],
]
  .map(
    ([x, y]) =>
      `<ellipse cx="${x}" cy="${y}" rx="15" ry="8" fill="#fbe7b5" transform="rotate(-18 ${x} ${y})"/>`,
  )
  .join('');

function burger({ bg, patty = '#5b2c18', layers = 1, extra = '' }) {
  let y = 520;
  let stack = '';
  for (let i = 0; i < layers; i++) {
    stack += `<rect x="238" y="${y}" width="604" height="84" rx="42" fill="${patty}"/>`;
    stack += `<path d="M226 ${y - 6} h628 l-70 62 l-80 -40 l-90 52 l-96 -52 l-88 44 l-98 -44 z" fill="#f6b21b"/>`;
    y += 96;
  }
  const lettuce = `<path d="M214 ${y - 2} q40 -44 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 v30 h-640 z" fill="#63a341"/>`;
  return svg(
    bg,
    `${shadow(540, y + 150, 330)}
     <path d="M230 500 a310 250 0 0 1 620 0 z" fill="#d98a3a"/>
     <path d="M270 470 a270 200 0 0 1 250 -205" fill="none" stroke="#f0b068" stroke-width="18" stroke-linecap="round" opacity=".7"/>
     ${seeds}${extra}${stack}${lettuce}
     <path d="M236 ${y + 34} h608 v40 a70 70 0 0 1 -70 70 h-468 a70 70 0 0 1 -70 -70 z" fill="#c9792f"/>`,
  );
}

const bacon = `<path d="M210 506 q55 -34 110 0 t110 0 t110 0 t110 0 t110 0 t110 0 v26 q-55 34 -110 0 t-110 0 t-110 0 t-110 0 t-110 0 t-110 0 z" fill="#b5362a"/><path d="M210 512 q55 -34 110 0 t110 0 t110 0 t110 0 t110 0 t110 0" fill="none" stroke="#f3c9b3" stroke-width="7"/>`;
const onion = `<path d="M250 506 h580" stroke="#e9d3e8" stroke-width="22" stroke-linecap="round"/><path d="M300 506 h110 M470 506 h130 M660 506 h120" stroke="#b77bb4" stroke-width="8" stroke-linecap="round"/>`;

const fries = svg(
  '#f3d9a4',
  `${shadow(540, 900, 290)}` +
    [
      [330, 250, -14],
      [400, 190, -7],
      [470, 230, -3],
      [540, 170, 2],
      [610, 220, 6],
      [680, 200, 11],
      [745, 270, 16],
    ]
      .map(
        ([x, y, r]) =>
          `<rect x="${x - 26}" y="${y}" width="52" height="420" rx="12" fill="#f4bf2c" transform="rotate(${r} ${x} 640)"/><rect x="${x - 26}" y="${y}" width="14" height="420" rx="7" fill="#f9d867" transform="rotate(${r} ${x} 640)"/>`,
      )
      .join('') +
    `<path d="M290 520 h500 l-50 370 h-400 z" fill="#c22f25"/><path d="M290 520 h500 l-12 90 h-476 z" fill="#a8241c"/><circle cx="540" cy="740" r="62" fill="#f3d9a4"/>`,
);

const rings = svg(
  '#e9e0c9',
  `${shadow(540, 880, 330)}<ellipse cx="540" cy="760" rx="350" ry="110" fill="#fff"/><ellipse cx="540" cy="750" rx="290" ry="80" fill="#f1ede2"/>` +
    [
      [400, 640, 120],
      [660, 650, 130],
      [530, 520, 140],
      [540, 700, 110],
    ]
      .map(
        ([x, y, r]) =>
          `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * 0.55}" fill="none" stroke="#d99a2b" stroke-width="54"/><ellipse cx="${x}" cy="${y - 8}" rx="${r}" ry="${r * 0.55}" fill="none" stroke="#f0bf55" stroke-width="16" stroke-dasharray="40 26"/>`,
      )
      .join(''),
);

const can = svg(
  '#bfe0e6',
  `${shadow(540, 930, 220)}<rect x="360" y="200" width="360" height="720" rx="56" fill="#d43a2f"/><rect x="360" y="200" width="110" height="720" rx="56" fill="#e8574c"/><rect x="380" y="170" width="320" height="60" rx="24" fill="#c9ced2"/><rect x="380" y="890" width="320" height="50" rx="22" fill="#c9ced2"/><path d="M360 470 q180 -90 360 0 v170 q-180 90 -360 0 z" fill="#fff"/><circle cx="540" cy="555" r="54" fill="#d43a2f"/>` +
    [
      [450, 330],
      [640, 380],
      [470, 760],
      [630, 800],
      [560, 300],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="#fff" opacity=".55"/>`)
      .join(''),
);

const juice = svg(
  '#f6e7b0',
  `${shadow(540, 930, 230)}<path d="M350 250 h380 l-46 660 a36 36 0 0 1 -36 34 h-216 a36 36 0 0 1 -36 -34 z" fill="#fff" opacity=".75"/><path d="M366 400 h348 l-36 506 a26 26 0 0 1 -26 24 h-224 a26 26 0 0 1 -26 -24 z" fill="#f39a1d"/><path d="M366 400 h348 l-4 50 h-340 z" fill="#f7b84a"/><rect x="590" y="110" width="26" height="560" rx="13" fill="#2f8f5b" transform="rotate(12 603 390)"/><circle cx="690" cy="262" r="92" fill="#f7c948"/><circle cx="690" cy="262" r="66" fill="#f9dd83"/><path d="M690 196 v132 M624 262 h132" stroke="#f7c948" stroke-width="8"/>`,
);

const water = svg(
  '#cfe6f2',
  `${shadow(540, 940, 190)}<rect x="478" y="120" width="124" height="80" rx="16" fill="#2b6ea3"/><path d="M470 200 h140 q16 110 66 160 v520 a50 50 0 0 1 -50 50 h-172 a50 50 0 0 1 -50 -50 v-520 q50 -50 66 -160 z" fill="#e9f6fc" opacity=".9"/><path d="M404 470 h272 v410 a50 50 0 0 1 -50 50 h-172 a50 50 0 0 1 -50 -50 z" fill="#8ccbea"/><rect x="404" y="540" width="272" height="170" fill="#fff"/><rect x="404" y="590" width="272" height="70" fill="#2b6ea3"/><rect x="430" y="380" width="26" height="480" rx="13" fill="#fff" opacity=".6"/>`,
);

const cartola = svg(
  '#e6d2c0',
  `${shadow(540, 880, 360)}<ellipse cx="540" cy="760" rx="390" ry="130" fill="#fff"/><ellipse cx="540" cy="748" rx="320" ry="96" fill="#f4efe6"/><rect x="300" y="610" width="480" height="130" rx="46" fill="#f2c94c"/><rect x="300" y="560" width="480" height="110" rx="46" fill="#fbf0c9"/><rect x="300" y="548" width="480" height="60" rx="30" fill="#fdf7df"/>` +
    Array.from({ length: 46 }, (_, i) => {
      const x = 320 + ((i * 97) % 440),
        y = 556 + ((i * 53) % 44);
      return `<circle cx="${x}" cy="${y}" r="${5 + (i % 3) * 2}" fill="#8a4b22"/>`;
    }).join(''),
);

const flame = (x, y, k, fill) =>
  `<path transform="translate(${x} ${y}) scale(${k})" d="M0 -100 C40 -50 70 -20 60 30 C55 75 25 100 0 100 C-30 100 -60 75 -60 35 C-60 5 -40 -10 -30 -40 C-15 -25 -5 -20 0 -100 Z" fill="${fill}"/>`;

const logo = svg(
  '#7a1f1f',
  `<circle cx="256" cy="256" r="200" fill="#f5c542"/>${flame(256, 262, 1.5, '#7a1f1f')}${flame(256, 300, 0.75, '#f5c542')}`,
  512,
  512,
);

const cover = svg(
  '#3a0f0f',
  Array.from({ length: 40 }, (_, i) => {
    const x = (i * 211) % 1600,
      y = 120 + ((i * 137) % 760),
      k = 0.5 + ((i * 7) % 10) / 9;
    return flame(x, y, k, ['#b5362a', '#e2602a', '#f5a524', '#f5c542'][i % 4]);
  }).join('') + `<rect width="1600" height="900" fill="#3a0f0f" opacity=".25"/>`,
  1600,
  900,
);

const files = {
  'classico.webp': burger({ bg: '#f3c8a0' }),
  'bacon-duplo.webp': burger({ bg: '#f0b59a', layers: 2, extra: bacon }),
  'costela.webp': burger({ bg: '#e8c39a', patty: '#3f1d10', extra: onion }),
  'da-horta.webp': burger({ bg: '#cfe3b4', patty: '#8a9a3c' }),
  'batata.webp': fries,
  'aneis.webp': rings,
  'refrigerante.webp': can,
  'suco.webp': juice,
  'agua.webp': water,
  'cartola.webp': cartola,
  'logo.webp': logo,
  'capa.webp': cover,
};

await mkdir(out, { recursive: true });
for (const [name, source] of Object.entries(files)) {
  await writeFile(
    join(out, name),
    await sharp(Buffer.from(source)).webp({ quality: 80 }).toBuffer(),
  );
}
console.log(`${Object.keys(files).length} imagens em ${out}`);
