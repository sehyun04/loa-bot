/*
 * 의존성 없는 최소 PNG 디코더/인코더. 8bit RGB/RGBA, non-interlaced 만 다룬다.
 *
 * Node 전용이다(zlib). 브라우저 런타임에서는 canvas 가 디코딩을 대신하므로 필요 없고,
 * 여기서는 템플릿을 잘라 만들고 회귀 테스트를 돌리는 오프라인 파이프라인에서만 쓴다.
 * 이 한 파일 때문에 sharp/pngjs 같은 네이티브 의존성을 끌어오면 설치가 깨질 때
 * 테스트 전체가 못 돌게 되므로 직접 구현했다.
 */
const zlib = require('zlib');

function decode(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');

  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') break;

    pos += 12 + len; // len(4) + type(4) + data + crc(4)
  }

  if (bitDepth !== 8) throw new Error('only 8-bit supported, got ' + bitDepth);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported colorType ' + colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  // 각 스캔라인 앞 1바이트가 필터 타입. 필터는 직전 픽셀/윗줄을 참조하므로
  // 복원된 out 을 기준으로 순차적으로 풀어야 한다.
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.slice(rp, rp + stride);
    rp += stride;

    const cur = out.slice(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.slice((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const A = x >= channels ? cur[x - channels] : 0;             // 왼쪽
      const B = prev ? prev[x] : 0;                                 // 위
      const C = (prev && x >= channels) ? prev[x - channels] : 0;   // 왼쪽 위
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v += A; break;
        case 2: v += B; break;
        case 3: v += (A + B) >> 1; break;
        case 4: {
          const p = A + B - C;
          const pa = Math.abs(p - A), pb = Math.abs(p - B), pc = Math.abs(p - C);
          v += (pa <= pb && pa <= pc) ? A : (pb <= pc ? B : C);
          break;
        }
        default: throw new Error('bad filter ' + filter);
      }
      cur[x] = v & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/** RGB(A) -> 그레이스케일 Float32Array (0..255). ncc.js 가 먹는 형식. */
function toGray(img) {
  const { width, height, channels, data } = img;
  const g = new Float32Array(width * height);
  for (let i = 0, p = 0; i < g.length; i++, p += channels) {
    g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { width, height, data: g };
}

/** 그레이 이미지에서 사각형 잘라내기. 템플릿을 만들 때 쓴다. */
function cropGray(img, x, y, w, h) {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      out[j * w + i] = img.data[(y + j) * img.width + (x + i)];
    }
  }
  return { width: w, height: h, data: out };
}

/** 그레이 이미지를 PNG 로. 잘라낸 템플릿을 눈으로 확인할 때만 쓴다. */
function encodeGray(img) {
  const { width, height, data } = img;
  const stride = width * 3;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const v = Math.max(0, Math.min(255, Math.round(data[y * width + x])));
      const o = y * (stride + 1) + 1 + x * 3;
      raw[o] = raw[o + 1] = raw[o + 2] = v;
    }
  }

  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8bit RGB
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw)));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/** 파일 경로에서 바로 그레이 이미지로. */
function loadGray(path) {
  return toGray(decode(require('fs').readFileSync(path)));
}

module.exports = { decode, toGray, cropGray, encodeGray, loadGray };
