/*
 * vision 회귀 테스트.  node web/gempago/vision/test.js
 *
 * 지금 검증하는 건 두 가지다.
 * 1. NCC 구현이 맞는가 (자기 자신과 1.0, 반전과 -1, 균일면에서 무응답)
 * 2. 템플릿이 UI 컨텍스트에 종속된다는 한계가 그대로인가
 *    - 이건 고쳐야 할 버그가 아니라 설계 제약이다. 수치가 흔들리면 알아야 해서 박아둔다.
 */
const path = require('path');
const png = require('./png.js');
const ncc = require('./ncc.js');
const layout = require('./layout.js');
const reader = require('./reader.js');

let pass = 0, fail = 0;

function check(name, ok, detail) {
  if (ok) { pass++; console.log('  pass  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

function near(name, got, want, tol) {
  check(name + ' = ' + got.toFixed(4), Math.abs(got - want) <= tol, 'want ' + want + ' +-' + tol);
}

const here = (...p) => path.join(__dirname, ...p);

console.log('NCC 기본 성질');
{
  const img = { width: 6, height: 4, data: new Float32Array([
    10, 20, 30, 40, 50, 60,
    11, 21, 31, 41, 51, 61,
    12, 22, 32, 42, 52, 62,
    13, 23, 33, 43, 53, 63,
  ]) };

  const self = ncc.best(img, img);
  near('자기 자신과의 상관', self.score, 1, 1e-9);
  check('자기 자신은 (0,0)', self.x === 0 && self.y === 0);

  // 밝기/대비를 바꿔도 모양이 같으면 1 이어야 한다. NCC 를 쓰는 이유 자체.
  const scaled = { width: 6, height: 4, data: img.data.map((v) => v * 3 + 77) };
  near('밝기/대비 불변', ncc.best(scaled, img).score, 1, 1e-9);

  // 부호가 뒤집힌 패턴은 -1. 그래야 "닮지 않음"을 구분할 수 있다.
  const inverted = { width: 6, height: 4, data: img.data.map((v) => -v) };
  near('반전 패턴', ncc.best(inverted, img).score, -1, 1e-9);

  // 단색 배경은 분산이 0 이라 상관이 정의되지 않는다. 점수를 지어내면 안 된다.
  const flat = { width: 6, height: 4, data: new Float32Array(24).fill(128) };
  check('균일면은 후보 없음', ncc.matchTemplate(flat, img).length === 0);
}

console.log('NCC 위치 찾기');
{
  const tpl = { width: 2, height: 2, data: new Float32Array([0, 255, 255, 0]) };
  const img = { width: 8, height: 5, data: new Float32Array(40).fill(30) };
  const put = (x, y) => {
    img.data[y * 8 + x] = 0;       img.data[y * 8 + x + 1] = 255;
    img.data[(y + 1) * 8 + x] = 255; img.data[(y + 1) * 8 + x + 1] = 0;
  };
  put(5, 3);
  const b = ncc.best(img, tpl);
  near('심어둔 패턴 점수', b.score, 1, 1e-9);
  check('심어둔 위치 (5,3)', b.x === 5 && b.y === 3, `got ${b.x},${b.y}`);

  // band 를 주면 그 밖은 안 본다. 화면에서 행 단위로 자를 때 쓴다.
  const inBand = ncc.best(img, tpl, { x: 0, y: 0, w: 4, h: 3 });
  check('band 밖은 무시', !inBand || inBand.score < 0.99, inBand && String(inBand.score));
}

console.log('classify 는 2등과의 격차를 돌려준다');
{
  const a = { width: 3, height: 3, data: Float32Array.from([0, 255, 0, 255, 0, 255, 0, 255, 0]) };
  const b = { width: 3, height: 3, data: Float32Array.from([255, 255, 255, 0, 0, 0, 255, 255, 255]) };
  const r = ncc.classify(a, { a, b });
  check('정답 라벨 a', r.label === 'a', r.label);
  check('2등 기록됨', r.runnerUp === 'b', String(r.runnerUp));
  check('margin > 0', r.margin > 0, String(r.margin));
}

console.log('실제 캡처: 템플릿은 UI 컨텍스트에 종속된다');
{
  const tplLv = png.loadGray(here('fixtures', 'tpl_lv.png'));
  const row = png.loadGray(here('fixtures', 'cmp_row.png'));
  const diamond = png.loadGray(here('fixtures', 'cmp_diamond.png'));

  const onRow = ncc.best(row, tplLv);
  const onDiamond = ncc.best(diamond, tplLv);

  near('같은 배경(선택지 행)', onRow.score, 1.0, 0.001);
  near('다른 배경(다이아)', onDiamond.score, 0.44, 0.03);
  check(
    '두 배경의 격차가 0.5 이상',
    onRow.score - onDiamond.score > 0.5,
    (onRow.score - onDiamond.score).toFixed(4)
  );
}

console.log('PNG 디코더');
{
  const src = png.loadGray(here('fixtures', 'tpl_lv.png'));
  const round = png.toGray(png.decode(png.encodeGray(src)));
  check('encode -> decode 크기 유지', round.width === src.width && round.height === src.height);
  let maxDiff = 0;
  for (let i = 0; i < src.data.length; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(round.data[i] - src.data[i]));
  }
  // 그레이 -> RGB 로 다시 쓰면서 반올림하므로 1 이내 오차는 정상.
  check('픽셀 오차 <= 1 (max ' + maxDiff.toFixed(2) + ')', maxDiff <= 1);
}

const atlas = require('./atlas.js').load();
const groundTruth = JSON.parse(
  require('fs').readFileSync(here('fixtures', 'captures.json'), 'utf8')
);

console.log('템플릿끼리 서로 구분되는가 (이게 안 되면 나머지는 의미 없다)');
{
  // 한 문자열에 변형이 여러 개다. 대표로 첫 번째끼리 비교한다.
  const one = (g, k) => atlas[g][k][0];

  const agun = one('label', 'agun-pihae'), hondon = one('label', 'hondon-point');
  const [wide, narrow] = agun.width >= hondon.width ? [agun, hondon] : [hondon, agun];
  check('다른 옵션명끼리 0.3 미만 (' + ncc.best(wide, narrow).score.toFixed(3) + ')',
    ncc.best(wide, narrow).score < 0.3);

  // 숫자는 8px 창 덕분에 갈린다. 창 없이 값 전체를 비교하면 0.9 가 나와서 못 쓴다.
  const digits = ['1', '2', '3', '4'];
  let worst = { score: -1 };
  for (const a of digits) {
    for (const b of digits) {
      if (a === b) continue;
      const s = ncc.best(one('digit', a), one('digit', b)).score;
      if (s > worst.score) worst = { score: s, pair: a + ' vs ' + b };
    }
  }
  check(`서로 다른 숫자끼리 0.6 미만 (최악 ${worst.pair} = ${worst.score.toFixed(3)})`,
    worst.score < 0.6);
  check('숫자 템플릿 폭이 ' + reader.DIGIT_WINDOW + 'px',
    digits.every((d) => atlas.digit[d].every((t) => t.width === reader.DIGIT_WINDOW)));

  check('접두 Lv. vs + 가 0.7 미만',
    ncc.best(one('prefix', 'lv'), one('prefix', 'plus')).score < 0.7);
}

console.log(`실제 캡처 ${groundTruth.captures.length}장을 끝까지 읽는다`);
{
  let correct = 0, total = 0, flagged = 0;
  const t0 = Date.now();

  for (const cap of groundTruth.captures) {
    const img = png.loadGray(here('fixtures', cap.file));
    // 배율 탐색은 따로 검증한다. 여기서는 정답표의 배율을 알려주고 읽기만 본다.
    const r = reader.readOptions(img, atlas, { scale: cap.scale });
    if (!r.ok) { check(cap.file + ' 화면 인식', false, r.reason); total += 4; continue; }

    const wrong = [];
    cap.options.forEach((want, i) => {
      const o = r.options[i];
      total++;
      if (o.labelText === want.label && o.value && o.value.text === want.value) correct++;
      else wrong.push(`열${i + 1} ${o.labelText}/${o.value && o.value.text} != ${want.label}/${want.value}`);
      if (!o.confident) flagged++;
    });
    check(cap.file + ' 4개 모두 정답', wrong.length === 0, wrong.join(', '));
  }

  check(`옵션 ${total}개 전부 정답 (${correct}/${total})`, correct === total);
  // 의심 표시는 틀렸다는 뜻이 아니라 "사람이 확인하라"는 뜻이다. 지금 걸리는 건
  // "아군 피해 강화" 와 "아군 공격 강화" 처럼 한 글자만 다른 옵션명들이다(마진 0.10).
  check(`의심 표시가 ${total} 개 중 6개 이하 (${flagged}개)`, flagged <= 6);
  console.log(`  (${groundTruth.captures.length}장 ${Date.now() - t0}ms)`);
}

console.log('배율이 달라도 찾는다');
{
  const original = png.loadGray(here('fixtures', 'cap-roaring1.png'));
  const one = ncc.findScale(original, atlas.anchor, { min: 0.9, max: 1.1 });
  check('기준 캡처의 배율은 1.0 (' + one.scale + ')', one.scale === 1 && one.score > 0.99);

  // 2048x1280 원본을 2000x1250 으로 리샘플한 캡처. NCC 는 배율에 관대하지 않아서
  // 이 2.3% 차이만으로 앵커 점수가 0.56 까지 떨어진다.
  const resampled = png.loadGray(here('fixtures', 'cap17.png'));
  const r = ncc.findScale(resampled, atlas.anchor, { min: 0.9, max: 1.1 });
  check('리샘플 캡처의 배율을 0.98 로 잡는다 (' + r.scale + ')', Math.abs(r.scale - 0.98) < 0.015);
  check('배율을 맞추면 앵커 점수가 0.85 이상 (' + r.score.toFixed(3) + ')', r.score > 0.85);

  // 이쪽이 진짜다. 게임이 1920x1080 으로 직접 렌더한 화면이라 글자 래스터 자체가 다르다.
  // 1920/2048 = 0.9375 이고 실제로 그 근처를 찾아낸다.
  const native = png.loadGray(here('fixtures', 'cap26.png'));
  const n = ncc.findScale(native, atlas.anchor, { min: 0.85, max: 1.05 });
  check('1920x1080 화면의 배율을 0.94 근처로 잡는다 (' + n.scale + ')',
    Math.abs(n.scale - 0.9375) < 0.02, String(n.scale));
  check('해상도가 달라도 앵커를 찾는다 (' + n.score.toFixed(3) + ')', n.score > 0.7);
}

console.log('앵커가 없으면 못 찾았다고 말한다');
{
  // 가공 화면이 아닌 것: 옵션 행만 잘라낸 이미지에는 앵커 문장이 없다.
  const notGem = png.loadGray(here('fixtures', 'cmp_row.png'));
  const r = reader.readOptions(notGem, atlas, { scale: 1 });
  check('엉뚱한 이미지는 거부한다', !r.ok, JSON.stringify(r.options && r.options[0]));
}

console.log('읽은 글자 -> 확률 표 항목 id');
{
  const interpret = require('./interpret.js');
  const rules = require('../rules.js');

  // 실제 캡처에 나온 젬. 1번/2번 효과 이름은 젬마다 다르므로 밖에서 알려줘야 한다.
  const slots = { opt1: '공격력', opt2: '아군 피해 강화', point: '혼돈 포인트' };

  // 27개 항목 전부: 화면 표기로 바꿨다가 다시 id 로 돌아오는지.
  // 캡처가 없어도 이 왕복은 완전히 검증된다.
  let round = 0;
  const broken = [];
  for (const o of rules.OUTCOMES) {
    const screen = interpret.toScreenText(o, slots);
    const back = interpret.toOutcomeId(screen, slots);
    if (back.ok && back.id === o.id) round++;
    else broken.push(o.id + ' -> ' + (back.id || back.reason));
  }
  check(`27개 항목 왕복 (${round}/${rules.OUTCOMES.length})`, round === rules.OUTCOMES.length,
    broken.slice(0, 3).join(' | '));

  // 실제 캡처에서 읽은 그대로.
  const real = { labelText: '아군 피해 강화', value: { prefix: 'lv', digit: '1', suffix: '증가' } };
  const r = interpret.toOutcomeId(real, slots);
  check('아군 피해 강화 Lv. 1 증가 -> opt2+1', r.ok && r.id === 'opt2+1', JSON.stringify(r));

  const pt = { labelText: '혼돈 포인트', value: { prefix: 'plus', digit: '2', suffix: '증가' } };
  check('혼돈 포인트 +2 증가 -> point+2',
    interpret.toOutcomeId(pt, slots).id === 'point+2');

  // 질서 젬도 같은 자리를 쓴다.
  check('질서 포인트도 point 로', interpret.resolveSlot('질서 포인트', slots) === 'point');

  // 모르는 효과 이름은 조용히 넘기면 안 된다.
  const unknown = interpret.toOutcomeId(
    { labelText: '보스 피해', value: { prefix: 'lv', digit: '1', suffix: '증가' } }, slots);
  check('모르는 효과 이름은 거부', !unknown.ok && /어느 수치인지/.test(unknown.reason), unknown.reason);

  // 표기와 슬롯이 어긋나면 슬롯을 잘못 잡은 것이다.
  const mismatch = interpret.toOutcomeId(
    { labelText: '의지력 효율', value: { prefix: 'lv', digit: '1', suffix: '증가' } }, slots);
  check('의지력인데 Lv. 표기면 거부', !mismatch.ok, JSON.stringify(mismatch));

  // 확률 표에 없는 조합(포인트 -2 같은 것)은 막아야 한다.
  const impossible = interpret.toOutcomeId(
    { labelText: '혼돈 포인트', value: { prefix: 'plus', digit: '2', suffix: '감소' } }, slots);
  check('확률 표에 없는 항목은 거부', !impossible.ok && /확률 표에 없는/.test(impossible.reason),
    impossible.reason);

  // 4개가 다 안 나오면 ids 를 주면 안 된다. 셋만 알고 판단할 수는 없다.
  const partial = interpret.toPicks([real, pt, real, { labelText: '???' }], slots);
  check('하나라도 실패하면 ids 는 null', partial.ids === null && partial.problems.length === 1);

  const full = interpret.toPicks([real, pt, real, pt], slots);
  check('4개 다 되면 ids 반환', full.ids && full.ids.length === 4, JSON.stringify(full.problems));
}

console.log('화면에서 읽어 솔버까지 (끝에서 끝까지)');
{
  const interpret = require('./interpret.js');
  const solver = require('../solver.js');
  const img = png.loadGray(here('fixtures', 'cap-roaring2.png'));

  const read = reader.readOptions(img, atlas, { scale: 1 });
  const slots = { opt1: '공격력', opt2: '아군 피해 강화', point: '혼돈 포인트' };
  const picks = interpret.toPicks(read.options, slots);

  check('캡처에서 4개 id 를 뽑았다', !!picks.ids, JSON.stringify(picks.problems));
  check('id 가 기대와 일치',
    JSON.stringify(picks.ids) === JSON.stringify(['opt2+1', 'point+2', 'point+1', 'opt2+2']),
    JSON.stringify(picks.ids));

  // 특수 항목이 섞인 캡처도 id 로 떨어져야 한다. cap19: 질서포인트+4 / 유지 / 효과변경 / 의지력+4
  const jilseo = png.loadGray(here('fixtures', 'cap19.png'));
  const r19 = reader.readOptions(jilseo, atlas, { scale: 0.98 });
  const p19 = interpret.toPicks(r19.options,
    { opt1: '보스 피해', opt2: '아군 공격 강화', point: '질서 포인트' });
  check('특수 항목 4개도 id 로 (' + JSON.stringify(p19.resolved) + ')',
    JSON.stringify(p19.resolved) === JSON.stringify(['point+4', 'keep', 'change:opt2', 'will+4']),
    JSON.stringify(p19.problems));

  // 그 4개를 그대로 솔버에 넣는다. 이게 되면 화면 -> 판단 경로가 뚫린 것이다.
  const sol = solver.solveFull(solver.thresholdTarget({ point: 5 }), 9);
  const state = { will: 1, point: 1, opt1: 1, opt2: 1, n: 9, cost: 0, r: 2 };
  const d = sol.decide(state, picks.ids);
  check('솔버가 판단을 냈다', d.action === 'commit' || d.action === 'reroll',
    JSON.stringify(d));
  console.log(`  굴리기 ${(d.commit * 100).toFixed(2)}% · 리롤 ${(d.reroll * 100).toFixed(2)}% -> ${d.action}`);
}

console.log();
console.log(`${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
