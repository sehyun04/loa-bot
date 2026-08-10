/*
 * 회귀 테스트. 실제 게임 재캡처 없이 파서 변경을 검증한다.
 *
 *   node web/gempago-poc/test-fixtures/run-tests.js
 *
 * captures.json 의 rawText 는 실제 화면에서 나온 OCR 원문이다.
 * 파서를 고칠 때마다 이걸 돌려서 예전에 고친 게 다시 깨지지 않았는지 본다.
 */

const path = require('path');
const fs = require('fs');

const P = require(path.join(__dirname, '..', 'app.js'));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'captures.json'), 'utf8'));

let pass = 0;
let fail = 0;
const failures = [];

function ok(name) { pass++; console.log('  ok   ' + name); }
function bad(name, detail) {
  fail++;
  failures.push(name);
  console.log('  FAIL ' + name);
  if (detail) console.log('       ' + detail);
}

function optMatches(opt, want) {
  for (const k of Object.keys(want)) {
    if (k === 'label') {
      // 라벨은 공백 차이를 무시하고 비교한다.
      const a = String(opt.label || '').replace(/\s/g, '');
      const b = String(want.label).replace(/\s/g, '');
      if (a !== b) return false;
    } else if (opt[k] !== want[k]) {
      return false;
    }
  }
  return true;
}

for (const cap of FIX.captures) {
  console.log(`\n=== ${cap.id} ===`);
  console.log(`  (${cap.note})`);

  // rawText 는 평문 경로, lines 는 열 재구성 이후의 줄 단위 경로로 검사한다.
  let parsed;
  if (cap.lines) {
    const norm = [];
    for (const l of cap.lines) {
      const n = P.normalizeOcrText(l);
      if (n) norm.push.apply(norm, n.split('\n'));
    }
    parsed = P.parseLinesArray(norm);
  } else {
    parsed = P.parseGemTooltip(cap.rawText);
  }
  const e = cap.expect || {};

  const allLabels = parsed.options.map((o) => o.label || '').join(' | ');
  console.log(`  options(${parsed.options.length}): ${parsed.options.map((o) => o.text).join(' / ') || '(없음)'}`);
  if (parsed.suspect && parsed.suspect.length) {
    console.log(`  suspect(${parsed.suspect.length}): ${parsed.suspect.map((o) => o.text).join(' / ')}`);
  }

  if (typeof e.minOptions === 'number') {
    if (parsed.options.length >= e.minOptions) ok(`${cap.id}: 옵션 ${e.minOptions}개 이상`);
    else bad(`${cap.id}: 옵션 ${e.minOptions}개 이상`, `실제 ${parsed.options.length}개`);
  }

  if (typeof e.maxOptions === 'number') {
    if (parsed.options.length <= e.maxOptions) ok(`${cap.id}: 옵션 ${e.maxOptions}개 이하 (가짜 옵션 없음)`);
    else bad(`${cap.id}: 옵션 ${e.maxOptions}개 이하`, `실제 ${parsed.options.length}개 -> ${allLabels}`);
  }

  for (const want of (e.options || [])) {
    const hit = parsed.options.find((o) => optMatches(o, want));
    if (hit) ok(`${cap.id}: ${JSON.stringify(want)}`);
    else bad(`${cap.id}: ${JSON.stringify(want)}`, `못 찾음. 실제: ${allLabels}`);
  }

  for (const frag of (e.forbid || [])) {
    const hit = parsed.options.find((o) => String(o.label || '').includes(frag));
    if (!hit) ok(`${cap.id}: "${frag}" 옵션으로 안 잡힘`);
    else bad(`${cap.id}: "${frag}" 옵션으로 안 잡힘`, `잡힘: ${hit.text}`);
  }

  for (const frag of (e.unmatched || [])) {
    const hit = (parsed.unmatched || []).some((l) => l.includes(frag));
    if (hit) ok(`${cap.id}: "${frag}" 줄은 미매칭으로 남음`);
    else bad(`${cap.id}: "${frag}" 줄은 미매칭으로 남음`, `미매칭: ${JSON.stringify(parsed.unmatched)}`);
  }

  if (e.type !== undefined) {
    if (parsed.type === e.type) ok(`${cap.id}: 계열 ${e.type}`);
    else bad(`${cap.id}: 계열 ${e.type}`, `실제 ${parsed.type}`);
  }

  if (e.gemLevel !== undefined) {
    if (parsed.gemLevel === e.gemLevel) ok(`${cap.id}: 젬 레벨 ${e.gemLevel}`);
    else bad(`${cap.id}: 젬 레벨 ${e.gemLevel}`, `실제 ${parsed.gemLevel}`);
  }

  for (const nope of (e.gemLevelNot || [])) {
    if (parsed.gemLevel !== nope) ok(`${cap.id}: 젬 레벨이 ${nope} 아님`);
    else bad(`${cap.id}: 젬 레벨이 ${nope} 아님`, `실제 ${parsed.gemLevel}`);
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log(`결과: ${pass} pass / ${fail} fail`);
if (fail) {
  console.log('실패 목록:');
  failures.forEach((f) => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
