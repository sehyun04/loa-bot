/*
 * 가공 화면에서 "다음 항목" 4개를 읽는다.
 *
 * 값을 통째로 매칭하지 않는 이유(실측):
 *   "Lv. 1 증가" vs "Lv. 2 증가" = 0.907
 *   "+2 증가"   vs "+1 증가"    = 0.892
 * 정답이 1.000 이어도 마진이 0.09 뿐이라 언제 뒤집혀도 이상하지 않다.
 * 글자 대부분이 같고 숫자 한 글자만 다르니 당연한 결과다.
 *
 * 그래서 값은 접두(Lv./+/-) · 숫자 · 접미(증가/감소)로 쪼개서 각각 맞춘다.
 * 숫자는 글리프에 딱 맞추지 않고 고정폭 8px 창을 씌운다. 좌우 여백이 패턴에
 * 들어가서 얇은 "1"(폭 2px)과 넓은 "2"(폭 6px)가 폭 자체로 갈린다.
 *
 * 다만 값의 문법이 하나가 아니다. 실제 캡처에서 확인된 형태:
 *   "Lv. 3 증가"  "+4 증가"  "-1 감소"   <- 접두+숫자+접미
 *   "1회 증가"                          <- 숫자+접미 (접두 없음)
 *   "효과 변경"  "유지"  "+100% 증가"     <- 숫자 없음, 통짜
 * 어떤 문법인지는 옵션명이 결정한다("가공 상태"면 유지, "가공 비용"이면 ±100%).
 * 옵션명은 통째로 매칭해도 마진이 0.7 이상이라 이 분기가 가장 믿을 만하다.
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

  /**
   * 후보 문자열들 중 최고점과 2등 격차. 격차가 작으면 호출부가 의심할 수 있다.
   * 한 문자열에 템플릿이 여러 개면(출처가 다른 변형) 그중 최고점을 그 문자열의 점수로 본다.
   */
  function pick(img, band, templates, only) {
    const names = only || Object.keys(templates);
    const scored = [];
    for (const name of names) {
      const variants = templates[name];
      if (!variants) continue;
      let top = null;
      for (const t of variants) {
        if (t.width > band.w || t.height > band.h) continue;
        const b = ncc.best(img, t, band);
        if (b && (!top || b.score > top.score)) top = { score: b.score, x: b.x, y: b.y, w: t.width };
      }
      if (top) scored.push({ name, score: top.score, x: top.x, y: top.y, w: top.w });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    top.margin = scored[1] ? top.score - scored[1].score : top.score;
    top.runnerUp = scored[1] ? scored[1].name : null;
    return top;
  }

  /** 접두 + 숫자 + 접미 구조로 읽는다. 접두는 없을 수도 있다("1회 증가"). */
  function readStructured(img, cell, atlas, suffixNames, prefixNames) {
    const suffix = pick(img, cell, atlas.suffix, suffixNames);
    if (!suffix) return null;

    const prefix = prefixNames ? pick(img, cell, atlas.prefix, prefixNames) : null;
    // 접두가 접미보다 오른쪽에 있으면 잘못 걸린 것이다.
    const usePrefix = prefix && prefix.score >= 0.6 && prefix.x + prefix.w <= suffix.x;

    const from = usePrefix ? prefix.x + prefix.w : cell.x;
    const gap = { x: from, y: cell.y, w: Math.max(0, suffix.x - from), h: cell.h };
    if (gap.w < DIGIT_WINDOW) return null;

    // 창 위치를 글자 중심으로 계산해서 고정하면 안 된다. 글리프가 2~6px 라 1px 만
    // 어긋나도 점수가 1.000 -> 0.575 로 떨어진다(실측). gap 안에서 미끄러뜨린다.
    const digit = pick(img, gap, atlas.digit);
    if (!digit) return null;

    const parts = [prefix && usePrefix ? prefix.score : 1, digit.score, suffix.score];
    return {
      kind: 'structured',
      prefix: usePrefix ? prefix.name : null,
      digit: digit.name,
      suffix: suffix.name,
      confidence: Math.min.apply(null, parts),
      scores: {
        prefix: usePrefix ? prefix.score : null,
        digit: digit.score,
        digitMargin: digit.margin,
        suffix: suffix.score,
      },
    };
  }

  function wholeValue(img, cell, atlas, names) {
    const w = pick(img, cell, atlas.whole, names);
    if (!w) return null;
    return {
      kind: 'whole',
      whole: w.name,
      confidence: w.score,
      scores: { whole: w.score, digit: w.score, digitMargin: w.margin },
    };
  }

  function textOf(v, atlas) {
    if (v.kind === 'whole') return atlas.text.whole[v.whole];
    // 띄어쓰기 규칙은 접두가 들고 있다("Lv. 1 증가" vs "+1 증가"). 접두가 없는
    // 값("1회 증가")은 접미가 대신 들고 있다.
    const pattern = (v.prefix && atlas.pattern[v.prefix]) || atlas.pattern[v.suffix] || '{d} {s}';
    return pattern
      .replace('{p}', v.prefix ? atlas.text.prefix[v.prefix] : '')
      .replace('{d}', v.digit)
      .replace('{s}', atlas.text.suffix[v.suffix]);
  }

  /**
   * 값 셀 하나를 읽는다. family 는 옵션명이 정한다.
   */
  function readValue(img, cell, atlas, family) {
    if (family === 'keep') return wholeValue(img, cell, atlas, ['yuji']);
    if (family === 'cost') return wholeValue(img, cell, atlas, ['cost-plus', 'cost-minus']);
    if (family === 'reroll') return readStructured(img, cell, atlas, ['hoi-jeungga'], null);

    // 수치/효과: "효과 변경" 이거나 증감이다. 둘 다 재보고 근거가 더 튼튼한 쪽을 고른다.
    const change = wholeValue(img, cell, atlas, ['change']);
    const delta = readStructured(img, cell, atlas, ['jeungga', 'gamso'], ['lv', 'plus', 'minus']);
    if (!delta) return change;
    if (!change) return delta;
    return change.confidence > delta.confidence ? change : delta;
  }

  /**
   * 화면 전체에서 4개 항목을 읽는다.
   * @param {{width,height,data:Float32Array}} img 그레이 이미지
   * @param {object} atlas atlas.js 가 만든 템플릿 묶음
   */
  function readOptions(img, atlas, opts) {
    const o = opts || {};
    const minScore = o.minScore == null ? 0.8 : o.minScore;
    const minMargin = o.minMargin == null ? 0.15 : o.minMargin;

    const origin = layout.locate(img, atlas.anchor, o);
    if (!origin) return { ok: false, reason: '가공 화면을 찾지 못했습니다 (앵커 불일치)' };
    img = origin.image; // 기준 배율로 맞춘 화면

    const options = layout.cells(origin).map((cell) => {
      const label = pick(img, cell.label, atlas.label);
      const family = label ? (atlas.family[label.name] || 'stat') : 'stat';
      const value = label ? readValue(img, cell.value, atlas, family) : null;

      return {
        label: label ? label.name : null,
        labelText: label ? atlas.text.label[label.name] : null,
        labelScore: label ? label.score : 0,
        labelMargin: label ? label.margin : 0,
        family,
        value: value ? Object.assign({ text: textOf(value, atlas) }, value) : null,
        // 하나라도 애매하면 통째로 의심으로 표시한다. 틀린 값을 조용히 넘기는 것보다 낫다.
        confident: !!(label && value &&
          label.score >= minScore && label.margin >= minMargin &&
          value.confidence >= minScore),
      };
    });

    return { ok: true, origin, options };
  }

  return { readOptions, readValue, pick, DIGIT_WINDOW };
});
