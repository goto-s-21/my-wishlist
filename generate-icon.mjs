import sharp from 'sharp';

// Cute white heart on pink — simple, clean, perfect for a wishlist app
const makeSvg = (size) => {
  const r = Math.round(size * 0.22);
  const s = size / 192;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none">
  <!-- transparent background — iOS supplies its own white -->
  <g transform="scale(${s})">
    <path d="
      M 96 170
      C 58 142, 18 104, 18 66
      C 18 38, 40 20, 64 20
      C 78 20, 90 28, 96 40
      C 102 28, 114 20, 128 20
      C 152 20, 174 38, 174 66
      C 174 104, 134 142, 96 170
      Z
    " fill="#D46485"/>
  </g>
</svg>`;
};

await sharp(Buffer.from(makeSvg(512)), { density: 300 })
  .resize(512, 512).png().toFile('public/icon-512.png');
console.log('Generated public/icon-512.png');

await sharp(Buffer.from(makeSvg(192)), { density: 144 })
  .resize(192, 192).png().toFile('public/icon-192.png');
console.log('Generated public/icon-192.png');

await sharp(Buffer.from(makeSvg(180)), { density: 144 })
  .resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('Generated public/apple-touch-icon.png');
