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
  fn(module, module.exports, (p) => loaded[p.replace('./', '')]);
  loaded[key] = module.exports;
  return module.exports;
}

let rules = null;
let solver = null;
const solutions = new Map(); // 목표+최대횟수 조합당 한 번만 푼다

const ready = (async () => {
  rules = await loadModule('rules.js', 'rules.js');
  solver = await loadModule('solver.js', 'solver.js');
})();

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
      const outs = rules.availableOutcomes(payload.state);
      self.postMessage({ id, ok: true, result: outs.map((o) => ({ id: o.id, label: o.label })) });
      return;
    }

    if (type === 'evaluate') {
      const { state, target, maxAttempts, picks } = payload;
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
          return { id: pid, label: o.label, value: sol.value(next) };
        });
      }
      self.postMessage({ id, ok: true, result });
      return;
    }

    throw new Error('알 수 없는 요청: ' + type);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
