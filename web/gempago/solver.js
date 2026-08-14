/*
 * 젬 가공 확률 솔버.
 *
 * 목표: "지금 상태에서 남은 가공을 다 돌렸을 때, 원하는 젬이 될 확률"을 정확히 계산한다.
 * 근사(몬테카를로/시뮬레이션)가 아니라 역방향 귀납법으로 정확한 값을 구한다.
 * 상태 공간이 작아서(수십만) 가능하다.
 *
 * 뽑기 규칙: 등장 가능한 항목들에서 가중치 기반 비복원으로 4개를 뽑고, 그중 하나가 각 25% 로 적용된다.
 *
 * 여기서 "항목"의 단위는 (수치 x 증감폭)이다. 즉 완전히 같은 항목이 두 번 뜨지는 않지만,
 * "포인트 +1" 과 "포인트 +2" 처럼 같은 수치가 다른 증감폭으로 여러 개 뜨는 것은 정상이고,
 * 플러스와 마이너스가 같이 뜨기도 한다(실사용 확인). 실제로 같은 수치가 중복 등장하는
 * 조합이 전체의 52% 라서, 이걸 "수치 단위 비복원"으로 잘못 모델링하면 결과가 크게 틀어진다.
 *
 * 화면에 "가공 완료"가 있으므로 남은 횟수가 있어도 언제든 멈추고 확정할 수 있다.
 * 따라서 목표를 만족한 순간 값은 1 이고 더 굴리지 않는다 - 더 굴려봐야 -1 위험만 진다.
 * 이걸 빼먹으면 모든 확률이 과소평가된다(영웅 신품 1번효과 Lv.4 기준 45.78% vs 48.64%).
 */

const { MIN_VALUE, MAX_VALUE, availableOutcomes, applyOutcome } = require('./rules.js');

const PICK_COUNT = 4;

/**
 * 등장 가능 항목 집합의 서명.
 * 어떤 항목이 뜰 수 있는지는 네 수치의 값과 (마지막 1회인지, 현재 비용 배율)로만 정해진다.
 * 조합 확률 계산은 여기에만 의존하므로, 상태마다 다시 계산하지 않고 서명 단위로 캐시한다.
 * 이게 없으면 상태 24만 개마다 8천여 조합을 세느라 계산이 끝나지 않는다.
 */
function signatureOf(s) {
  return `${s.will}${s.point}${s.opt1}${s.opt2}|${s.n <= 1 ? 1 : 0}|${s.cost}`;
}

/**
 * 가중치 비복원으로 4개를 뽑을 때 특정 집합이 나올 확률.
 * 뽑는 순서마다 남은 가중치 합이 달라지므로 24가지 순서를 모두 더해야 한다.
 *
 * 재귀 + 배열 슬라이스로 짜면 할당 비용 때문에 전체 풀이가 30초를 넘긴다(실측).
 * 순서를 펼쳐서 할당 없이 계산한다.
 */
function subsetProb4(a, b, c, d, total) {
  const w = SUBSET_SCRATCH;
  w[0] = a; w[1] = b; w[2] = c; w[3] = d;

  let acc = 0;
  for (let i = 0; i < 4; i++) {
    const t1 = total;
    const p1 = w[i] / t1;
    for (let j = 0; j < 4; j++) {
      if (j === i) continue;
      const t2 = t1 - w[i];
      const p2 = w[j] / t2;
      for (let k = 0; k < 4; k++) {
        if (k === i || k === j) continue;
        const l = 6 - i - j - k; // 0+1+2+3 = 6 이므로 남은 하나가 바로 나온다
        const t3 = t2 - w[j];
        const t4 = t3 - w[k];
        acc += p1 * p2 * (w[k] / t3) * (w[l] / t4);
      }
    }
  }
  return acc;
}

const SUBSET_SCRATCH = new Float64Array(4);

/** 테스트용 래퍼. 임의 크기 집합을 받아 위 계산을 호출한다. */
function subsetProb(weights, idx, total) {
  return subsetProb4(weights[idx[0]], weights[idx[1]], weights[idx[2]], weights[idx[3]], total);
}

