/*
 * 다이아 숫자 분류기 학습 (의존성 없는 순수 JS).
 *
 *   node web/gempago/vision/train-digit-cnn.js <dataset.json> [--write]
 *
 * 왜 CNN 인가: 템플릿 매칭은 픽셀을 그대로 비교하므로 캡처 출처(스크린샷 vs 화면 공유)가
 * 바뀌면 무너진다. 숫자는 글자가 3~12px 라 특히 심하다. 분류기는 흐림·리샘플을 증강으로
 * 배우면 그 축이 사라진다. 크기는 파라미터 3천 개 수준이라 가중치가 JSON 몇십 KB다.
 *
 * 구조: conv3x3x8 - relu - pool2 - conv3x3x16 - relu - pool2 - fc(5)
 * 평가는 **파일 단위 k-fold** 다. 같은 캡처에서 나온 흔들림 증강본이 학습과 평가에
 * 나뉘어 들어가면 정확도가 부풀려진다(사실상 같은 그림이다).
 */
const fs = require('fs');
const path = require('path');

const DS = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!DS) { console.error('사용법: node train-digit-cnn.js <dataset.json> [--write]'); process.exit(1); }

const ds = JSON.parse(fs.readFileSync(DS, 'utf8'));
const W = ds.window.w, H = ds.window.h;
const CLASSES = [1, 2, 3, 4, 5];

/* ---- 난수: 재현 가능해야 실험을 비교할 수 있다 ---- */
let seed = 12345;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const randn = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand());

/* ---- 증강: 출처 차이를 흉내낸다 ---- */

function blur(src, w, h, k) {
  if (k <= 0) return src;
  const out = new Float32Array(src.length);
  const tmp = new Float32Array(src.length);
  const wts = [k, 1 - 2 * k, k];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -1; i <= 1; i++) s += wts[i + 1] * src[y * w + Math.max(0, Math.min(w - 1, x + i))];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -1; i <= 1; i++) s += wts[i + 1] * tmp[Math.max(0, Math.min(h - 1, y + i)) * w + x];
    out[y * w + x] = s;
  }
  return out;
}

function augment(v) {
  // 흐림(공유 프레임처럼 리샘플을 거친 경우) 또는 선명화(원본), 그리고 잡음.
  let out = v;
  const k = rand();
  if (k < 0.45) out = blur(v, W, H, 0.10 + rand() * 0.20);
  else if (k < 0.6) {                       // 언샤프: 원본이 더 또렷한 경우
    const b = blur(v, W, H, 0.25);
    out = new Float32Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] + (v[i] - b[i]) * (0.3 + rand() * 0.5);
  }
  const noisy = new Float32Array(out.length);
  const amp = rand() * 0.12;
  const gain = 0.85 + rand() * 0.3;          // 대비 변화 (z 정규화 후에도 남는 차이)
  for (let i = 0; i < out.length; i++) noisy[i] = out[i] * gain + randn() * amp;
  return noisy;
}

/* ---- 모델 ---- */

const C1 = 8, C2 = 16;
const H1 = H - 2, W1 = W - 2;              // conv1 출력
const H2 = H1 >> 1, W2 = W1 >> 1;          // pool1
const H3 = H2 - 2, W3 = W2 - 2;            // conv2
const H4 = H3 >> 1, W4 = W3 >> 1;          // pool2
const FLAT = H4 * W4 * C2;

function initModel() {
  const g = (n, fan) => Float32Array.from({ length: n }, () => randn() * Math.sqrt(2 / fan));
  return {
    w1: g(C1 * 9, 9), b1: new Float32Array(C1),
    w2: g(C2 * C1 * 9, C1 * 9), b2: new Float32Array(C2),
    w3: g(CLASSES.length * FLAT, FLAT), b3: new Float32Array(CLASSES.length),
  };
}

