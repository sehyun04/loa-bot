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
  // 젬 포인트 정답은 따로 안 적는다 - 네 수치의 합이 곧 정답이다 (실측: 39장 전부 성립).
  const gemSum = cap.gemState
    ? ['top', 'left', 'right', 'bottom'].reduce((a, p) => a + cap.gemState[p].value, 0)
    : null;
  caps.push({ file: cap.file, scale: cap.scale, ui: cap.ui, gemSum, origin, bands: layout.metaBands(origin) });
}
console.log(`캡처 ${caps.length}장 정렬 완료 (가공 횟수 표본 ${caps.filter((c) => c.ui.attempts).length}장)`);

/* ---- 템플릿 뜨기: 첫 글자 덩어리에 고정폭 창 ----
 * 가공 횟수 창은 "(" 와 숫자를 같이 담을 만큼 넓어야 한다. "6" 처럼 슬래시와 붙어
 * 한 덩어리가 되는 숫자가 있어서, 숫자만 노린 좁은 창은 잘린 위치가 숫자마다 달라진다. */

const WINDOWS = { reroll: 12, attempt: 16, point: 12 };

function crop(img, x, y, w, h) {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) data[j * w + i] = Math.round(img.data[(y + j) * img.width + (x + i)]);
  }
  return { width: w, height: h, data };
}

/** band 세로 범위 안에서 [x0, x0+w) 창을 글자 높이에 맞게 잘라낸다. */
function cutAt(image, band, x0, w) {
  w = Math.min(w, image.width - x0);

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

function cutDigit(image, band, window) {
  const spans = layout.glyphSpans(image, band, 2);
  if (!spans.length) return null;
  // 띠 시작보다 왼쪽으로 나가면 안 된다 - 실행 시 슬라이드가 띠 안에서만 움직여서
  // 템플릿이 제 위치에 못 맞는다.
  return cutAt(image, band, Math.max(band.x, spans[0][0] - 2), window);
}

const pool = {}; // 'reroll:1' / 'attempt:7' / 'point:4' -> [{img, src, scale}]
const labelPool = []; // "젬 포인트" 이름 변형
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

  // "젬 포인트 N": 이름은 앞 덩어리들(폭이 일정해서 시작 +64 안에 끝나는 것들),
  // 숫자는 이름 오른쪽 창의 덩어리들. 자릿수는 정답에서 안다.
  const band = c.bands.gemPoint;
  if (!band || c.gemSum == null) continue;
  const spans = layout.glyphSpans(c.origin.image, band, 2).filter(([a, b]) => b - a >= 2);
  if (spans.length < 3) { console.error(`젬 포인트 줄이 안 보인다: ${c.file}`); continue; }
  const x0 = spans[0][0];
  const labelChunks = spans.filter(([, b]) => b <= x0 + 64);
  const labelEnd = labelChunks[labelChunks.length - 1][1];
  const labelStart = Math.max(band.x, x0 - 2);
  const labelImg = cutAt(c.origin.image, band, labelStart, labelEnd + 2 - labelStart);
  if (labelImg) labelPool.push({ img: labelImg, text: '젬 포인트', src: c.file, scale: c.scale });

  // 숫자 창은 이름 "시작 + 고정 간격" 이다. 이름 끝을 쓰면 템플릿 폭 편차만큼 밀린다.
  const region = { x: labelStart + 66, w: 24 };
  const dChunks = spans.filter(([a]) => a >= region.x && a < region.x + region.w);
  const digitsStr = String(c.gemSum);
  if (dChunks.length !== digitsStr.length) {
    console.error(`젬 포인트 덩어리 수가 자릿수와 다르다: ${c.file} (${dChunks.length} != ${digitsStr.length})`);
    continue;
  }
  dChunks.forEach(([a], i) => {
    const img = cutAt(c.origin.image, band, Math.max(region.x, a - 2), WINDOWS.point);
    if (!img) return;
    const key = `point:${digitsStr[i]}`;
    (pool[key] || (pool[key] = [])).push({ img, text: digitsStr[i], src: c.file, scale: c.scale });
  });
}
console.log('표본:', Object.keys(pool).sort().map((k) => `${k}(${pool[k].length})`).join(' '),
  `젬포인트이름(${labelPool.length})`);

/* ---- 선택: 배율당 최대 3개, 출처 파일 중복 없이 ---- */

function select(list) {
  const byScale = {};
  for (const v of list) (byScale[v.scale] || (byScale[v.scale] = [])).push(v);
  const out = [];
  for (const s of Object.keys(byScale)) {
    const seen = new Set();
    for (const v of byScale[s]) {
      if (out.filter((x) => x.scale === v.scale).length >= 3) break;
      if (seen.has(v.src)) continue;
      seen.add(v.src);
      out.push(v);
    }
  }
  return out;
}

const sel = {};
for (const key of Object.keys(pool)) sel[key] = select(pool[key]);
const labelSel = select(labelPool);

/* ---- leave-one-out 측정 ---- */

function atlasFor(excludeFile) {
  const mem = { 'meta-digit': {}, 'meta-label': {} };
  for (const key of Object.keys(sel)) {
    const vs = sel[key].filter((v) => v.src !== excludeFile);
    if (vs.length) mem['meta-digit'][key] = vs.map((v) => v.img);
  }
  const ls = labelSel.filter((v) => v.src !== excludeFile);
  if (ls.length) mem['meta-label']['gem-point'] = ls.map((v) => v.img);
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
    ['젬포인트', r.gemPoint, c.bands.gemPoint ? c.gemSum : null],
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
  labelSel.forEach((v, i) => {
    const file = `meta-label-gem-point-${i + 1}.png`;
    fs.writeFileSync(path.join(dir, file), png.encodeGray(v.img));
    items.push({ file, group: 'meta-label', key: 'gem-point', text: v.text, src: v.src });
  });
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const kept = manifest.items.filter((i) => i.group !== 'meta-digit' && i.group !== 'meta-label');
  const removed = manifest.items.length - kept.length;
  manifest.items = kept.concat(items);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n템플릿 ${items.length}개 기록 (기존 meta-* ${removed}개 교체), manifest 갱신`);
}
