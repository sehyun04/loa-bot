/*
 * 리롤/가공 횟수 숫자 템플릿 생성 + 정확도 측정.
 *
 *   node web/gempago/vision/make-meta-templates.js          측정만 (leave-one-out)
 *   node web/gempago/vision/make-meta-templates.js --write  templates/ 와 manifest.json 갱신
 *
 * 다이아(make-diamond-templates.js)와 달리 배경이 민무늬 버튼이라 배경판이 필요 없다.
 * 정답표는 captures.json 의 ui 필드 - 리롤은 39장 전부, 가공 횟수는 버튼이 화면에
 * 들어 있는 캡처(cap27+)만 있다.
 */
const path = require('path');
const fs = require('fs');
const png = require('./png.js');
const layout = require('./layout.js');
const reader = require('./reader.js');
const atlasMod = require('./atlas.js');

const here = (...p) => path.join(__dirname, ...p);
const WRITE = process.argv.includes('--write');

const atlas = atlasMod.load();
const gt = JSON.parse(fs.readFileSync(here('fixtures', 'captures.json'), 'utf8'));

const caps = [];
for (const cap of gt.captures) {
  if (!cap.ui) continue;
  const img = png.loadGray(here('fixtures', cap.file));
  const origin = layout.locate(img, atlas.anchor, { scale: cap.scale });
  if (!origin) { console.error('앵커 실패: ' + cap.file); process.exit(1); }
  caps.push({ file: cap.file, scale: cap.scale, ui: cap.ui, origin, bands: layout.metaBands(origin) });
}
console.log(`캡처 ${caps.length}장 정렬 완료 (가공 횟수 표본 ${caps.filter((c) => c.ui.attempts).length}장)`);

/* ---- 템플릿 뜨기: 첫 글자 덩어리에 고정폭 창 ----
 * 가공 횟수 창은 "(" 와 숫자를 같이 담을 만큼 넓어야 한다. "6" 처럼 슬래시와 붙어
 * 한 덩어리가 되는 숫자가 있어서, 숫자만 노린 좁은 창은 잘린 위치가 숫자마다 달라진다. */

const WINDOWS = { reroll: 12, attempt: 16 };

function crop(img, x, y, w, h) {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) data[j * w + i] = Math.round(img.data[(y + j) * img.width + (x + i)]);
  }
  return { width: w, height: h, data };
}

function cutDigit(image, band, window) {
  const spans = layout.glyphSpans(image, band, 2);
  if (!spans.length) return null;
  // 띠 시작보다 왼쪽으로 나가면 안 된다 - 실행 시 슬라이드가 띠 안에서만 움직여서
  // 템플릿이 제 위치에 못 맞는다.
  const x0 = Math.max(band.x, spans[0][0] - 2);
  const w = Math.min(window, image.width - x0);

  // 세로는 글자에 딱 맞게 자른다. 띠 높이 그대로 자르면 세로로 미끄러질 틈이 없어서
  // 버튼 위치가 캡처마다 1px 만 어긋나도 점수가 무너진다 (옵션 행 3번 항목과 같은 이유).
  const vals = [];
  for (let y = band.y; y < band.y + band.h; y++) {
    for (let x = x0; x < x0 + w; x++) vals.push(image.data[y * image.width + x]);
  }
  vals.sort((a, b) => a - b);
  const thr = vals[Math.floor(vals.length * 0.5)]
    + (vals[Math.floor(vals.length * 0.98)] - vals[Math.floor(vals.length * 0.5)]) * 0.55;
  let y0 = band.y, y1 = band.y + band.h;
  const rowOn = (y) => {
    for (let x = x0; x < x0 + w; x++) if (image.data[y * image.width + x] > thr) return true;
    return false;
  };
  while (y0 < y1 && !rowOn(y0)) y0++;
  while (y1 > y0 && !rowOn(y1 - 1)) y1--;
  if (y0 >= y1) return null;
  y0 = Math.max(band.y, y0 - 2);
  y1 = Math.min(band.y + band.h, y1 + 2);
  return crop(image, x0, y0, w, y1 - y0);
}

