/*
 * 확률 모델 + 솔버 회귀 테스트.  node web/gempago/test.js
 *
 * 여기서 지키려는 건 "값이 예쁘게 나오는가"가 아니라 모델이 성립하는가다.
 * 확률 합, 단조성, 리롤 DP 가 리롤 0 에서 비리롤 DP 와 정확히 일치하는가 같은 것들.
 */
const rules = require('./rules.js');
const solver = require('./solver.js');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  pass  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}
const pct = (v) => (v * 100).toFixed(4) + '%';

console.log('확률 표');
{
  const total = rules.OUTCOMES.reduce((a, o) => a + o.prob, 0);
  check('항목 27개', rules.OUTCOMES.length === 27, String(rules.OUTCOMES.length));
  check('합계 100.0000% (' + total.toFixed(4) + ')', Math.abs(total - 100) < 1e-9);

  const ids = new Set(rules.OUTCOMES.map((o) => o.id));
  check('id 중복 없음', ids.size === rules.OUTCOMES.length);

  // 값이 5 면 올려주는 항목은 안 뜨고, 1 이면 내리는 항목이 안 뜬다.
  const maxed = { will: 5, point: 5, opt1: 5, opt2: 5, n: 5, cost: 0, r: 0 };
  const ups = rules.availableOutcomes(maxed).filter((o) => o.kind === 'delta' && o.delta > 0);
  check('전부 5 면 상승 항목 없음', ups.length === 0, String(ups.length));

  const floor = { will: 1, point: 1, opt1: 1, opt2: 1, n: 5, cost: 0, r: 0 };
  const downs = rules.availableOutcomes(floor).filter((o) => o.kind === 'delta' && o.delta < 0);
  check('전부 1 이면 하락 항목 없음', downs.length === 0, String(downs.length));

  // +4 는 1 에서만 뜬다 (1+4=5). 공식 표의 "값 2 이상이면 제외"와 같은 조건이다.
  const plus4at1 = rules.availableOutcomes(floor).some((o) => o.delta === 4);
  const plus4at2 = rules.availableOutcomes({ ...floor, will: 2 })
    .some((o) => o.delta === 4 && o.stat === 'will');
  check('+4 는 값 1 에서만', plus4at1 && !plus4at2);

  // 마지막 1회에는 비용/리롤 항목이 뜨지 않는다.
  const last = rules.availableOutcomes({ will: 3, point: 3, opt1: 3, opt2: 3, n: 1, cost: 0, r: 0 });
  check('마지막 회차엔 비용/리롤 없음',
    !last.some((o) => o.kind === 'cost' || o.kind === 'reroll'));
}

console.log('조합 확률 (비복원 4개 뽑기)');
{
  // 균등 가중치면 각 조합이 같은 확률이고, 전부 더하면 1 이어야 한다.
  const w = [1, 1, 1, 1, 1, 1];
  const total = 6;
  let sum = 0, count = 0;
  for (let i = 0; i < 6; i++)
    for (let j = i + 1; j < 6; j++)
      for (let k = j + 1; k < 6; k++)
        for (let l = k + 1; l < 6; l++) { sum += solver.subsetProb(w, [i, j, k, l], total); count++; }
  check('조합 수 C(6,4)=15', count === 15, String(count));
  check('조합 확률 합 = 1 (' + sum.toFixed(10) + ')', Math.abs(sum - 1) < 1e-9);

  // 가중치가 다르면 무거운 쪽이 더 자주 포함돼야 한다.
  const heavy = solver.subsetProb([10, 1, 1, 1, 1], [0, 1, 2, 3], 14);
  const light = solver.subsetProb([10, 1, 1, 1, 1], [1, 2, 3, 4], 14);
  check('무거운 항목이 든 조합이 더 흔함', heavy > light, `${heavy} vs ${light}`);
}

console.log('비리롤 DP');
const targetLv4 = solver.thresholdTarget({ opt1: 4 });
const noReroll = solver.solveNoReroll(targetLv4, 9);
{
  const fresh = { will: 1, point: 1, opt1: 1, opt2: 1, n: 9, cost: 0, r: 0 };
  const v = noReroll.value(fresh);
  // 조기 종료("가공 완료")를 넣기 전에는 45.7838% 였다. 목표를 맞춘 뒤에도 남은 횟수를
  // 강제로 다 쓰느라 -1 위험을 계속 지고 있었던 값이라, 올라간 게 맞다.
  check('영웅 신품 1번효과 Lv.4 = 48.6388% (' + pct(v) + ')', Math.abs(v - 0.486388) < 1e-5);

  // 대칭성: 네 수치가 같은 표를 쓰므로 어느 걸 목표로 하든 값이 같아야 한다.
  const byWill = solver.solveNoReroll(solver.thresholdTarget({ will: 4 }), 9);
  check('수치 간 대칭', Math.abs(byWill.value(fresh) - v) < 1e-12);

  // 이미 달성한 상태는 1, 남은 횟수가 늘면 확률이 줄 수 없다.
  check('이미 달성 = 1', noReroll.value({ ...fresh, opt1: 4 }) === 1);
  let monotone = true;
  for (let n = 1; n < 9; n++) {
    if (noReroll.value({ ...fresh, n }) > noReroll.value({ ...fresh, n: n + 1 }) + 1e-12) monotone = false;
  }
  check('가공 횟수에 대해 단조 증가', monotone);
}

