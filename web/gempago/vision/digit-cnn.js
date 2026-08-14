/*
 * 다이아 숫자 분류기 (순전파만). 학습은 train-digit-cnn.js 가 한다.
 *
 * 왜 여기만 템플릿 매칭이 아닌가:
 * 숫자는 글자가 3~12px 라 캡처 출처(게임 스크린샷 vs 브라우저 화면 공유)가 바뀌면
 * 픽셀이 달라져서 템플릿이 무너진다. 실측으로 같은 1920 화면인데도 배경판 잔차가
 * 0.02~0.11 vs 0.27~0.43 이었고, 그 상태로 "3" 을 0.836 점으로 자신 있게 "5" 라고 읽었다.
 * 출처를 하나 늘릴 때마다 표본을 다시 모으는 구조라 끝이 없었다.
 *
 * 분류기는 흐림·리샘플·대비 변화를 증강으로 배우므로 그 축이 사라진다.
 * 파라미터 2853개, 가중치 24KB, 의존성 없음. 파일 단위 5-fold 로 196/196.
 *
 * 구조: conv3x3x8 - relu - pool2 - conv3x3x16 - relu - pool2 - fc(5)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GempagoDigitCNN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /*
   * 값 띠 안에서 숫자가 놓이는 자리. 위/아래는 가운데, 좌/우는 "Lv. N" 이라 오른쪽이다.
   * layout REF 와 같은 2048 기준이고 실행 시 배율을 곱한다.
   */
  const CENTER = { top: 80, left: 100, right: 100, bottom: 80 };

  function prepare(json) {
    const w = {};
    for (const k of Object.keys(json.weights)) w[k] = Float32Array.from(json.weights[k]);
    const W = json.window.w, H = json.window.h;
    const C1 = json.shape.C1, C2 = json.shape.C2;
    const H1 = H - 2, W1 = W - 2, H2 = H1 >> 1, W2 = W1 >> 1;
    const H3 = H2 - 2, W3 = W2 - 2, H4 = H3 >> 1, W4 = W3 >> 1;
    return { w, W, H, C1, C2, H1, W1, H2, W2, H3, W3, H4, W4, FLAT: H4 * W4 * C2, classes: json.classes };
  }

  /** 원본 좌표의 값 띠에서 숫자 창을 잘라 고정 크기·z 정규화로 만든다. */
  function crop(m, img, band, pos, scale) {
    const cx = band.x + Math.round(CENTER[pos] * scale);
    const cy = band.y + Math.round(band.h / 2);
    const cw = Math.round(26 * scale), ch = Math.round(22 * scale);
    const x0 = cx - Math.round(cw / 2), y0 = cy - Math.round(ch / 2);
    if (x0 < 0 || y0 < 0 || x0 + cw > img.width || y0 + ch > img.height) return null;

    const out = new Float32Array(m.W * m.H);
    for (let y = 0; y < m.H; y++) {
      const sy = y0 + (y + 0.5) * (ch / m.H) - 0.5;
      const yA = Math.max(y0, Math.min(y0 + ch - 1, Math.floor(sy)));
      const yB = Math.min(y0 + ch - 1, yA + 1), wy = sy - yA;
      for (let x = 0; x < m.W; x++) {
        const sx = x0 + (x + 0.5) * (cw / m.W) - 0.5;
        const xA = Math.max(x0, Math.min(x0 + cw - 1, Math.floor(sx)));
        const xB = Math.min(x0 + cw - 1, xA + 1), wx = sx - xA;
        const a = img.data[yA * img.width + xA], b = img.data[yA * img.width + xB];
        const c = img.data[yB * img.width + xA], d = img.data[yB * img.width + xB];
        out[y * m.W + x] = (a * (1 - wx) + b * wx) * (1 - wy) + (c * (1 - wx) + d * wx) * wy;
      }
    }
    // 밝기/대비를 없앤다. 게임 밝기 설정과 무관해야 한다 (NCC 를 쓰는 이유와 같다).
    let sum = 0;
    for (let i = 0; i < out.length; i++) sum += out[i];
    const mean = sum / out.length;
    let ss = 0;
    for (let i = 0; i < out.length; i++) { const d = out[i] - mean; ss += d * d; }
    const sd = Math.sqrt(ss / out.length) || 1;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) / sd;
    return out;
  }

  function forward(m, x) {
    const { w, W, H1, W1, C1, C2, H2, W2, H3, W3, H4, W4, FLAT } = m;
    const a1 = new Float32Array(C1 * H1 * W1);
    for (let f = 0; f < C1; f++) for (let y = 0; y < H1; y++) for (let xx = 0; xx < W1; xx++) {
      let s = w.b1[f];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) s += w.w1[f * 9 + j * 3 + i] * x[(y + j) * W + xx + i];
      a1[(f * H1 + y) * W1 + xx] = s > 0 ? s : 0;
    }
    const p1 = new Float32Array(C1 * H2 * W2);
    for (let f = 0; f < C1; f++) for (let y = 0; y < H2; y++) for (let xx = 0; xx < W2; xx++) {
      let b = -Infinity;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const v = a1[(f * H1 + y * 2 + j) * W1 + xx * 2 + i];
        if (v > b) b = v;
      }
      p1[(f * H2 + y) * W2 + xx] = b;
    }
    const a2 = new Float32Array(C2 * H3 * W3);
    for (let f = 0; f < C2; f++) for (let y = 0; y < H3; y++) for (let xx = 0; xx < W3; xx++) {
      let s = w.b2[f];
      for (let c = 0; c < C1; c++) for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++)
        s += w.w2[((f * C1 + c) * 3 + j) * 3 + i] * p1[(c * H2 + y + j) * W2 + xx + i];
      a2[(f * H3 + y) * W3 + xx] = s > 0 ? s : 0;
    }
    const p2 = new Float32Array(FLAT);
    for (let f = 0; f < C2; f++) for (let y = 0; y < H4; y++) for (let xx = 0; xx < W4; xx++) {
      let b = -Infinity;
      for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) {
        const v = a2[(f * H3 + y * 2 + j) * W3 + xx * 2 + i];
        if (v > b) b = v;
      }
      p2[(f * H4 + y) * W4 + xx] = b;
    }
    const lg = new Float32Array(m.classes.length);
    for (let k = 0; k < m.classes.length; k++) {
      let s = w.b3[k];
      for (let i = 0; i < FLAT; i++) s += w.w3[k * FLAT + i] * p2[i];
      lg[k] = s;
    }
    let mx = -Infinity;
    for (let k = 0; k < lg.length; k++) if (lg[k] > mx) mx = lg[k];
    let sum = 0;
    const prob = new Float32Array(lg.length);
    for (let k = 0; k < lg.length; k++) { prob[k] = Math.exp(lg[k] - mx); sum += prob[k]; }
    for (let k = 0; k < lg.length; k++) prob[k] /= sum;
    return prob;
  }

  /**
   * 값 띠 하나를 읽는다.
   * @returns {{value:number, prob:number, margin:number}|null}
   */
  function classify(m, img, band, pos, scale) {
    const x = crop(m, img, band, pos, scale);
    if (!x) return null;
    const p = forward(m, x);
    let bi = 0, second = -1;
    for (let k = 1; k < p.length; k++) if (p[k] > p[bi]) bi = k;
    for (let k = 0; k < p.length; k++) if (k !== bi && p[k] > second) second = p[k];
    return { value: m.classes[bi], prob: p[bi], margin: p[bi] - second };
  }

  return { prepare, classify, forward, crop, CENTER };
});