const pool = {}; // 'reroll:1' / 'attempt:7' -> [{img, src, scale}]
for (const c of caps) {
  const put = (band, cls, truth) => {
    if (!band || truth == null) return;
    const img = cutDigit(c.origin.image, band, WINDOWS[cls]);
    if (!img) { console.error(`글자가 없다: ${c.file} ${cls}`); return; }
    const key = `${cls}:${truth}`;
    (pool[key] || (pool[key] = [])).push({ img, text: String(truth), src: c.file, scale: c.scale });
  };
  put(c.bands.reroll, 'reroll', c.ui.reroll);
  put(c.bands.attemptsN, 'attempt', c.ui.attempts && c.ui.attempts[0]);
  put(c.bands.attemptsM, 'attempt', c.ui.attempts && c.ui.attempts[1]);
}
console.log('표본:', Object.keys(pool).sort().map((k) => `${k}(${pool[k].length})`).join(' '));

/* ---- 선택: 배율당 최대 3개, 출처 파일 중복 없이 ---- */

const sel = {};
for (const key of Object.keys(pool)) {
  const byScale = {};
  for (const v of pool[key]) (byScale[v.scale] || (byScale[v.scale] = [])).push(v);
  sel[key] = [];
  for (const s of Object.keys(byScale)) {
    const seen = new Set();
    for (const v of byScale[s]) {
      if (sel[key].filter((x) => x.scale === v.scale).length >= 3) break;
      if (seen.has(v.src)) continue;
      seen.add(v.src);
      sel[key].push(v);
    }
  }
}

/* ---- leave-one-out 측정 ---- */

function atlasFor(excludeFile) {
  const mem = { 'meta-digit': {} };
  for (const key of Object.keys(sel)) {
    const vs = sel[key].filter((v) => v.src !== excludeFile);
    if (vs.length) mem['meta-digit'][key] = vs.map((v) => v.img);
  }
  return mem;
}

let ok = 0, total = 0, flagged = 0, silentWrong = 0;
const wrongs = [];
for (const c of caps) {
  const mem = atlasFor(c.file);
  const r = reader.readMeta(null, mem, { origin: c.origin });
  const want = [
    ['reroll', r.reroll, c.ui.reroll],
    ['가공N', r.attemptsLeft, c.ui.attempts && c.ui.attempts[0]],
    ['가공M', r.attemptsMax, c.ui.attempts && c.ui.attempts[1]],
  ];
  for (const [name, got, truth] of want) {
    if (truth == null) continue;
    total++;
    if (got && got.value === truth) ok++;
    else {
      wrongs.push(`${c.file} ${name} ${got && got.value} != ${truth}`
        + (got ? ` (${got.score.toFixed(3)} 마진 ${got.margin.toFixed(3)})` : ''));
      if (got && got.confident) silentWrong++;
    }
    if (!got || !got.confident) flagged++;
  }
}
console.log(`\nleave-one-out: ${ok}/${total} · 의심 ${flagged} · 자신 있게 틀림 ${silentWrong}`);
for (const w of wrongs) console.log('  ' + w);

/* ---- 쓰기 ---- */

if (WRITE) {
  const dir = here('templates');
  const items = [];
  for (const key of Object.keys(sel)) {
    sel[key].forEach((v, i) => {
      const file = `meta-${key.replace(':', '-')}-${i + 1}.png`;
      fs.writeFileSync(path.join(dir, file), png.encodeGray(v.img));
      items.push({ file, group: 'meta-digit', key, text: v.text, src: v.src });
    });
  }
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const kept = manifest.items.filter((i) => i.group !== 'meta-digit');
  const removed = manifest.items.length - kept.length;
  manifest.items = kept.concat(items);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n템플릿 ${items.length}개 기록 (기존 meta-digit ${removed}개 교체), manifest 갱신`);
}
