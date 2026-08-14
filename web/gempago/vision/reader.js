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
    isNode ? require('./layout.js') : root.GempagoLayout,
    isNode ? require('./digit-cnn.js') : root.GempagoDigitCNN
  );
  if (isNode) module.exports = api;
  else root.GempagoReader = api;
})(typeof self !== 'undefined' ? self : this, function (ncc, layout, digitCNN) {
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

  /*
   * ---- 다이아 (젬의 현재 수치) ----
   *
   * 옵션 행과 달리 원형 장식 배경이 밝고 복잡해서 옵션 행 방식이 그대로 안 통한다.
   * 실측으로 확정한 방식 (README "다이아" 절, 측정은 make-diamond-templates.js):
   *
   * - 이름: 띠보다 좌우 8px 좁게 뜬 템플릿을 띠 안에서 미끄러뜨린다.
   *   좌/우 자리는 템플릿을 공유해도 된다 (leave-one-out 112/112).
   * - 숫자: 값 띠는 160px 인데 글자가 3~12px 라 배경이 점수를 다 먹는다.
   *   배경은 (젬 종류 x 배율) 조합 안에서는 동일한 UI 아트라서 빼버린다 -
   *   띠를 z 정규화한 뒤(밝기를 먼저 없애야 한다) 배경판(atlas.diaBg)을 뺀
   *   잔차에서 숫자 덩어리만 맞춘다. 숫자 템플릿은 자리마다 따로 둔다.
   */

  /** 띠를 잘라 z 정규화한다. */
  function zBand(img, r) {
    const data = new Float32Array(r.w * r.h);
    let sum = 0;
    for (let y = 0; y < r.h; y++) {
      for (let x = 0; x < r.w; x++) {
        const v = img.data[(r.y + y) * img.width + (r.x + x)];
        data[y * r.w + x] = v;
        sum += v;
      }
    }
    const mean = sum / data.length;
    let ss = 0;
    for (let i = 0; i < data.length; i++) { const d = data[i] - mean; ss += d * d; }
    const sd = Math.sqrt(ss / data.length) || 1;
    for (let i = 0; i < data.length; i++) data[i] = (data[i] - mean) / sd;
    return { width: r.w, height: r.h, data };
  }

  /** z 정규화한 띠에서 배경판을 뺀 잔차. 글자만 남는다. */
  function subtractBg(band, bg) {
    const data = new Float32Array(band.data.length);
    for (let i = 0; i < data.length; i++) data[i] = band.data[i] - bg.data[i];
    return { width: band.width, height: band.height, data };
  }

  /**
   * 잔차에서 글자 덩어리의 x 구간.
   *
   * 글자는 배경보다 밝아지기만 하므로 잔차가 양수뿐이다. 반면 다이아의 대각선 장식은
   * 캡처마다 1px 씩 어긋나서 같은 열에 +/- 쌍의 유령 줄무늬를 남긴다(실측: 유령이
   * 글자만큼 밝아서 양수 최대값만 보면 띠 전체가 덩어리 투성이가 된다).
   * 그래서 열 점수를 "양수 최대 - 음수 최대" 로 잡는다 - 유령은 상쇄되고 글자만 남는다.
   *
   * 임계값은 최대값에 상대적으로 잡는다 - z 단위 절대값으로 박으면
   * 캡처 출처(원본/리샘플/네이티브)에 따라 흔들린다.
   */
  function residualSpans(res, minGap) {
    const peak = new Float32Array(res.width);
    let max = 0;
    for (let x = 0; x < res.width; x++) {
      let pos = 0, neg = 0;
      for (let y = 0; y < res.height; y++) {
        const v = res.data[y * res.width + x];
        if (v > pos) pos = v;
        if (-v > neg) neg = -v;
      }
      peak[x] = Math.max(0, pos - neg);
      max = Math.max(max, peak[x]);
    }
    // 이 정도도 안 튀면 글자가 없는 것이다 (노이즈는 z 단위 0.3 근처).
    if (max < 1.0) return [];
    const thr = max * 0.35;

    const gapLimit = minGap == null ? 2 : minGap;
    const out = [];
    let start = -1, gap = 0;
    for (let x = 0; x < res.width; x++) {
      if (peak[x] > thr) { if (start < 0) start = x; gap = 0; }
      else if (start >= 0 && ++gap >= gapLimit) {
        out.push([start, x - gap + 1]);
        start = -1; gap = 0;
      }
    }
    if (start >= 0) out.push([start, res.width]);
    return out;
  }

  const DIA_VALUE_SLACK = 4;
  // 숫자 안쪽의 골(예: "4" 의 사선과 세로획 사이)이 2~3px 라 간격을 좁게 잡으면
  // 글자가 두 덩어리로 갈라지고, "Lv." 와 숫자 사이가 5px 라 넓게 잡으면 통째로
  // 붙는다. 4 가 둘 사이의 유일한 값이다.
  const DIA_GLYPH_GAP = 5;

  /**
   * 배경판은 하나가 아니다. 다이아 아트가 젬 종류(혼돈/질서)와 캡처 출처(배율)에 따라
   * 픽셀 수준에서 달라서(실측: 한 판으로 빼면 잔차 노이즈 0.3+, 같은 조합끼리는 0.02~0.11),
   * 조합별 판을 전부 빼보고 잔차가 가장 조용한 판을 고른다. 맞는 판이면 글자만 남고
   * 틀린 판이면 배경 무늬가 남으므로 자기 선택이 된다.
   */
  function bestResidual(band, variants) {
    const all = [];
    for (const bg of variants) {
      if (bg.width !== band.width || bg.height !== band.height) continue;
      const res = subtractBg(band, bg);
      const abs = Float32Array.from(res.data, Math.abs).sort();
      all.push({ res, noise: abs[Math.floor(abs.length * 0.9)] });
    }
    return all.sort((a, b) => a.noise - b.noise);
  }

  /** 다이아 값 하나(숫자 1~5)를 읽는다. */
  function readDiamondValue(img, band, atlas, pos) {
    const variants = atlas.diaBg && atlas.diaBg[pos];
    if (!variants || !variants.length) return null;

    // 조용한 판부터 시도한다. 가장 조용한 판에서 글자가 안 나오면 그 판이 이 숫자를
    // 흡수한 것이다(조합의 모든 캡처가 같은 숫자면 배경판에 숫자가 박힌다) - 다음 판은
    // 다른 조합이라 무늬 노이즈는 있어도 글자는 살아 있다.
    let res = null, spans = null, noise = null;
    for (const cand of bestResidual(zBand(img, band), variants)) {
      const s = residualSpans(cand.res, DIA_GLYPH_GAP);
      if (s.length) { res = cand.res; spans = s; noise = cand.noise; break; }
    }
    if (!spans) return null;

    // 숫자는 항상 마지막 덩어리다. 좌/우 값("Lv. N")은 잔차에 "Lv." 잔재가 앞에 남는다 -
    // 배경판의 "Lv." 는 캡처마다 숫자 폭만큼 어긋난 위치라 완전히 지워지지 않는다.
    const [x0, x1] = spans[spans.length - 1];
    const region = {
      x: Math.max(0, x0 - DIA_VALUE_SLACK),
      y: 0,
      w: Math.min(res.width - Math.max(0, x0 - DIA_VALUE_SLACK), (x1 - x0) + DIA_VALUE_SLACK * 2),
      h: res.height,
    };
    // 숫자 템플릿은 자리끼리만 맞춘다. 네 자리의 숫자 폰트 크기가 전부 조금씩 달라서
    // (실측: 위 "1" 7x12, 아래 "1" 6x11, 좌 "1" 12x16 - 교차 점수가 0.4~0.6 대로
    // 떨어진다) 자리를 섞으면 같은 숫자끼리도 진다. README 의 "네 자리 공유" 는
    // 15장 기준 측정이 틀렸던 것이다.
    const names = Object.keys(atlas['dia-digit']).filter((k) => k.indexOf(pos + ':') === 0);
    const digit = pick(res, region, atlas['dia-digit'], names);
    if (!digit) return null;
    return {
      digit: digit.name.split(':')[1],
      score: digit.score, margin: digit.margin, noise,
      runnerUp: digit.runnerUp ? digit.runnerUp.split(':')[1] : null,
    };
  }

  /*
   * 배경판이 이 화면과 맞는지의 한계선. 잔차에서 글자를 뺀 나머지가 이만큼 시끄러우면
   * 그 판으로 뺀 잔차는 글자가 아니라 무늬를 담고 있어서 숫자를 믿을 수 없다.
   *
   * 실측: 아는 출처(게임 스크린샷)는 자리별로 0.02~0.11 인데, 브라우저 화면 공유로
   * 들어온 프레임은 같은 해상도인데도 0.27~0.43 이었다(리샘플 경로가 달라서다).
   * 그때 왼쪽 다이아의 3 을 0.836 점으로 자신 있게 5 라고 읽었다 - 점수만으로는
   * 못 거르고 젬 포인트 검산이 겨우 잡아냈다. 그래서 판이 안 맞으면 아예 의심으로 둔다.
   */
  const DIA_BG_MAX_NOISE = 0.2;


  /** 자리마다 나올 수 있는 이름이 정해져 있다. 위는 의지력, 아래는 포인트, 좌/우는 효과. */
  function diaCandidates(atlas, pos) {
    const texts = atlas.text['dia-label'];
    const keys = Object.keys(atlas['dia-label']);
    const isWill = (k) => texts[k] === '의지력 효율';
    const isPoint = (k) => /포인트$/.test(texts[k]);
    if (pos === 'top') return keys.filter(isWill);
    if (pos === 'bottom') return keys.filter(isPoint);
    return keys.filter((k) => !isWill(k) && !isPoint(k));
  }

  /**
   * 다이아 4개(젬의 현재 수치)를 읽는다.
   * @param {object} [opts.origin] readOptions 가 이미 잡은 원점. 있으면 앵커 탐색을 건너뛴다.
   */
  function readDiamonds(img, atlas, opts) {
    const o = opts || {};
    const minScore = o.minScore == null ? 0.8 : o.minScore;
    const minMargin = o.minMargin == null ? 0.1 : o.minMargin;
    // 숫자는 5지선다라 점수가 높아도 2등과 붙어 있으면 믿으면 안 된다
    // (실측: 배경판이 숫자를 흡수한 캡처가 0.845 점으로 틀리는데 마진이 0.008 이었다).
    const valueMinMargin = o.valueMinMargin == null ? 0.05 : o.valueMinMargin;

    let origin = o.origin;
    if (!origin) {
      origin = layout.locate(img, atlas.anchor, o);
      if (!origin) return { ok: false, reason: '가공 화면을 찾지 못했습니다 (앵커 불일치)' };
    }
    const image = origin.image;

    // 이름은 템플릿 매칭(글자가 커서 리샘플을 견딘다), 숫자는 분류기.
    // 숫자만 원본 픽셀에서 읽는다 - 화면을 기준 배율로 늘리면 3~12px 짜리 글자에
    // 보간이 얹혀서 캡처 출처 차이가 증폭된다 (digit-cnn.js 주석 참고).
    const dia = layout.diamonds(origin);
    const diaNative = layout.diamonds(origin, true);
    const gem = {};
    for (const pos of Object.keys(dia)) {
      const label = pick(image, dia[pos].label, atlas['dia-label'], diaCandidates(atlas, pos));
      const value = atlas.digitCNN
        ? digitCNN.classify(atlas.digitCNN, origin.raw, diaNative[pos].value, pos, origin.scale)
        : readDiamondValue(image, dia[pos].value, atlas, pos);
      gem[pos] = {
        slot: dia[pos].slot,
        label: label ? label.name : null,
        labelText: label ? atlas.text['dia-label'][label.name] : null,
        // 분류기는 value/prob 를, 옛 템플릿 경로는 digit/score 를 준다.
        value: value ? (value.value != null ? value.value : +value.digit) : null,
        scores: {
          label: label ? label.score : 0,
          labelMargin: label ? label.margin : 0,
          value: value ? (value.prob != null ? value.prob : value.score) : 0,
          valueMargin: value ? value.margin : 0,
          bgNoise: value ? (value.noise == null ? 0 : value.noise) : null,
        },
        // 위/아래는 이름 후보가 1~2개뿐이라 이름 마진이 의미 없다. 점수만 본다.
        confident: !!(label && value &&
          label.score >= minScore &&
          (value.prob != null ? value.prob : value.score) >= minScore &&
          value.margin >= valueMinMargin &&
          (value.noise == null || value.noise <= DIA_BG_MAX_NOISE) &&
          (pos === 'top' || pos === 'bottom' || label.margin >= minMargin)),
      };
    }
    return { ok: true, origin, gem };
  }

  /**
   * 리롤 횟수("N회 가능")와 남은/전체 가공 횟수("가공 하기 (N/M)")를 읽는다.
   * 배경이 민무늬 버튼이라 옵션 행과 같은 방식(고정 창 + 미끄러뜨리기)이면 된다.
   * 창이 화면(크롭) 밖이거나 그 숫자의 템플릿이 없으면 해당 값은 null 이다.
   * @param {object} [opts.origin] readOptions 가 이미 잡은 원점
   */
  function readMeta(img, atlas, opts) {
    const o = opts || {};
    const minScore = o.minScore == null ? 0.8 : o.minScore;
    const minMargin = o.minMargin == null ? 0.05 : o.minMargin;

    let origin = o.origin;
    if (!origin) {
      origin = layout.locate(img, atlas.anchor, o);
      if (!origin) return { ok: false, reason: '가공 화면을 찾지 못했습니다 (앵커 불일치)' };
    }
    const image = origin.image;
    const bands = layout.metaBands(origin);

    // 리롤과 버튼의 숫자는 폰트 크기가 달라서 부류를 나눈다 (다이아와 같은 이유).
    const read = (band, cls) => {
      if (!band || !atlas['meta-digit']) return null;
      const names = Object.keys(atlas['meta-digit']).filter((k) => k.indexOf(cls + ':') === 0);
      const d = pick(image, band, atlas['meta-digit'], names);
      if (!d) return null;
      return {
        value: +d.name.split(':')[1],
        score: d.score,
        margin: d.margin,
        confident: d.score >= minScore && d.margin >= minMargin,
      };
    };

    return {
      ok: true,
      origin,
      reroll: read(bands.reroll, 'reroll'),
      attemptsLeft: read(bands.attemptsN, 'attempt'),
      attemptsMax: read(bands.attemptsM, 'attempt'),
      gemPoint: readGemPoint(image, atlas, bands.gemPoint, minScore, minMargin),
      cost: readCost(image, atlas, bands.costAmount, minScore, minMargin),
    };
  }

  /*
   * 화면은 가공 비용을 배율이 아니라 금액으로 보여주므로 기준 금액과 대조해 뒤집는다.
   * 실측 표본의 기준은 희귀(7회)·영웅(9회) 모두 900 이었다. 등급이 더 있거나 기준이
   * 다른 경우를 알 수 없으므로, 아는 금액이 아니면 null 을 돌려 호출부가 손대지 않게 한다.
   * +100%(1,800) 는 아직 표본이 없어 템플릿도 없다 - 그 화면은 조용히 넘어간다.
   */
  const COST_MOD_BY_GOLD = { 0: -1, 900: 0, 1800: 1 };

  function readCost(image, atlas, band, minScore, minMargin) {
    if (!band || !atlas['meta-cost']) return null;
    const c = pick(image, band, atlas['meta-cost']);
    if (!c) return null;
    const mod = COST_MOD_BY_GOLD[c.name];
    if (mod == null) return null;
    return {
      gold: +c.name,
      mod,
      score: c.score,
      margin: c.margin,
      confident: c.score >= minScore && c.margin >= minMargin,
    };
  }

  /**
   * "젬 포인트 N" 을 읽는다. 줄이 가운데 정렬이라 자릿수에 따라 밀리므로
   * "젬 포인트" 이름을 템플릿으로 찾아 앵커로 쓰고, 그 오른쪽 창의 글자 덩어리를
   * 숫자로 읽는다. 두 자리(10~20)면 덩어리가 2개다. "?" 아이콘은 창 밖이다.
   */
  // "젬 포인트" 이름 시작에서 숫자까지의 고정 간격. 이름 끝(x + 템플릿 폭)을 쓰면
  // 안 된다 - 템플릿 변형마다 잘린 폭이 1~3px 달라서 창이 그만큼 밀린다(실측).
  const GEM_POINT_DIGIT_DX = 66;

  function readGemPoint(image, atlas, band, minScore, minMargin) {
    if (!band || !atlas['meta-label'] || !atlas['meta-label']['gem-point']) return null;
    const label = pick(image, band, atlas['meta-label'], ['gem-point']);
    if (!label || label.score < 0.7) return null;

    const region = { x: label.x + GEM_POINT_DIGIT_DX, y: band.y, w: 24, h: band.h };
    const spans = layout.glyphSpans(image, region, 2).filter(([a, b]) => b - a >= 2);
    if (!spans.length || spans.length > 2) return null;

    const names = Object.keys(atlas['meta-digit']).filter((k) => k.indexOf('point:') === 0);
    const digits = [];
    let worst = 1, worstMargin = 1;
    for (const [x0] of spans) {
      const r = { x: Math.max(region.x, x0 - 2), y: band.y, w: 12, h: band.h };
      const d = pick(image, r, atlas['meta-digit'], names);
      if (!d) return null;
      digits.push(+d.name.split(':')[1]);
      worst = Math.min(worst, d.score);
      worstMargin = Math.min(worstMargin, d.margin);
    }
    const value = digits.length === 2 ? digits[0] * 10 + digits[1] : digits[0];
    // 젬 포인트는 수치 4개(각 1~5)의 합이라 4~20 이다. 두 자리면 첫 숫자는 1~2.
    const sane = value >= 4 && value <= 20 && (digits.length === 1 || digits[0] <= 2);
    return {
      value,
      score: worst,
      margin: worstMargin,
      confident: sane && label.score >= minScore && worst >= minScore && worstMargin >= minMargin,
    };
  }

  /**
   * 검산: 젬 포인트 = 네 수치의 합 (실측: 캡처 39장 전부에서 성립).
   * - 넷 다 확실한데 합이 안 맞으면 어디가 틀렸는지 모르므로 전부 의심으로 내린다.
   * - 하나만 애매하면 그 자리는 계산으로 나온다 - 템플릿이 없어 못 읽던 숫자도 복구된다.
   * @returns {{status: 'ok'|'recovered'|'mismatch'|'unknown', pos?: string, value?: number}}
   */
  function reconcileGem(gem, gemPoint) {
    if (!gem || !gemPoint || !gemPoint.confident) return { status: 'unknown' };
    const POS = ['top', 'left', 'right', 'bottom'];
    const unsure = POS.filter((p) => !gem[p].confident || gem[p].value == null);
    const sum = (ps) => ps.reduce((a, p) => a + gem[p].value, 0);

    const info = { gemPoint: gemPoint.value, sum: sum(POS) };
    if (!unsure.length) {
      if (info.sum === gemPoint.value) return Object.assign({ status: 'ok' }, info);
      for (const p of POS) gem[p].confident = false;
      return Object.assign({ status: 'mismatch' }, info);
    }
    if (unsure.length === 1) {
      const p = unsure[0];
      const v = gemPoint.value - sum(POS.filter((q) => q !== p));
      if (v >= 1 && v <= 5) {
        gem[p].value = v;
        gem[p].confident = true;
        gem[p].recovered = true;
        return Object.assign({ status: 'recovered', pos: p, value: v }, info);
      }
      return Object.assign({ status: 'mismatch' }, info);
    }
    return Object.assign({ status: 'unknown', unsure }, info);
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

  return {
    readOptions, readValue, pick, DIGIT_WINDOW,
    readDiamonds, readMeta, reconcileGem,
    zBand, subtractBg, residualSpans, bestResidual,
  };
});
