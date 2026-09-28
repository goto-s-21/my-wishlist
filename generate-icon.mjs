import sharp from 'sharp';

// Feather design: diagonal (upper-right tip → lower-left quill)
// Like the 🪶 emoji - clearly a feather silhouette, not an oval
// White on pink (#D46485)
const makeSvg = (size) => {
  const r = Math.round(size * 0.22);
  const s = size / 192;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none">
  <rect width="${size}" height="${size}" rx="${r}" fill="#D46485"/>
  <g transform="scale(${s})">

    <!-- Feather body: diagonal, NE tip → SW quill -->
    <!-- Upper edge (NW side of feather) goes from quill up to tip -->
    <!-- Lower edge (SE side of feather) goes from tip down to quill -->
    <path d="
      M 142 40
      C 154 60, 144 84, 132 110
      C 120 136, 100 154, 78 166
      C 66 172, 52 172, 44 164
      C 46 148, 58 126, 66 102
      C 74 78, 88 56, 106 44
      C 120 34, 134 32, 142 40
      Z
    " fill="white"/>

    <!-- Quill calamus: thin pointed tail extending from quill end -->
    <path d="M 46 164 Q 34 174, 22 184" stroke="white" stroke-width="11" stroke-linecap="round" fill="none"/>

  </g>
</svg>`;
};

await sharp(Buffer.from(makeSvg(192)), { density: 144 })
  .resize(192, 192).png().toFile('public/icon-192.png');
console.log('Generated public/icon-192.png');

await sharp(Buffer.from(makeSvg(180)), { density: 144 })
  .resize(180, 180).png().toFile('public/apple-touch-icon.png');
console.log('Generated public/apple-touch-icon.png');