/**
 * 서명별로 "각 항목이 실제로 적용될 확률"을 구한다.
 * 항목 c 가 적용될 확률 = (c 가 4개 후보에 포함될 확률) / 4.
 * 리롤을 쓰지 않는 경우의 값 계산은 이 벡터만 있으면 되고, 상태마다 조합을 다시 볼 필요가 없다.
 */
function pickProbabilities(outcomes) {
  const n = outcomes.length;
  const weights = outcomes.map((o) => o.prob);
  const total = weights.reduce((a, b) => a + b, 0);
  const pick = new Array(n).fill(0);

  if (n <= PICK_COUNT) {
    // 후보가 4개 이하면 전부 뜬다 - 그중 하나가 균등하게 적용된다.
    return pick.map(() => 1 / n);
  }

  // 조합을 4중 루프로 펼친다. 재귀보다 눈에 띄게 빠르고, 어차피 뽑는 개수는 항상 4다.
  const quarter = 1 / PICK_COUNT;
  for (let i = 0; i < n - 3; i++) {
    const wi = weights[i];
    for (let j = i + 1; j < n - 2; j++) {
      const wj = weights[j];
      for (let k = j + 1; k < n - 1; k++) {
        const wk = weights[k];
        for (let l = k + 1; l < n; l++) {
          const p = subsetProb4(wi, wj, wk, weights[l], total) * quarter;
          pick[i] += p; pick[j] += p; pick[k] += p; pick[l] += p;
        }
      }
    }
  }

  return pick;
}

/** 상태를 정수 키로. 배열 인덱싱으로 메모이제이션하기 위한 것. */
function stateKey(s) {
  return ((((s.will - 1) * 5 + (s.point - 1)) * 5 + (s.opt1 - 1)) * 5 + (s.opt2 - 1)) * 3 + (s.cost + 1);
}

const GEM_STATES = 5 * 5 * 5 * 5 * 3;

function decodeKey(k, n) {
  const cost = (k % 3) - 1;
  let rest = (k - (k % 3)) / 3;
  const opt2 = (rest % 5) + 1; rest = (rest - (rest % 5)) / 5;
  const opt1 = (rest % 5) + 1; rest = (rest - (rest % 5)) / 5;
  const point = (rest % 5) + 1; rest = (rest - (rest % 5)) / 5;
  const will = (rest % 5) + 1;
  return { will, point, opt1, opt2, cost, n, r: 0 };
}

/**
 * 리롤을 쓰지 않는다고 가정한 값 함수.
 * V[n][stateKey] = 남은 가공 n회를 다 돌렸을 때 목표를 만족할 확률.
 *
 * @param {(s)=>boolean} meetsTarget 완성된 젬이 목표를 만족하는지
 * @param {number} maxAttempts 최대 가공 횟수 (고급 5 / 희귀 7 / 영웅 9)
 */
function solveNoReroll(meetsTarget, maxAttempts) {
  const sigCache = new Map();
  const layers = [];

  // n=0: 더 굴릴 수 없으므로 목표 달성 여부가 곧 값이다.
  const base = new Float64Array(GEM_STATES);
  for (let k = 0; k < GEM_STATES; k++) base[k] = meetsTarget(decodeKey(k, 0)) ? 1 : 0;
  layers[0] = base;

  for (let n = 1; n <= maxAttempts; n++) {
    const cur = new Float64Array(GEM_STATES);
    const prev = layers[n - 1];

    for (let k = 0; k < GEM_STATES; k++) {
      const s = decodeKey(k, n);

      // 화면에 "가공 완료"가 있으므로 언제든 멈추고 확정할 수 있다.
      // 목표를 이미 만족했으면 멈추는 게 항상 최선이다 - 더 굴려봐야 -1 을 맞을 위험만 진다.
      if (meetsTarget(s)) { cur[k] = 1; continue; }

      const sig = signatureOf(s);

      let entry = sigCache.get(sig);
      if (!entry) {
        const outs = availableOutcomes(s);
        entry = { outs, pick: pickProbabilities(outs) };
        sigCache.set(sig, entry);
      }

      let acc = 0;
      for (let i = 0; i < entry.outs.length; i++) {
        const p = entry.pick[i];
        if (p === 0) continue;
        acc += p * prev[stateKey(applyOutcome(s, entry.outs[i]))];
      }
      cur[k] = acc;
    }
    layers[n] = cur;
  }

  return {
    layers,
    signatures: sigCache.size,
    /** 특정 상태의 목표 달성 확률 */
    value(s) {
      return layers[s.n][stateKey(s)];
    },
  };
}