function forward(m, x, cache) {
  const a1 = new Float32Array(C1 * H1 * W1);
  for (let f = 0; f < C1; f++) for (let y = 0; y < H1; y++) for (let xx = 0; xx < W1; xx++) {
    let s = m.b1[f];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += m.w1[f * 9 + j * 3 + i] * x[(y + j) * W + (xx + i)];
    a1[(f * H1 + y) * W1 + xx] = s > 0 ? s : 0;
  }
  const p1 = new Float32Array(C1 * H2 * W2);
  const p1i = new Int32Array(C1 * H2 * W2);
  for (let f = 0; f < C1; f++) for (let y = 0; y < H2; y++) for (let xx = 0; xx < W2; xx++) {
    let best = -Infinity, bi = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const idx = (f * H1 + y * 2 + j) * W1 + xx * 2 + i;
      if (a1[idx] > best) { best = a1[idx]; bi = idx; }
    }
    p1[(f * H2 + y) * W2 + xx] = best; p1i[(f * H2 + y) * W2 + xx] = bi;
  }
  const a2 = new Float32Array(C2 * H3 * W3);
  for (let f = 0; f < C2; f++) for (let y = 0; y < H3; y++) for (let xx = 0; xx < W3; xx++) {
    let s = m.b2[f];
    for (let c = 0; c < C1; c++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
      s += m.w2[((f * C1 + c) * 3 + j) * 3 + i] * p1[(c * H2 + y + j) * W2 + xx + i];
    a2[(f * H3 + y) * W3 + xx] = s > 0 ? s : 0;
  }
  const p2 = new Float32Array(FLAT);
  const p2i = new Int32Array(FLAT);
  for (let f = 0; f < C2; f++) for (let y = 0; y < H4; y++) for (let xx = 0; xx < W4; xx++) {
    let best = -Infinity, bi = 0;
    for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
      const idx = (f * H3 + y * 2 + j) * W3 + xx * 2 + i;
      if (a2[idx] > best) { best = a2[idx]; bi = idx; }
    }
    p2[(f * H4 + y) * W4 + xx] = best; p2i[(f * H4 + y) * W4 + xx] = bi;
  }
  const logits = new Float32Array(CLASSES.length);
  for (let k = 0; k < CLASSES.length; k++) {
    let s = m.b3[k];
    for (let i = 0; i < FLAT; i++) s += m.w3[k * FLAT + i] * p2[i];
    logits[k] = s;
  }
  let mx = -Infinity;
  for (const v of logits) mx = Math.max(mx, v);
  let sum = 0;
  const prob = new Float32Array(CLASSES.length);
  for (let k = 0; k < CLASSES.length; k++) { prob[k] = Math.exp(logits[k] - mx); sum += prob[k]; }
  for (let k = 0; k < CLASSES.length; k++) prob[k] /= sum;
  if (cache) Object.assign(cache, { x, a1, p1, p1i, a2, p2, p2i, prob });
  return prob;
}

function backward(m, c, target, g) {
  const dlogit = new Float32Array(CLASSES.length);
  for (let k = 0; k < CLASSES.length; k++) dlogit[k] = c.prob[k] - (k === target ? 1 : 0);

  const dp2 = new Float32Array(FLAT);
  for (let k = 0; k < CLASSES.length; k++) {
    g.b3[k] += dlogit[k];
    for (let i = 0; i < FLAT; i++) { g.w3[k * FLAT + i] += dlogit[k] * c.p2[i]; dp2[i] += dlogit[k] * m.w3[k * FLAT + i]; }
  }
  const da2 = new Float32Array(C2 * H3 * W3);
  for (let i = 0; i < FLAT; i++) if (c.p2[i] > 0) da2[c.p2i[i]] += dp2[i];

  const dp1 = new Float32Array(C1 * H2 * W2);
  for (let f = 0; f < C2; f++) for (let y = 0; y < H3; y++) for (let xx = 0; xx < W3; xx++) {
    const d = da2[(f * H3 + y) * W3 + xx];
    if (!d) continue;
    g.b2[f] += d;
    for (let cc = 0; cc < C1; cc++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const wi = ((f * C1 + cc) * 3 + j) * 3 + i, pi = (cc * H2 + y + j) * W2 + xx + i;
      g.w2[wi] += d * c.p1[pi];
      dp1[pi] += d * m.w2[wi];
    }
  }
  const da1 = new Float32Array(C1 * H1 * W1);
  for (let i = 0; i < dp1.length; i++) if (c.p1[i] > 0) da1[c.p1i[i]] += dp1[i];

  for (let f = 0; f < C1; f++) for (let y = 0; y < H1; y++) for (let xx = 0; xx < W1; xx++) {
    const d = da1[(f * H1 + y) * W1 + xx];
    if (!d) continue;
    g.b1[f] += d;
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
      g.w1[f * 9 + j * 3 + i] += d * c.x[(y + j) * W + (xx + i)];
  }
}

