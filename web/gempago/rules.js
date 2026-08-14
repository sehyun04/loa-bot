/*
 * 젬 가공 규칙 모델.
 *
 * 확률/조건은 전부 스마일게이트 공식 확률 공개 페이지에서 가져온 값이다.
 * (https://m-lostark.game.onstove.com/Probability/젬 가공, 젬 융합)
 * 추정치가 아니므로 임의로 손대지 말 것 - 숫자를 바꾸면 계산 결과 전체가 거짓이 된다.
 *
 * 가공 1회 = 아래 분포에서 서로 다른 4개를 뽑아 보여주고, 그중 하나가 각 25% 로 적용된다.
 */

/** 젬이 가진 네 수치. 전부 1~5 범위이고 클수록 좋다. */
const STATS = ['will', 'point', 'opt1', 'opt2'];

const STAT_LABEL = {
  will: '의지력 효율',
  point: '포인트',
  opt1: '1번 효과',
  opt2: '2번 효과',
};

const MIN_VALUE = 1;
const MAX_VALUE = 5;

/**
 * 수치 증감 항목의 확률. 네 수치가 모두 같은 표를 쓴다.
 * delta 가 양수면 (값 + delta) 가 5 를 넘을 때 안 뜨고, -1 은 값이 1 이면 안 뜬다.
 * 공식 표의 "안 뜨는 조건"이 정확히 이 규칙과 일치한다(+4 는 값 2 이상이면 제외 = 1 에서만 등장).
 */
const DELTA_TABLE = [
  { delta: +1, prob: 11.65 },
  { delta: +2, prob: 4.40 },
  { delta: +3, prob: 1.75 },
  { delta: +4, prob: 0.45 },
  { delta: -1, prob: 3.00 },
];

/** 수치 증감이 아닌 항목들. */
const SPECIAL_TABLE = [
  // 효과의 "종류"만 바뀌고 레벨은 그대로다. 레벨 목표만 보는 v1 에서는 상태가 변하지 않는다.
  { kind: 'change', slot: 'opt1', prob: 3.25 },
  { kind: 'change', slot: 'opt2', prob: 3.25 },
  // 비용 배율. 젬 결과에는 영향이 없고 골드만 바뀐다. 다만 "이미 그 배율" / "마지막 1회"
  // 조건 때문에 등장 가능 여부에 영향을 주므로 상태로 들고 있어야 한다.
  { kind: 'cost', costMod: +1, prob: 1.75 },
  { kind: 'cost', costMod: -1, prob: 1.75 },
  // 아무 일도 일어나지 않는다. 가공 횟수만 소모된다.
  { kind: 'keep', prob: 1.75 },
  // 리롤(다른 항목 보기) 횟수 획득.
  { kind: 'reroll', gain: 1, prob: 2.50 },
  { kind: 'reroll', gain: 2, prob: 0.75 },
];

/** 전체 항목 목록. 각 항목은 (조건이 맞을 때) 후보로 뽑힐 수 있는 하나의 결과다. */
const OUTCOMES = (() => {
  const list = [];
  for (const stat of STATS) {
    for (const { delta, prob } of DELTA_TABLE) {
      list.push({
        id: `${stat}${delta > 0 ? '+' : ''}${delta}`,
        kind: 'delta',
        stat,
        delta,
        prob,
        label: `${STAT_LABEL[stat]} ${delta > 0 ? '+' : ''}${delta}`,
      });
    }
  }
  for (const s of SPECIAL_TABLE) {
    if (s.kind === 'change') {
      list.push({ ...s, id: `change:${s.slot}`, label: `${STAT_LABEL[s.slot]} 변경` });
    } else if (s.kind === 'cost') {
      list.push({
        ...s,
        id: `cost:${s.costMod > 0 ? '+' : ''}${s.costMod}`,
        label: `가공 비용 ${s.costMod > 0 ? '+' : '-'}100%`,
      });
    } else if (s.kind === 'keep') {
      list.push({ ...s, id: 'keep', label: '가공 상태 유지' });
    } else if (s.kind === 'reroll') {
      list.push({ ...s, id: `reroll+${s.gain}`, label: `다른 항목 보기 +${s.gain}회` });
    }
  }
  return list;
})();

/**
 * 주어진 상태에서 후보로 뜰 수 있는 항목만 추린다.
 * @param {{will:number,point:number,opt1:number,opt2:number,n:number,cost:number}} s
 *        n = 남은 가공 횟수, cost = 비용 배율 (-1 | 0 | +1)
 */
function availableOutcomes(s) {
  const isLast = s.n <= 1; // 마지막 1회에는 비용/리롤 항목이 뜨지 않는다
  return OUTCOMES.filter((o) => {
    if (o.kind === 'delta') {
      const v = s[o.stat];
      return o.delta > 0 ? v + o.delta <= MAX_VALUE : v > MIN_VALUE;
    }
    if (o.kind === 'cost') return !isLast && s.cost !== o.costMod;
    if (o.kind === 'reroll') return !isLast;
    return true; // change / keep 은 항상 등장 가능
  });
}

/** 항목 하나를 적용한 다음 상태. 가공 횟수는 여기서 줄인다. */
function applyOutcome(s, o) {
  const next = { ...s, n: s.n - 1 };
  if (o.kind === 'delta') {
    next[o.stat] = s[o.stat] + o.delta;
  } else if (o.kind === 'cost') {
    next.cost = o.costMod;
  } else if (o.kind === 'reroll') {
    next.r = s.r + o.gain;
  }
  // change / keep 은 레벨을 바꾸지 않으므로 그대로 둔다.
  return next;
}

module.exports = {
  STATS,
  STAT_LABEL,
  MIN_VALUE,
  MAX_VALUE,
  DELTA_TABLE,
  SPECIAL_TABLE,
  OUTCOMES,
  availableOutcomes,
  applyOutcome,
};
