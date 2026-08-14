/*
 * 다이아 숫자 분류기 학습용 데이터셋을 만든다.
 *
 *   node web/gempago/vision/make-digit-dataset.js [출력경로.json]
 *
 * 왜 배경판을 안 쓰나: 지금 방식(배경판을 빼고 잔차에서 숫자를 찾기)은 배경판이
 * 캡처 출처에 묶여 있다. 같은 1920 화면이라도 게임 스크린샷과 브라우저 화면 공유는
 * 리샘플 경로가 달라서 판이 안 맞고(실측 잔차 0.02~0.11 vs 0.27~0.43), 출처가 하나
 * 늘 때마다 표본을 다시 모아야 한다. 분류기는 배경을 "무시하도록 배우면" 되므로
 * 그 축이 통째로 사라진다.
 *
 * 그래서 입력은 잔차가 아니라 **원본 픽셀의 고정 창**이다. 창 위치는 앵커에서의
 * 상대 좌표로 정하고, 1~2px 흔들림은 증강으로 흡수시킨다.
 *
 * 원본에서 자르는 것도 같은 이유다 - 화면을 기준 배율로 늘리면 3~12px 짜리 숫자에
 * 보간 뭉갬이 얹혀서 출처 차이가 증폭된다.
 */
const path = require('path');
const fs = require('fs');
const png = require('./png.js');
const layout = require('./layout.js');
const atlasMod = require('./atlas.js');

const here = (...p) => path.join(__dirname, ...p);
const OUT = process.argv[2] || here('fixtures', 'digit-dataset.json');

const atlas = atlasMod.load();
const gt = JSON.parse(fs.readFileSync(here('fixtures', 'captures.json'), 'utf8'));

/*
 * 창 크기와 위치. 값 띠 안에서 숫자가 놓이는 자리는 자리마다 고정이다 - 위/아래는
 * 가운데, 좌/우는 "Lv. N" 이라 오른쪽이다. 2048 기준 좌표이고 실행 시 배율을 곱한다.
 * 넉넉하게 잡아서 흔들림을 증강으로 흡수한다.
 */
const WINDOW = { w: 26, h: 22 };
const CENTER = { top: 80, left: 100, right: 100, bottom: 80 };
const POSITIONS = ['top', 'left', 'right', 'bottom'];

/** 원본 좌표에서 숫자 창을 잘라 고정 크기로 리샘플한다. */
function cropDigit(img, band, pos, scale, dx, dy) {
  const cx = band.x + Math.round(CENTER[pos] * scale) + dx;
  const cy = band.y + Math.round(band.h / 2) + dy;
  const w = Math.round(WINDOW.w * scale);
  const h = Math.round(WINDOW.h * scale);
  const x0 = cx - Math.round(w / 2);
  const y0 = cy - Math.round(h / 2);
  if (x0 < 0 || y0 < 0 || x0 + w > img.width || y0 + h > img.height) return null;

  // 배율이 달라도 같은 크기로 맞춘다. 분류기는 고정 입력을 받아야 한다.
  const out = new Float32Array(WINDOW.w * WINDOW.h);
  for (let y = 0; y < WINDOW.h; y++) {
    const sy = y0 + (y + 0.5) * (h / WINDOW.h) - 0.5;
    const yA = Math.max(y0, Math.min(y0 + h - 1, Math.floor(sy)));
    const yB = Math.min(y0 + h - 1, yA + 1);
    const wy = sy - yA;
    for (let x = 0; x < WINDOW.w; x++) {
      const sx = x0 + (x + 0.5) * (w / WINDOW.w) - 0.5;
      const xA = Math.max(x0, Math.min(x0 + w - 1, Math.floor(sx)));
      const xB = Math.min(x0 + w - 1, xA + 1);
      const wx = sx - xA;
      const a = img.data[yA * img.width + xA], b = img.data[yA * img.width + xB];
      const c = img.data[yB * img.width + xA], d = img.data[yB * img.width + xB];
      out[y * WINDOW.w + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
    }
  }
  return out;
}

/** z 정규화. 밝기/대비를 없애야 게임 밝기 설정과 무관해진다 (NCC 와 같은 이유). */
function znorm(v) {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i];
  const mean = sum / v.length;
  let ss = 0;
  for (let i = 0; i < v.length; i++) { const d = v[i] - mean; ss += d * d; }
  const sd = Math.sqrt(ss / v.length) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = (v[i] - mean) / sd;
  return out;
}

const samples = [];
let skipped = 0;
for (const cap of gt.captures) {
  if (!cap.gemState) continue;
  const img = png.loadGray(here('fixtures', cap.file));
  const origin = layout.locate(img, atlas.anchor, { scale: cap.scale });
  if (!origin) { console.error('앵커 실패: ' + cap.file); continue; }
  const dia = layout.diamonds(origin, true); // 원본 좌표

  for (const pos of POSITIONS) {
    const label = cap.gemState[pos].value;
    // 흔들림 증강: 창을 1~2px 씩 옮겨서 같은 숫자를 여러 장 만든다.
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const raw = cropDigit(origin.raw, dia[pos].value, pos, cap.scale, dx, dy);
        if (!raw) { skipped++; continue; }
        samples.push({
          file: cap.file, pos, label, dx, dy, scale: cap.scale,
          gem: (cap.gem || '').split(' ')[0],
          data: Array.from(znorm(raw), (v) => Math.round(v * 1000) / 1000),
        });
      }
    }
  }
}

const byLabel = {};
for (const s of samples) byLabel[s.label] = (byLabel[s.label] || 0) + 1;
console.log(`표본 ${samples.length}개 (창 ${WINDOW.w}x${WINDOW.h}, 잘림 실패 ${skipped})`);
console.log('숫자별:', JSON.stringify(byLabel));
console.log('자리별:', JSON.stringify(POSITIONS.reduce((a, p) =>
  (a[p] = samples.filter((s) => s.pos === p).length, a), {})));

fs.writeFileSync(OUT, JSON.stringify({ window: WINDOW, positions: POSITIONS, samples }));
console.log('저장:', OUT, (fs.statSync(OUT).size / 1e6).toFixed(1) + 'MB');
