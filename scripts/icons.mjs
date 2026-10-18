// Erzeugt die PWA-Icons (neutrales Branding, kein Herstellerlogo).
import sharp from 'sharp';
const svg = (pad) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#0f766e"/><g transform="translate(256 250) scale(${pad ? 0.72 : 0.9})" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"><path d="M0-150c-66 0-118 52-118 116 0 84 118 190 118 190S118 50 118-34C118-98 66-150 0-150z"/><path d="M-40-40l30 30 60-60"/></g></svg>`;
for (const [n, s, pad] of [['icon-192', 192, false], ['icon-512', 512, false], ['icon-maskable-512', 512, true], ['apple-touch-icon', 180, true]])
  await sharp(Buffer.from(svg(pad))).resize(s, s).png().toFile(`public/icons/${n}.png`);
console.log('Icons erzeugt');
