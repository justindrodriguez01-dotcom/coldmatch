const { Jimp } = require("jimp");
const path = require("path");

// Purple #7C3AED = rgba(124, 58, 237, 255)
const PURPLE = 0x7c3aedff;
const WHITE  = 0xffffffff;
const TRANS  = 0x00000000;

// Draw a filled circle (used to stamp rounded-corner pixels)
function inRoundedRect(x, y, size, radius) {
  // Check if pixel (x, y) is inside a rounded rectangle
  const r = radius;
  const cx = x + 0.5;
  const cy = y + 0.5;
  if (cx >= r && cx <= size - r) return true; // horizontal band
  if (cy >= r && cy <= size - r) return true; // vertical band
  // Corner circles
  const corners = [
    [r, r],
    [size - r, r],
    [r, size - r],
    [size - r, size - r],
  ];
  return corners.some(([qx, qy]) => Math.hypot(cx - qx, cy - qy) <= r);
}

// Draw the ✦ shape by painting 4 diamond lobes and a centre dot
function drawSparkle(img, size) {
  const cx = size / 2;
  const cy = size / 2;
  // Outer radius of each lobe (tip distance from centre)
  const outer = size * 0.38;
  // Inner radius (waist between lobes)
  const inner = size * 0.08;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;

      // Convert to polar
      const angle = Math.atan2(dy, dx); // -π … π
      const dist  = Math.hypot(dx, dy);

      // ✦ has 4 points at 0°, 90°, 180°, 270°
      // The radial boundary of the 4-pointed star:
      // r(θ) interpolates between inner (45° between spokes) and outer (on a spoke)
      const spoke = ((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      // spoke is 0 at a tip, π/4 at a waist
      const t = Math.abs(spoke - Math.PI / 4) / (Math.PI / 4); // 0 at waist, 1 at tip
      const boundary = inner + (outer - inner) * t;

      if (dist <= boundary) {
        img.setPixelColor(WHITE, x, y);
      }
    }
  }
}

async function generate(size) {
  const radius = Math.round(size * 0.2);
  const img = new Jimp({ width: size, height: size, color: TRANS });

  // Paint rounded-rect background
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRoundedRect(x, y, size, radius)) {
        img.setPixelColor(PURPLE, x, y);
      }
    }
  }

  // Draw ✦ in white
  drawSparkle(img, size);

  const outPath = path.join(__dirname, `icon${size}.png`);
  await img.write(outPath);
  console.log(`Created ${outPath}`);
}

(async () => {
  for (const size of [16, 48, 128]) {
    await generate(size);
  }
})();
