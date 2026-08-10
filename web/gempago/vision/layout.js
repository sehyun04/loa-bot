/*
 * 가공 화면의 기하 구조.
 *
 * 화면에서 절대 좌표를 쓰지 않는다. 창 위치가 바뀌면 전부 틀리기 때문이다.
 * "다음 항목 중 무작위로 적용됩니다." 한 줄을 앵커로 찾고, 나머지는 전부 거기서의 상대 위치다.
 * 이 문장은 가공 화면에 항상 있고, 폭이 220px 이라 오탐이 사실상 불가능하다.
 *
 * 아래 숫자는 2048x1280 캡처(templates/manifest.json 의 source)에서 실측한 값이다.
 * 다른 해상도는 아직 캡처가 없어서 검증하지 못했다. scale 을 받도록 열어만 뒀다.
 */
(function (root, factory) {
  const api = factory(
    typeof require === 'function' ? require('./ncc.js') : root.GempagoNCC
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GempagoLayout = api;
})(typeof self !== 'undefined' ? self : this, function (ncc) {
  'use strict';

  /** 앵커 좌상단을 원점으로 한 상대 좌표. */
  const REF = {
    anchor: { w: 220, h: 14 },
    labelBand: { dy: 46, h: 14 },
    valueBand: { dy: 69, h: 13 },
    // 네 열의 중심. 간격은 약 124.7px 로 균일하지만, 실측값을 그대로 쓴다.
    columnDx: [-79, 45, 170, 295],
    // 셀 반폭. 56 을 넘기면 4번 열이 오른쪽 "N회 가능" 리롤 버튼을 물어온다.
    cellHalf: 56,
  };

  /**
   * 앵커를 찾아 원점을 잡는다.
   * @returns {{x:number,y:number,score:number,scale:number}|null}
   */
  function locate(img, anchorTpl, minScore) {
    const r = ncc.locate(img, anchorTpl, 4);
    if (!r || r.score < (minScore == null ? 0.7 : minScore)) return null;
    return { x: r.x, y: r.y, score: r.score, scale: 1 };
  }

  function rect(origin, band, col, s) {
    const cx = origin.x + REF.columnDx[col] * s;
    return {
      x: Math.round(cx - REF.cellHalf * s),
      y: Math.round(origin.y + band.dy * s),
      w: Math.round(REF.cellHalf * 2 * s),
      h: Math.round(band.h * s),
    };
  }

  /** 네 열의 옵션명/값 영역. */
  function cells(origin) {
    const s = origin.scale || 1;
    const out = [];
    for (let c = 0; c < 4; c++) {
      out.push({ label: rect(origin, REF.labelBand, c, s), value: rect(origin, REF.valueBand, c, s) });
    }
    return out;
  }

  /**
   * 영역 안에서 글자 덩어리의 x 구간을 찾는다.
   *
   * 임계값을 상수로 박으면 배경 장식 밝기에 따라 무너진다. 영역별 밝기 분포에서
   * 잡아야 한다 - 글자는 소수의 아주 밝은 픽셀이고 배경은 다수의 어두운 픽셀이라
   * 상위 분위수와 중앙값 사이를 자르면 안정적이다.
   */
  function glyphSpans(img, r, minGap) {
    const vals = [];
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) vals.push(img.data[y * img.width + x]);
    }
    vals.sort((a, b) => a - b);
    const mid = vals[Math.floor(vals.length * 0.5)];
    const hi = vals[Math.floor(vals.length * 0.98)];
    const thr = mid + (hi - mid) * 0.55;

    const on = [];
    for (let x = r.x; x < r.x + r.w; x++) {
      let c = 0;
      for (let y = r.y; y < r.y + r.h; y++) if (img.data[y * img.width + x] > thr) c++;
      on.push(c > 0);
    }

    const gapLimit = minGap == null ? 2 : minGap;
    const out = [];
    let start = -1, gap = 0;
    for (let i = 0; i < on.length; i++) {
      if (on[i]) { if (start < 0) start = i; gap = 0; }
      else if (start >= 0 && ++gap >= gapLimit) {
        out.push([r.x + start, r.x + i - gap + 1]);
        start = -1; gap = 0;
      }
    }
    if (start >= 0) out.push([r.x + start, r.x + r.w]);
    return out;
  }

  return { REF, locate, cells, glyphSpans };
});