function zeroLike(m) {
  const o = {};
  for (const k of Object.keys(m)) o[k] = new Float32Array(m[k].length);
  return o;
}

function train(samples, epochs) {
  seed = 12345;
  const m = initModel();
  const vel = zeroLike(m);
  const lr = 0.02, mom = 0.9, batch = 32;
  const idx = samples.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
    for (let b = 0; b < idx.length; b += batch) {
      const g = zeroLike(m);
      const n = Math.min(batch, idx.length - b);
      for (let t = 0; t < n; t++) {
        const s = samples[idx[b + t]];
        const cache = {};
        forward(m, augment(s.vec), cache);
        backward(m, cache, s.cls, g);
      }
      for (const k of Object.keys(m)) {
        for (let i = 0; i < m[k].length; i++) {
          vel[k][i] = mom * vel[k][i] - (lr / n) * g[k][i];
          m[k][i] += vel[k][i];
        }
      }
    }
  }
  return m;
}

/* ---- 데이터 준비 ---- */

const all = ds.samples.map((s) => ({
  file: s.file, pos: s.pos, dx: s.dx, dy: s.dy,
  cls: CLASSES.indexOf(s.label), label: s.label,
  vec: Float32Array.from(s.data),
}));
const files = [...new Set(all.map((s) => s.file))];
console.log(`표본 ${all.length}개 · 캡처 ${files.length}장 · 파라미터 ${
  C1 * 9 + C1 + C2 * C1 * 9 + C2 + CLASSES.length * FLAT + CLASSES.length}개`);

/* ---- 파일 단위 5-fold 교차검증 ---- */

const FOLDS = 5, EPOCHS = 12;
let ok = 0, total = 0;
const wrong = [];
for (let f = 0; f < FOLDS; f++) {
  const testFiles = new Set(files.filter((_, i) => i % FOLDS === f));
  const tr = all.filter((s) => !testFiles.has(s.file));
  // 평가는 흔들림 없는 원본 위치만 - 실제 실행 조건이다.
  const te = all.filter((s) => testFiles.has(s.file) && s.dx === 0 && s.dy === 0);
  const m = train(tr, EPOCHS);
  let hit = 0;
  for (const s of te) {
    const p = forward(m, s.vec);
    let bi = 0;
    for (let k = 1; k < CLASSES.length; k++) if (p[k] > p[bi]) bi = k;
    if (bi === s.cls) hit++;
    else wrong.push(`${s.file} ${s.pos} ${CLASSES[bi]}!=${s.label}(${p[bi].toFixed(2)})`);
  }
  ok += hit; total += te.length;
  console.log(`  fold ${f + 1}: ${hit}/${te.length}`);
}
console.log(`\n파일 단위 5-fold: ${ok}/${total} (${(ok / total * 100).toFixed(1)}%)`);
for (const w of wrong.slice(0, 12)) console.log('  ' + w);

/* ---- 전체로 다시 학습해서 내보내기 ---- */

if (WRITE) {
  const m = train(all, EPOCHS);
  let hit = 0;
  for (const s of all.filter((s) => s.dx === 0 && s.dy === 0)) {
    const p = forward(m, s.vec);
    let bi = 0;
    for (let k = 1; k < CLASSES.length; k++) if (p[k] > p[bi]) bi = k;
    if (bi === s.cls) hit++;
  }
  console.log(`전체 학습 후 학습셋 정확도: ${hit}/196`);
  const out = {
    window: ds.window, classes: CLASSES,
    shape: { C1, C2, W, H },
    weights: Object.fromEntries(Object.entries(m).map(([k, v]) =>
      [k, Array.from(v, (x) => Math.round(x * 1e5) / 1e5)])),
  };
  const p = path.join(__dirname, 'templates', 'digit-cnn.json');
  fs.writeFileSync(p, JSON.stringify(out));
  console.log('저장:', p, (fs.statSync(p).size / 1024).toFixed(0) + 'KB');
}