console.log('리롤 DP');
const t0 = Date.now();
const full = solver.solveFull(targetLv4, 9);
const elapsed = Date.now() - t0;
{
  console.log(`  (${elapsed}ms, 서명 ${full.signatures}개, 조합 훑은 상태 ${full.enumeratedStates}개)`);

  // 지금 리롤이 0 이어도 "다른 항목 보기 +1/+2" 를 뽑으면 나중에 생긴다.
  // 그래서 r=0 층은 비리롤 DP 와 같지 않고, 그 옵션 가치만큼 항상 크거나 같아야 한다.
  let dominates = true, maxGap = 0;
  for (let k = 0; k < solver.GEM_STATES; k++) {
    const d = full.V[9][0][k] - noReroll.layers[9][k];
    if (d < -1e-12) dominates = false;
    maxGap = Math.max(maxGap, d);
  }
  check('r=0 층이 비리롤 DP 이상 (최대 +' + (maxGap * 100).toFixed(3) + '%p)', dominates);
  check('그 차이가 리롤 옵션 가치만큼 존재', maxGap > 1e-6, maxGap.toExponential(2));

  // 리롤이 늘면 손해일 수 없다. 리롤은 안 쓰면 그만이므로.
  let rMonotone = true, inRange = true;
  for (let n = 0; n <= 9; n++) {
    for (let r = 0; r < solver.MAX_REROLL; r++) {
      for (let k = 0; k < solver.GEM_STATES; k++) {
        if (full.V[n][r][k] > full.V[n][r + 1][k] + 1e-12) rMonotone = false;
        const v = full.V[n][r][k];
        if (v < -1e-12 || v > 1 + 1e-12) inRange = false;
      }
    }
  }
  check('리롤 수에 대해 단조 증가', rMonotone);
  check('모든 값이 0..1', inRange);

  // 리롤을 가진 쪽이 안 가진 쪽보다 못할 수 없다.
  const fresh = { will: 1, point: 1, opt1: 1, opt2: 1, n: 9, cost: 0, r: 2 };
  check('리롤 2회가 0회보다 유리',
    full.value(fresh) >= full.value({ ...fresh, r: 0 }) - 1e-12,
    pct(full.value(fresh)) + ' vs ' + pct(full.value({ ...fresh, r: 0 })));
}

console.log('목표에 따라 리롤 판단이 달라진다');
{
  // 같은 상태, 같은 후보 4개를 두 가지 목표로 물어본다.
  // 안전 목표(의지력/포인트 5/5)와 고점 목표(네 수치 전부 5) 는 서로 다른 답을 내야 한다.
  const safe = solver.solveFull(solver.thresholdTarget({ will: 5, point: 5 }), 9);
  const greedy = solver.solveFull(solver.thresholdTarget({ will: 5, point: 5, opt1: 5, opt2: 5 }), 9);

  // 의지력 5, 포인트 4, 나머지는 1. 가공 4회, 리롤 2회 남음.
  const s = { will: 5, point: 4, opt1: 1, opt2: 1, n: 4, cost: 0, r: 2 };
  // 뜬 4개 중 쓸모있는 건 point+1 하나뿐이다.
  // 안전 목표에는 그거 하나면 끝나지만(5/5 완성 후 가공 완료), 고점 목표는
  // opt1/opt2 를 4회 안에 1 -> 5 로 올려야 해서 이 판 자체가 거의 버리는 판이다.
  const ids = ['point+1', 'cost:+1', 'cost:-1', 'keep'];

  const a = safe.decide(s, ids);
  const b = greedy.decide(s, ids);
  console.log(`  안전(5/5)  굴리기 ${pct(a.commit)}  리롤 ${pct(a.reroll)}  -> ${a.action}`);
  console.log(`  고점(5555) 굴리기 ${pct(b.commit)}  리롤 ${pct(b.reroll)}  -> ${b.action}`);

  check('안전 목표는 굴린다', a.action === 'commit', a.action);
  check('고점 목표는 리롤한다', b.action === 'reroll', b.action);
  check('같은 후보인데 판단이 갈린다', a.action !== b.action);

  // 목표가 어려울수록 달성 확률은 낮아야 한다.
  check('고점 목표가 더 어렵다',
    greedy.value(s) < safe.value(s),
    pct(greedy.value(s)) + ' < ' + pct(safe.value(s)));

  // decide 의 굴리기 값은 정의상 4개 값의 평균이고, 리롤 값은 r 이 하나 적은 같은 상태.
  check('굴리기 값이 0..1', a.commit >= 0 && a.commit <= 1);
  check('리롤 값 = V(s, r-1)',
    Math.abs(a.reroll - safe.V[s.n][s.r - 1][solver.stateKey(s)]) < 1e-12);

  const noR = safe.decide({ ...s, r: 0 }, ids);
  check('리롤 0 이면 무조건 굴리기', noR.action === 'commit' && noR.reroll === null && noR.gain === 0);
}

console.log();
console.log(`${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
