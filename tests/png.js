// What the visual baselines need from a PNG: the pixels, and a coarse signature of them.
//
// Chromium screenshots are 8 bit RGBA, not interlaced, so a full decoder is not necessary. Filters are all five
// standard ones, and the signature averages small blocks of colour, which is what makes the comparison survive the
// small antialiasing differences between machines without hiding a real layout or colour change.
const zlib = require('zlib');


function decodePng(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8, width = 0, height = 0, depth = 0, color = 0;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      color = body[9];
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`PNG bit depth ${depth} is not supported`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`PNG colour type ${color} is not supported`);
  if (!width || !height) throw new Error('PNG has no size');

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let at = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[at];
    const line = raw.subarray(at + 1, at + 1 + stride);
    at += 1 + stride;
    const row = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`PNG filter ${filter} is not supported`);
      row[x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

// Average colour of each block. 16 by 12 blocks over an 1100 by 800 viewport is about 69 by 67 pixels a block:
// big enough that how a machine rasterises a glyph does not move the average, small enough that a moved heading,
// a wrong colour or a missing output still does.
function signature(img, cols = 16, rows = 12) {
  const blocks = [];
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor(r * img.height / rows), y1 = Math.max(y0 + 1, Math.floor((r + 1) * img.height / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * img.width / cols), x1 = Math.max(x0 + 1, Math.floor((c + 1) * img.width / cols));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * img.width + x) * img.channels;
          sr += img.data[i];
          sg += img.data[i + 1] ?? img.data[i];
          sb += img.data[i + 2] ?? img.data[i];
          n += 1;
        }
      }
      blocks.push([sr / n, sg / n, sb / n]);
    }
  }
  return blocks;
}

const compare = (a, b) => {
  if (a.length !== b.length) return { mean: Infinity, worst: Infinity, at: -1 };
  let total = 0, worst = 0, at = -1;
  for (let i = 0; i < a.length; i++) {
    const d = (Math.abs(a[i][0] - b[i][0]) + Math.abs(a[i][1] - b[i][1]) + Math.abs(a[i][2] - b[i][2])) / 3;
    total += d;
    if (d > worst) { worst = d; at = i; }
  }
  return { mean: total / a.length, worst, at };
};

module.exports = { decodePng, signature, compare };
