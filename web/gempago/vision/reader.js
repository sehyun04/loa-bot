/*
 * 가공 화면에서 "다음 항목" 4개를 읽는다.
 *
 * 값을 통째로 매칭하지 않는 이유(실측):
 *   "Lv. 1 증가" vs "Lv. 2 증가" = 0.907
 *   "+2 증가"   vs "+1 증가"    = 0.892
 * 정답이 1.000 이어도 마진이 0.09 뿐이라 언제 뒤집혀도 이상하지 않다.
 * 글자 대부분이 같고 숫자 한 글자만 다르니 당연한 결과다.
 *
 * 그래서 값은 접두(Lv./+) · 숫자 · 접미(증가/감소)로 쪼개서 각각 맞춘다.
 * 숫자는 글리프에 딱 맞추지 않고 고정폭 8px 창을 씌운다. 좌우 여백이 패턴에
 * 들어가서 얇은 "1"(폭 2px)과 넓은 "2"(폭 6px)가 폭 자체로 갈린다.
 * 이렇게 하면 마진이 0.09 -> 0.60 으로 회복된다(같은 숫자 0.93~0.96, 다른 숫자 0.24~0.33).
 *
 * 옵션명은 통째로 매칭해도 마진이 0.74 라서 쪼갤 이유가 없다.
 */
(function (root, factory) {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const api = factory(
    isNode ? require('./ncc.js') : root.GempagoNCC,
    isNode ? require('./layout.js') : root.GempagoLayout
  );
  if (isNode) module.exports = api;
  else root.GempagoReader = api;
})(typeof self !== 'undefined' ? self : this, function (ncc, layout) {
  'use strict';

  const DIGIT_WINDOW = 8;

  /** 후보 템플릿들 중 최고점과 2등 격차. 격차가 작으면 호출부가 의심할 수 있다. */
  function pick(img, band, templates) {
    const scored = [];
    for (const name of Object.keys(templates)) {
      const t = templates[name];
      if (t.width > band.w || t.height > band.h) continue;
      const b = ncc.best(img, t, band);
      if (b) scored.push({ name, score: b.score, x: b.x, y: b.y, w: t.width });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    top.margin = scored[1] ? top.score - scored[1].score : top.score;
    top.runnerUp = scored[1] ? scored[1].name : null;
    return top;
  }

  /**
   * 값 셀 하나를 읽는다.
   * @returns {{prefix, digit, suffix, text, scores}|null}
   */
  function readValue(img, cell, atlas) {
    const prefix = pick(img, cell, atlas.prefix);
    const suffix = pick(img, cell, atlas.suffix);
    if (!prefix || !suffix) return null;

    // 숫자는 접두와 접미 사이에 있다. 그 구간의 글자 덩어리만 모아 중심을 잡는다.
    const gap = {
      x: prefix.x + prefix.w,
      y: cell.y,
      w: Math.max(0, suffix.x - (prefix.x + prefix.w)),
      h: cell.h,
    };
    if (gap.w < DIGIT_WINDOW) return null;

    // 창 위치를 글자 중심으로 계산해서 고정하면 안 된다. 숫자 글리프는 폭이 2~6px 라
    // 1px 만 어긋나도 점수가 1.000 -> 0.575 로 떨어진다(실측). 대신 gap 안에서
    // 8px 템플릿을 미끄러뜨리고 최고점을 고른다 - 정렬은 NCC 가 알아서 맞춘다.
    const digit = pick(img, gap, atlas.digit);
    if (!digit) return null;

    // 접두마다 띄어쓰기가 다르다 ("Lv. 1 증가" vs "+1 증가"). manifest 의 pattern 을 따른다.
    const pattern = atlas.pattern.prefix[prefix.name] || '{p}{d} {s}';
    const text = pattern
      .replace('{p}', atlas.text.prefix[prefix.name])
      .replace('{d}', digit.name)
      .replace('{s}', atlas.text.suffix[suffix.name]);

    return {
      prefix: prefix.name,
      digit: digit.name,
      suffix: suffix.name,
      text,
      scores: {
        prefix: prefix.score,
        digit: digit.score,
        digitMargin: digit.margin,
        suffix: suffix.score,
      },
    };
  }

  /**
   * 화면 전체에서 4개 항목을 읽는다.
   * @param {{width,height,data:Float32Array}} img 그레이 이미지
   * @param {object} atlas { anchor, label:{}, prefix:{}, digit:{}, suffix:{}, text:{} }
   */
  function readOptions(img, atlas, opts) {
    const o = opts || {};
    const origin = layout.locate(img, atlas.anchor, o.minAnchorScore);
    if (!origin) return { ok: false, reason: '가공 화면을 찾지 못했습니다 (앵커 불일치)' };

    const options = layout.cells(origin).map((cell) => {
      const label = pick(img, cell.label, atlas.label);
      const value = readValue(img, cell.value, atlas);
      return {
        label: label ? label.name : null,
        labelText: label ? atlas.text.label[label.name] : null,
        labelScore: label ? label.score : 0,
        labelMargin: label ? label.margin : 0,
        value,
        // 하나라도 애매하면 통째로 의심으로 표시한다. 틀린 값을 조용히 넘기는 것보다 낫다.
        confident: !!(label && value &&
          label.score >= (o.minScore || 0.85) &&
          label.margin >= (o.minMargin || 0.15) &&
          value.scores.digit >= (o.minScore || 0.85) &&
          value.scores.digitMargin >= (o.minMargin || 0.15)),
      };
    });

    return { ok: true, origin, options };
  }

  return { readOptions, readValue, pick, DIGIT_WINDOW };
});