/**
 * 리롤 횟수 상한. 리롤은 2개로 시작하고 "다른 항목 보기 +1/+2" 항목으로만 늘어나는데
 * 그 항목이 뽑혀서 적용될 확률이 회당 3% 남짓이라 실제로 이 이상 쌓이는 일은 사실상 없다.
 * 상한을 두지 않으면 상태 공간만 늘고 계산 결과는 거의 달라지지 않는다.
 */
const MAX_REROLL = 6;

/**
 * 리롤 판단까지 포함한 완전한 값 함수.
 *
 *   V(s, n, r) = E[ max( 지금 뜬 4개로 굴리기, 리롤하고 다시 보기 ) ]
 *
 * 리롤은 가공 횟수를 소모하지 않고 리롤 횟수만 1 줄이므로 r 이 반드시 감소한다(무한 재귀 없음).
 * r=0 층은 선택지가 없어 적용확률 벡터만으로 싸게 구해지고, r>=1 층만 조합을 훑는다.
 */
function solveFull(meetsTarget, maxAttempts) {
  const sigCache = new Map();
  const subsetCache = new Map(); // 조합 확률은 무거워서 실제로 필요한 서명에 대해서만 만든다
  const V = []; // V[n][r] = Float64Array(GEM_STATES)

  const base = [];
  const zero = new Float64Array(GEM_STATES);
  for (let k = 0; k < GEM_STATES; k++) zero[k] = meetsTarget(decodeKey(k, 0)) ? 1 : 0;
  for (let r = 0; r <= MAX_REROLL; r++) base[r] = zero; // 더 굴릴 수 없으면 리롤도 의미 없다
  V[0] = base;

  const g = new Float64Array(32);
  const sorted = new Float64Array(32);
  let enumerated = 0;

  for (let n = 1; n <= maxAttempts; n++) {
    V[n] = [];
    for (let r = 0; r <= MAX_REROLL; r++) {
      const cur = new Float64Array(GEM_STATES);

      for (let k = 0; k < GEM_STATES; k++) {
        const s = decodeKey(k, n);
        s.r = r;

        // "가공 완료"로 즉시 확정할 수 있으므로, 목표를 만족한 순간 값은 1 이다.
        if (meetsTarget(s)) { cur[k] = 1; continue; }

        const sig = signatureOf(s);

        let entry = sigCache.get(sig);
        if (!entry) {
          const outs = availableOutcomes(s);
          entry = { outs, pick: pickProbabilities(outs), sig };
          sigCache.set(sig, entry);
        }
        const { outs, pick } = entry;
        const m = outs.length;

        // 각 항목을 적용했을 때의 값. 리롤 획득 항목은 다음 상태의 r 이 늘어난다.
        let expected = 0;
        for (let i = 0; i < m; i++) {
          const o = outs[i];
          const nr = o.kind === 'reroll' ? Math.min(MAX_REROLL, r + o.gain) : r;
          g[i] = V[n - 1][nr][stateKey(applyOutcome(s, o))];
          expected += pick[i] * g[i];
        }

        if (r === 0) { cur[k] = expected; continue; }

        const vReroll = V[n][r - 1][k];

        // 조합을 다 훑기 전에 경계로 걸러낸다.
        // 어떤 조합이 나와도 굴리는 게 낫거나, 반대로 항상 리롤이 나은 상태가 대부분이다.
        for (let i = 0; i < m; i++) sorted[i] = g[i];
        const arr = Array.prototype.slice.call(sorted, 0, m).sort((a, b) => a - b);
        const minAvg = (arr[0] + arr[1] + arr[2] + arr[3]) / 4;
        const maxAvg = (arr[m - 1] + arr[m - 2] + arr[m - 3] + arr[m - 4]) / 4;

        if (vReroll <= minAvg) { cur[k] = expected; continue; }
        if (vReroll >= maxAvg) { cur[k] = vReroll; continue; }

        let probs = subsetCache.get(sig);
        if (!probs) {
          probs = buildSubsetProbs(outs);
          subsetCache.set(sig, probs);
        }
        enumerated++;

        let acc = 0, t = 0;
        for (let i = 0; i < m - 3; i++)
          for (let j = i + 1; j < m - 2; j++)
            for (let a = j + 1; a < m - 1; a++)
              for (let b = a + 1; b < m; b++) {
                const avg = (g[i] + g[j] + g[a] + g[b]) / 4;
                acc += probs[t++] * (avg > vReroll ? avg : vReroll);
              }
        cur[k] = acc;
      }
      V[n][r] = cur;
    }
  }

  return {
    V,
    signatures: sigCache.size,
    enumeratedStates: enumerated,
    value(s) {
      return V[s.n][Math.min(MAX_REROLL, s.r)][stateKey(s)];
    },
    /**
     * 지금 뜬 4개를 보고 굴릴지 리롤할지 판단한다.
     * @param {object} s 현재 상태 (n, r 포함)
     * @param {string[]} ids 후보 4개의 항목 id
     */
    decide(s, ids) {
      const r = Math.min(MAX_REROLL, s.r);
      let commit = 0;
      for (const id of ids) {
        const o = OUTCOME_BY_ID.get(id);
        if (!o) throw new Error('알 수 없는 항목: ' + id);
        const nr = o.kind === 'reroll' ? Math.min(MAX_REROLL, r + o.gain) : r;
        commit += V[s.n - 1][nr][stateKey(applyOutcome(s, o))];
      }
      commit /= 4;
      if (r === 0) {
        // 리롤이 없으면 비교 대상 자체가 없다. 굴리는 것 말고 선택지가 없으므로 이득도 0.
        return { commit, reroll: null, action: 'commit', gain: 0 };
      }
      const reroll = V[s.n][r - 1][stateKey(s)];
      return {
        commit,
        reroll,
        action: commit >= reroll ? 'commit' : 'reroll',
        gain: Math.abs(commit - reroll),
      };
    },
  };
}

