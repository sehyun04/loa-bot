/*
 * 솔버 워커.
 *
 * solveFull 은 영웅 젬 기준 2초쯤 걸린다. 메인 스레드에서 돌리면 그동안 화면이 얼어붙는다.
 *
 * rules.js / solver.js 를 importScripts 로 못 부르는 이유:
 * importScripts 는 전역 스코프를 공유하는데, solver.js 가 `const { MIN_VALUE, ... }` 로
 * 구조분해하는 이름들이 rules.js 의 최상위 const 와 그대로 부딪혀서 재선언 에러가 난다.
 * 그래서 여기서 최소한의 CommonJS 로더를 만들어 각 파일을 자기 스코프에서 실행한다.
 * 이렇게 하면 두 파일을 Node 모듈 그대로 두고 브라우저에서도 쓸 수 있다(테스트와 같은 코드).
 */
const loaded = {};

async function loadModule(url, key) {
  const src = await (await fetch(url)).text();
  const module = { exports: {} };
  const fn = new Function('module', 'exports', 'require', src);
  // 상대 경로 표기는 무시하고 파일명으로만 찾는다. vision/ 에서는 '../rules.js' 로 부른다.
  fn(module, module.exports, (p) => loaded[p.replace(/^(\.\.?\/)+/, '')]);
  loaded[key] = module.exports;
  return module.exports;
}

let rules = null;
let solver = null;
let interpret = null;
let reader = null;
const solutions = new Map(); // 목표+최대횟수 조합당 한 번만 푼다

// 화면 인식 템플릿. 메인 스레드가 canvas 로 디코딩해서 한 번 넘겨준다.
let atlas = null;
// 배율 탐색은 2초쯤 걸리는데 같은 화면에서는 변하지 않는다. 한 번 찾으면 재사용한다.
let cachedScale = null;

const ready = (async () => {
  rules = await loadModule('rules.js', 'rules.js');
  solver = await loadModule('solver.js', 'solver.js');
  await loadModule('vision/ncc.js', 'ncc.js');
  await loadModule('vision/layout.js', 'layout.js');
  reader = await loadModule('vision/reader.js', 'reader.js');
  interpret = await loadModule('vision/interpret.js', 'interpret.js');
})();

/**
 * 항목 이름을 게임 화면 표기로. "1번 효과 +1" 이 아니라 "공격력 Lv. 1 증가".
 * 드롭다운과 결과 표가 같은 표기를 써야 화면과 대조할 수 있다.
 */
function screenLabel(o, slots) {
  const s = interpret.toScreenText(o, slots);
  if (!s) return o.label;
  return s.value && s.value.text ? `${s.labelText} ${s.value.text}` : s.labelText;
}

let lastRead = null;

/**
 * 판독 결과를 메인 스레드가 쓸 모양으로. origin.image 는 화면 전체라 크므로 뺀다.
 * slot 을 같이 돌려주는 이유: 어느 옵션명이 이 젬의 수치로 매칭되지 않았는지
 * 호출부가 알아야 "그 이름을 효과 이름 칸에 넣어라" 고 안내하거나 자동으로 채울 수 있다.
 */
function describe(options, slots) {
  const picks = interpret.toPicks(options, slots);
  return {
    options: options.map((o) => ({
      labelText: o.labelText,
      valueText: o.value ? o.value.text : null,
      confident: o.confident,
      labelScore: o.labelScore,
      labelMargin: o.labelMargin,
      valueScore: o.value ? o.value.confidence : 0,
      slot: interpret.resolveSlot(o.labelText, slots),
      special: !!interpret.SPECIAL_LABELS[o.labelText],
    })),
    picks: picks.ids,
    resolved: picks.resolved,
    problems: picks.problems,
  };
}

function solutionFor(target, maxAttempts) {
  const key = JSON.stringify(target) + '|' + maxAttempts;
  let sol = solutions.get(key);
  if (!sol) {
    const t0 = Date.now();
    sol = solver.solveFull(solver.thresholdTarget(target), maxAttempts);
    sol.__ms = Date.now() - t0;
    solutions.set(key, sol);
  }
  return sol;
}

