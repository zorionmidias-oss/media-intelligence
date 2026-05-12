'use strict';
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '../public');

async function makeIcon(size) {
  const radius = Math.floor(size * 0.22);
  const inner = size - 4;
  // Dark rounded-square background with "2J" text as SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect x="2" y="2" width="${inner}" height="${inner}" rx="${radius}" fill="#111827"/>
    <rect x="2" y="2" width="${inner}" height="${inner}" rx="${radius}" fill="url(#g)"/>
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#00e5b4"/>
        <stop offset="100%" stop-color="#7c6aff"/>
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="${inner}" height="${inner}" rx="${radius}" fill="#111827" opacity="0.85"/>
    <text x="${size/2}" y="${size*0.62}" font-family="system-ui,sans-serif" font-weight="800"
      font-size="${size*0.38}" fill="white" text-anchor="middle">2J</text>
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, `icon-${size}.png`));
  console.log(`Generated icon-${size}.png`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await makeIcon(192);
  await makeIcon(512);
  console.log('Icons generated successfully.');
})();