/** 서명 하나에 대한 모든 4개 조합의 확률. 루프 순서가 고정이라 인덱스는 저장하지 않는다. */
function buildSubsetProbs(outs) {
  const n = outs.length;
  const w = outs.map((o) => o.prob);
  const total = w.reduce((a, b) => a + b, 0);
  const out = new Float64Array((n * (n - 1) * (n - 2) * (n - 3)) / 24);
  let t = 0;
  for (let i = 0; i < n - 3; i++)
    for (let j = i + 1; j < n - 2; j++)
      for (let k = j + 1; k < n - 1; k++)
        for (let l = k + 1; l < n; l++) out[t++] = subsetProb4(w[i], w[j], w[k], w[l], total);
  return out;
}

const OUTCOME_BY_ID = new Map(require('./rules.js').OUTCOMES.map((o) => [o.id, o]));

/** 임계값 형태의 목표를 술어로. 지정하지 않은 항목은 상관하지 않는다. */
function thresholdTarget({ will = MIN_VALUE, point = MIN_VALUE, opt1 = MIN_VALUE, opt2 = MIN_VALUE }) {
  return (s) => s.will >= will && s.point >= point && s.opt1 >= opt1 && s.opt2 >= opt2;
}

module.exports = {
  PICK_COUNT,
  GEM_STATES,
  MAX_VALUE,
  signatureOf,
  subsetProb,
  pickProbabilities,
  stateKey,
  decodeKey,
  solveNoReroll,
  solveFull,
  MAX_REROLL,
  thresholdTarget,
};
