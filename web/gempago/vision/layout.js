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

    /*
     * 젬의 현재 수치를 보여주는 다이아 4개. 앵커보다 위에 있어서 dy 가 음수다.
     * 위/아래는 의지력·포인트라 값이 숫자 하나("5")이고,
     * 좌/우는 효과라 값이 "Lv. N" 이다.
     *
     * 배경이 옵션 행과 완전히 달라서(색깔 있는 다이아 + 원형 장식) 같은 글자여도
     * 템플릿을 따로 떠야 한다 - 옵션 행에서 뜬 "Lv." 는 다이아 배경에서 0.44 밖에 안 나온다.
     */
    diamond: {
      halfWidth: 80,
      top:    { dx: 109, label: { dy: -228, h: 15 }, value: { dy: -208, h: 19 } },
      left:   { dx: 27,  label: { dy: -161, h: 16 }, value: { dy: -142, h: 20 } },
      right:  { dx: 200, label: { dy: -161, h: 16 }, value: { dy: -142, h: 20 } },
      bottom: { dx: 109, label: { dy: -99,  h: 17 }, value: { dy: -75,  h: 20 } },
    },
  };

  /** 다이아 위치 이름과 그 자리가 뜻하는 수치. 좌/우가 1번/2번 효과인지는 화면만으로 알 수 없다. */
  const DIAMOND_SLOTS = { top: 'will', left: 'opt1', right: 'opt2', bottom: 'point' };

  /**
   * 화면을 기준 배율로 맞추고 앵커로 원점을 잡는다.
   *
   * 배율을 안 맞추면 다른 해상도에서 통째로 무너진다. NCC 는 배율에 관대하지 않아서
   * 2.3% 차이에 앵커 점수가 1.000 -> 0.56 으로 떨어진다(실측).
   * 템플릿마다 크기를 바꾸는 대신 화면 쪽을 기준 배율로 되돌린다 - 그러면 이후 코드가
   * 배율을 전혀 몰라도 된다.
   *
   * @returns {{image, x, y, score, scale}|null} image 는 기준 배율로 맞춘 화면
   */
  function locate(img, anchorTpl, opts) {
    const o = opts || {};
    const minScore = o.minScore == null ? 0.7 : o.minScore;

    // 배율 탐색은 2초쯤 걸린다. 같은 화면을 반복해서 읽을 때는 호출부가 알려주면 된다.
    let scale = o.scale;
    if (scale == null) {
      const found = ncc.findScale(img, anchorTpl, { min: o.minScale, max: o.maxScale });
      if (!found) return null;
      scale = found.scale;
    }

    const image = scale === 1 ? img : ncc.resize(img, 1 / scale);
    const r = ncc.locate(image, anchorTpl, 4);
    if (!r || r.score < minScore) return null;
    return { image, x: r.x, y: r.y, score: r.score, scale };
  }

  // locate 가 화면을 기준 배율로 되돌려 주므로 여기서는 배율을 곱하지 않는다.
  function rect(origin, band, col) {
    const cx = origin.x + REF.columnDx[col];
    return {
      x: Math.round(cx - REF.cellHalf),
      y: Math.round(origin.y + band.dy),
      w: REF.cellHalf * 2,
      h: band.h,
    };
  }

  /** 네 열의 옵션명/값 영역. */
  function cells(origin) {
    const out = [];
    for (let c = 0; c < 4; c++) {
      out.push({ label: rect(origin, REF.labelBand, c), value: rect(origin, REF.valueBand, c) });
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

  /** 다이아 4개의 옵션명/값 영역. 키는 top/left/right/bottom. */
  function diamonds(origin) {
    const half = REF.diamond.halfWidth;
    const out = {};
    for (const pos of Object.keys(DIAMOND_SLOTS)) {
      const d = REF.diamond[pos];
      const box = (band) => ({
        x: Math.round(origin.x + d.dx - half),
        y: Math.round(origin.y + band.dy),
        w: half * 2,
        h: band.h,
      });
      out[pos] = { slot: DIAMOND_SLOTS[pos], label: box(d.label), value: box(d.value) };
    }
    return out;
  }

  return { REF, DIAMOND_SLOTS, locate, cells, diamonds, glyphSpans };
});
