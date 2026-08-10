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

console.log('템플릿끼리 서로 구분되는가 (이게 안 되면 나머지는 의미 없다)');
{
  const atlas = require('./atlas.js').load();

  // 옵션명은 통째로 매칭해도 충분히 갈린다.
  const agun = atlas.label.agun, hondon = atlas.label.hondon;
  const [wide, narrow] = agun.width >= hondon.width ? [agun, hondon] : [hondon, agun];
  const cross = ncc.best(wide, narrow).score;
  check('다른 옵션명끼리 0.3 미만 (' + cross.toFixed(3) + ')', cross < 0.3);

  // 숫자는 8px 창 덕분에 갈린다. 창 없이 값 전체를 비교하면 0.9 가 나와서 못 쓴다.
  const d1 = atlas.digit['1'], d2 = atlas.digit['2'];
  const dCross = ncc.best(d1, d2).score;
  check('숫자 1 vs 2 가 0.4 미만 (' + dCross.toFixed(3) + ')', dCross < 0.4);
  check('숫자 템플릿 폭이 ' + reader.DIGIT_WINDOW + 'px', d1.width === reader.DIGIT_WINDOW);

  const lv = atlas.prefix.lv, plus = atlas.prefix.plus;
  check('접두 Lv. vs + 가 0.7 미만', ncc.best(lv, plus).score < 0.7, String(ncc.best(lv, plus).score));
}

console.log('실제 캡처를 끝까지 읽는다');
{
  const atlas = require('./atlas.js').load();
  const img = png.loadGray(here('fixtures', 'options-roaring2.png'));

  const t0 = Date.now();
  const r = reader.readOptions(img, atlas);
  const ms = Date.now() - t0;

  check('가공 화면을 찾았다', r.ok, r.reason);
  check('앵커 점수 > 0.99 (' + r.origin.score.toFixed(4) + ')', r.origin.score > 0.99);

  // 스크린샷에 실제로 보이는 4개. 눈으로 확인한 정답이다.
  const want = [
    ['아군 피해 강화', 'Lv. 1 증가'],
    ['혼돈 포인트', '+2 증가'],
    ['혼돈 포인트', '+1 증가'],
    ['아군 피해 강화', 'Lv. 2 증가'],
  ];
  want.forEach(([label, value], i) => {
    const o = r.options[i];
    check(`열${i + 1} ${label} / ${value}`,
      o.labelText === label && o.value && o.value.text === value,
      `${o.labelText} / ${o.value && o.value.text}`);
  });

  check('4개 모두 confident', r.options.every((o) => o.confident));
  const minMargin = Math.min(...r.options.map((o) => Math.min(o.labelMargin, o.value.scores.digitMargin)));
  check('최소 마진 > 0.5 (' + minMargin.toFixed(3) + ')', minMargin > 0.5);
  console.log('  (' + ms + 'ms)');
}

console.log('앵커가 없으면 못 찾았다고 말한다');
{
  const atlas = require('./atlas.js').load();
  // 가공 화면이 아닌 것: 옵션 행만 잘라낸 이미지에는 앵커 문장이 없다.
  const notGem = png.loadGray(here('fixtures', 'cmp_row.png'));
  const r = reader.readOptions(notGem, atlas);
  check('엉뚱한 이미지는 거부한다', !r.ok, JSON.stringify(r.options && r.options[0]));
}

console.log();
console.log(`${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