self.onmessage = async (e) => {
  await ready;
  const { id, type, payload } = e.data;
  try {
    if (type === 'outcomes') {
      // 지금 상태에서 화면에 뜰 수 있는 항목만 돌려준다. 선택 UI 를 채우는 데 쓴다.
      // 이름은 게임 화면 그대로 보여준다 - "1번 효과 +1" 이 아니라 "공격력 Lv. 1 증가".
      // 화면과 목록을 눈으로 대조해야 하는 작업이라 표기가 같아야 덜 헷갈린다.
      const outs = rules.availableOutcomes(payload.state);
      self.postMessage({
        id, ok: true,
        result: outs.map((o) => ({ id: o.id, label: screenLabel(o, payload.slots) })),
      });
      return;
    }

    if (type === 'evaluate') {
      const { state, target, maxAttempts, picks, slots } = payload;
      const sol = solutionFor(target, maxAttempts);

      const result = {
        value: sol.value(state),
        ms: sol.__ms,
        alreadyMet: solver.thresholdTarget(target)(state),
      };

      if (picks && picks.length === 4) {
        result.decision = sol.decide(state, picks);
        // 어느 항목이 걸리느냐에 따라 결과가 얼마나 달라지는지 같이 보여준다.
        result.perPick = picks.map((pid) => {
          const o = rules.OUTCOMES.find((x) => x.id === pid);
          const next = rules.applyOutcome(state, o);
          if (o.kind === 'reroll') next.r = Math.min(solver.MAX_REROLL, state.r + o.gain);
          else next.r = state.r;
          return { id: pid, label: screenLabel(o, slots), value: sol.value(next) };
        });
      }
      self.postMessage({ id, ok: true, result });
      return;
    }

    if (type === 'atlas') {
      atlas = payload.atlas;
      cachedScale = null;
      self.postMessage({ id, ok: true, result: { keys: Object.keys(atlas.label).length } });
      return;
    }

    if (type === 'read') {
      if (!atlas) throw new Error('템플릿이 아직 안 올라왔습니다');
      const { image, slots } = payload;

      const t0 = Date.now();
      const opts = {};
      // 배율을 이미 아는 경우에만 건너뛴다. 창 크기가 바뀌면 호출부가 캐시를 비운다.
      if (cachedScale != null) opts.scale = cachedScale;
      let r = reader.readOptions(image, atlas, opts);

      // 캐시한 배율로 실패하면 화면이 바뀐 것이다. 한 번은 다시 찾아본다.
      if (!r.ok && cachedScale != null) {
        cachedScale = null;
        r = reader.readOptions(image, atlas, {});
      }
      if (!r.ok) { self.postMessage({ id, ok: true, result: { found: false, reason: r.reason } }); return; }
      cachedScale = r.origin.scale;

      // 옵션 4개와 함께 다이아(현재 수치)와 리롤/가공 횟수도 읽는다.
      // 원점은 이미 잡았으니 재탐색 없음.
      const dia = reader.readDiamonds(null, atlas, { origin: r.origin });
      const meta = reader.readMeta(null, atlas, { origin: r.origin });
      // 검산: 젬 포인트 = 네 수치의 합. 애매한 자리 하나는 계산으로 복구되고,
      // 합이 안 맞으면 네 자리 전부 의심으로 내려간다.
      const sumCheck = dia.ok && meta.ok
        ? reader.reconcileGem(dia.gem, meta.gemPoint)
        : { status: 'unknown' };

      lastRead = r.options;
      self.postMessage({
        id, ok: true,
        result: Object.assign({
          found: true,
          ms: Date.now() - t0,
          scale: r.origin.scale,
          anchorScore: r.origin.score,
          gem: dia.ok ? dia.gem : null,
          meta: meta.ok
            ? { reroll: meta.reroll, attemptsLeft: meta.attemptsLeft, attemptsMax: meta.attemptsMax, cost: meta.cost }
            : null,
          sumCheck,
        }, describe(r.options, slots)),
      });
      return;
    }

    // 효과 이름을 채워 넣은 뒤 같은 판독 결과를 다시 해석한다. 화면을 다시 읽을 필요가 없다.
    if (type === 'resolve') {
      if (!lastRead) throw new Error('아직 읽은 화면이 없습니다');
      self.postMessage({ id, ok: true, result: Object.assign({ found: true }, describe(lastRead, payload.slots)) });
      return;
    }

    if (type === 'forgetScale') { cachedScale = null; self.postMessage({ id, ok: true, result: true }); return; }

    throw new Error('알 수 없는 요청: ' + type);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
