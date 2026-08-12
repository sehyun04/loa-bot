/*
 * 다이아(젬 현재 수치) 템플릿·배경판 생성 + 정확도 측정.
 *
 *   node web/gempago/vision/make-diamond-templates.js          측정만 (leave-one-out)
 *   node web/gempago/vision/make-diamond-templates.js --write  templates/ 와 manifest.json 갱신
 *
 * 왜 스크립트로 남기나: 캡처가 늘어날 때마다 템플릿을 다시 떠야 하는데, 손으로 뜨면
 * 잘리는 위치가 그때그때 달라져서 (README "숫자 템플릿은 덩어리 순번으로" 절) 재현이 안 된다.
 * 정확도 측정은 leave-one-out 이다 - 같은 캡처에서 뜬 템플릿은 빼고 맞춰야
 * 실전(처음 보는 화면)과 같은 조건이 된다.
 */
const path = require('path');
const fs = require('fs');
const png = require('./png.js');
const layout = require('./layout.js');
const reader = require('./reader.js');
const atlasMod = require('./atlas.js');

const here = (...p) => path.join(__dirname, ...p);
const WRITE = process.argv.includes('--write');

const atlas = atlasMod.load();
const gt = JSON.parse(fs.readFileSync(here('fixtures', 'captures.json'), 'utf8'));

/* ---- 1. 캡처를 기준 배율로 정렬하고 띠를 잘라둔다 ---- */

const caps = [];
for (const cap of gt.captures) {
  if (!cap.gemState) continue;
  const img = png.loadGray(here('fixtures', cap.file));
  const origin = layout.locate(img, atlas.anchor, { scale: cap.scale });
  if (!origin) { console.error('앵커 실패: ' + cap.file); process.exit(1); }
  caps.push({ file: cap.file, gem: cap.gem, scale: cap.scale, gemState: cap.gemState, origin, dia: layout.diamonds(origin) });
}
console.log(`캡처 ${caps.length}장 정렬 완료`);

/* ---- 2. 값 띠의 배경판 ----
 *
 * 배경판은 (젬 종류 x 배율) 조합마다 따로 만든다. 다이아 아트가 이 두 축에 따라
 * 픽셀 수준에서 달라서, 전체를 한 판으로 뭉치면 잔차 노이즈가 0.3+ 로 올라가
 * 대각선 장식이 글자만큼 밝게 남는다. 같은 조합끼리는 0.02~0.11 로 깨끗하다(실측).
 *
 * 한 조합 안에서도 중앙값은 안 된다 (README 에 그렇게 적어 뒀지만 15장 기준이었다):
 * 아래 다이아는 절반이 숫자 "1" 이라 같은 자리에 반복되는 획이 중앙값에 박힌다.
 * 그래서 2단계로 잡는다:
 *   1) 픽셀별 하위 20% 분위수로 초벌 배경 (글자는 밝은 쪽 꼬리라 여기 안 들어온다)
 *   2) 초벌 잔차가 큰 표본(그 캡처에서 그 픽셀이 글자)을 빼고 평균을 다시 낸다
 * 분위수만 쓰면 배경이 노이즈 하한으로 치우치는데, 2단계 평균이 그 치우침을 없앤다.
 *
 * "Lv." 처럼 조합 내 모든 캡처에서 같은 자리에 있는 글자는 배경판에 흡수된다.
 * 상관없다 - 잔차에서 사라질 뿐이고, 숫자는 캡처마다 달라서 살아남는다. */

const POSITIONS = ['top', 'left', 'right', 'bottom'];
const gemType = (c) => (c.gemState ? (c.gem || '').split(' ')[0] : '');
const groupKey = (c) => `${gemType(c)}-x${c.scale}`;

function buildBg(group, pos) {
  const bands = group.map((c) => reader.zBand(c.origin.image, c.dia[pos].value));
  const { w, h } = group[0].dia[pos].value;
  const data = new Float32Array(w * h);
  const col = new Float32Array(bands.length);
  for (let i = 0; i < data.length; i++) {
    for (let b = 0; b < bands.length; b++) col[b] = bands[b].data[i];
    col.sort();
    const rough = col[Math.floor(0.2 * (bands.length - 1))];
    let sum = 0, n = 0;
    for (let b = 0; b < bands.length; b++) {
      if (col[b] - rough < 1.0) { sum += col[b]; n++; }
    }
    data[i] = n ? sum / n : rough;
  }
  return { width: w, height: h, data };
}

const groups = {};
for (const c of caps) (groups[groupKey(c)] || (groups[groupKey(c)] = [])).push(c);
console.log('배경판 조합:', Object.keys(groups).map((k) => `${k}(${groups[k].length})`).join(' '));

/*
 * 조합의 모든 캡처가 같은 숫자를 두면(혼돈-x0.98 은 3장 전부 아래가 "4") 그 숫자가
 * 배경판에 흡수되고, 잔차에는 획 조각만 남아 다른 숫자로 읽힌다. 초벌 배경판으로 글자
 * 열을 찾아 표본에서 빼는 것도 만들어 봤지만, 흡수가 실제로 생기는 균일 조합은 어차피
 * 뺄 표본이 없고("Lv." 처럼 전부 글자), 숫자가 섞인 조합은 2단계 추정만으로 이미
 * 깨끗해서 leave-one-out 정확도가 오히려 2개 떨어졌다(103 vs 105). 그래서 안 쓴다.
 * 균일 조합은 실행 시 폴백(다른 조합 판)에 맡긴다 - 점수가 낮아 의심으로 표시된다.
 */

/** pos -> 조합별 배경판 배열. excludeFile 을 빼고 만든다 (leave-one-out 용). */
function buildDiaBg(excludeFile) {
  const out = {};
  for (const pos of POSITIONS) {
    out[pos] = [];
    for (const key of Object.keys(groups)) {
      const members = groups[key].filter((c) => c.file !== excludeFile);
      if (members.length < 2) continue;
      const bg = buildBg(members, pos);
      bg.group = key;
      out[pos].push(bg);
    }
  }
  return out;
}

const diaBg = buildDiaBg(null);

/* ---- 3. 템플릿 후보 뜨기 ---- */

// 이름: 띠보다 좌우 8px 좁게. 미끄러질 자리를 안 주면 마진이 음수가 된다 (README).
const LABEL_INSET = 8;

function crop(img, x, y, w, h) {
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) data[j * w + i] = img.data[(y + j) * img.width + (x + i)];
  }
  return { width: w, height: h, data };
}

const labelPool = {}; // key -> [{img, src, scale}]
const digitPool = {}; // '1'..'5' -> [{img, src, scale}]
const labelKeyByText = {};
for (const item of atlas.manifest.items) {
  if (item.group === 'label') labelKeyByText[item.text] = item.key;
}

for (const c of caps) {
  for (const pos of POSITIONS) {
    const g = c.gemState[pos];

    const lb = c.dia[pos].label;
    const key = labelKeyByText[g.label];
    if (!key) { console.error(`옵션 행에 없는 이름: ${g.label} (${c.file})`); process.exit(1); }
    (labelPool[key] || (labelPool[key] = [])).push({
      img: crop(c.origin.image, lb.x + LABEL_INSET, lb.y, lb.w - LABEL_INSET * 2, lb.h),
      text: g.label, src: c.file, scale: c.scale, pos,
    });

    // 숫자: 잔차의 마지막 덩어리를 상하좌우 딱 맞게 자른다 (+2px 여유).
    // 잔차는 실행 시와 같은 규칙으로 고른다 (조용한 판부터, 글자가 나오는 첫 판).
    // 자기 조합 판이 숫자를 흡수한 경우(조합 전체가 같은 숫자) 실행 시에도 다른 판으로
    // 넘어가므로, 템플릿도 그 판의 잔차에서 떠야 도메인이 맞는다.
    let res = null, spans = null;
    for (const cand of reader.bestResidual(reader.zBand(c.origin.image, c.dia[pos].value), diaBg[pos])) {
      const s = reader.residualSpans(cand.res, 5);
      if (s.length) { res = cand.res; spans = s; break; }
    }
    if (!spans) { console.error(`잔차에 글자가 없다: ${c.file} ${pos}`); continue; }
    const [x0, x1] = spans[spans.length - 1];

    let peak = 0;
    const rows = new Float32Array(res.height);
    for (let y = 0; y < res.height; y++) {
      let m = 0;
      for (let x = x0; x < x1; x++) m = Math.max(m, res.data[y * res.width + x]);
      rows[y] = m;
      peak = Math.max(peak, m);
    }
    let y0 = 0, y1 = res.height;
    while (y0 < res.height && rows[y0] <= peak * 0.35) y0++;
    while (y1 > y0 && rows[y1 - 1] <= peak * 0.35) y1--;

    const pad = 2;
    const cx0 = Math.max(0, x0 - pad), cx1 = Math.min(res.width, x1 + pad);
    const cy0 = Math.max(0, y0 - pad), cy1 = Math.min(res.height, y1 + pad);
    // 네 자리의 숫자 폰트 크기가 전부 조금씩 달라서 자리마다 따로 모은다.
    const digit = `${pos}:${g.value}`;
    (digitPool[digit] || (digitPool[digit] = [])).push({
      img: crop(res, cx0, cy0, cx1 - cx0, cy1 - cy0),
      text: String(g.value), src: c.file, scale: c.scale, pos,
    });
  }
}

/* ---- 4. 변형 선택: 같은 문자열이라도 출처(배율)별로 둔다 ----
 * 리샘플 캡처에서는 같은 출처 템플릿이 무조건 이긴다 (README 4번 항목).
 * 배율당 2개면 leave-one-out 에서도 같은 배율의 다른 출처가 남는다. */

function select(pool, perScale) {
  const out = {};
  for (const key of Object.keys(pool)) {
    const byScale = {};
    for (const v of pool[key]) (byScale[v.scale] || (byScale[v.scale] = [])).push(v);
    out[key] = [];
    for (const s of Object.keys(byScale)) {
      // 같은 배율 안에서는 출처 파일이 겹치지 않게 고른다.
      const seen = new Set();
      for (const v of byScale[s]) {
        if (out[key].filter((x) => x.scale === v.scale).length >= perScale) break;
        if (seen.has(v.src)) continue;
        seen.add(v.src);
        out[key].push(v);
      }
    }
  }
  return out;
}

const labelSel = select(labelPool, 3);
const digitSel = select(digitPool, 4);

/* ---- 5. leave-one-out 측정 ---- */

function atlasFor(excludeFile) {
  const mem = {
    'dia-label': {}, 'dia-digit': {}, diaBg: buildDiaBg(excludeFile),
    text: { 'dia-label': {} },
  };
  for (const key of Object.keys(labelSel)) {
    const vs = labelSel[key].filter((v) => v.src !== excludeFile);
    if (vs.length) {
      mem['dia-label'][key] = vs.map((v) => v.img);
      mem.text['dia-label'][key] = vs[0].text;
    }
  }
  for (const d of Object.keys(digitSel)) {
    const vs = digitSel[d].filter((v) => v.src !== excludeFile);
    if (vs.length) mem['dia-digit'][d] = vs.map((v) => v.img);
  }
  return mem;
}

let labelOk = 0, valueOk = 0, total = 0, flagged = 0;
const wrongs = [];
const worst = { label: { score: 1, margin: 1 }, value: { score: 1, margin: 1 } };

for (const c of caps) {
  const mem = atlasFor(c.file);
  const r = reader.readDiamonds(null, mem, { origin: c.origin });
  for (const pos of POSITIONS) {
    total++;
    const got = r.gem[pos];
    const want = c.gemState[pos];
    if (got.labelText === want.label) {
      labelOk++;
      worst.label.score = Math.min(worst.label.score, got.scores.label);
      worst.label.margin = Math.min(worst.label.margin, got.scores.labelMargin);
    } else wrongs.push(`${c.file} ${pos} 이름 ${got.labelText} != ${want.label} (${got.scores.label.toFixed(3)})`);
    if (got.value === want.value) {
      valueOk++;
      worst.value.score = Math.min(worst.value.score, got.scores.value);
      worst.value.margin = Math.min(worst.value.margin, got.scores.valueMargin);
    } else wrongs.push(`${c.file} ${pos} 값 ${got.value} != ${want.value} (${got.scores.value.toFixed(3)} 마진 ${got.scores.valueMargin.toFixed(3)})`);
    if (!got.confident) flagged++;
  }
}

console.log(`\nleave-one-out: 이름 ${labelOk}/${total} · 값 ${valueOk}/${total} · 의심 ${flagged}`);
console.log(`정답 최저점: 이름 ${worst.label.score.toFixed(3)} (마진 ${worst.label.margin.toFixed(3)})`
  + ` · 값 ${worst.value.score.toFixed(3)} (마진 ${worst.value.margin.toFixed(3)})`);
for (const w of wrongs) console.log('  ' + w);

/* ---- 6. 쓰기 ---- */

if (WRITE) {
  const dir = here('templates');
  const items = [];

  const encode = (img) => {
    let min = Infinity, max = -Infinity;
    for (const v of img.data) { min = Math.min(min, v); max = Math.max(max, v); }
    const span = max - min || 1;
    const data = new Float32Array(img.data.length);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(((img.data[i] - min) / span) * 255);
    return { png: png.encodeGray({ width: img.width, height: img.height, data }), range: [min, max] };
  };

  for (const pos of POSITIONS) {
    diaBg[pos].forEach((bg, i) => {
      const file = `dia-bg-${pos}-${i + 1}.png`;
      const e = encode(bg);
      fs.writeFileSync(path.join(dir, file), e.png);
      items.push({
        file, group: 'dia-bg', key: pos,
        range: [Number(e.range[0].toFixed(4)), Number(e.range[1].toFixed(4))],
        src: `${bg.group} ${groups[bg.group].length}장 z 정규화 배경판`,
      });
    });
  }

  for (const key of Object.keys(labelSel)) {
    labelSel[key].forEach((v, i) => {
      const file = `dia-label-${key}-${i + 1}.png`;
      // 이름 템플릿은 화면 그대로라 범위 변환이 필요 없다.
      const data = new Float32Array(v.img.data.length);
      for (let j = 0; j < data.length; j++) data[j] = Math.round(Math.min(255, Math.max(0, v.img.data[j])));
      fs.writeFileSync(path.join(dir, file), png.encodeGray({ width: v.img.width, height: v.img.height, data }));
      items.push({ file, group: 'dia-label', key, text: v.text, src: `${v.src} ${v.pos}` });
    });
  }

  for (const d of Object.keys(digitSel)) {
    digitSel[d].forEach((v, i) => {
      // 키의 ':' 는 Windows 파일명에 못 쓴다 (NTFS 대체 스트림으로 잘린다).
      const file = `dia-digit-${d.replace(':', '-')}-${i + 1}.png`;
      // 잔차는 실수라 0..255 로 펴서 저장한다. NCC 는 어파인 변환에 불변이라 복원이 필요 없다.
      const e = encode(v.img);
      fs.writeFileSync(path.join(dir, file), e.png);
      items.push({ file, group: 'dia-digit', key: d, text: d, src: `${v.src} ${v.pos}` });
    });
  }

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const kept = manifest.items.filter((i) => !String(i.group).startsWith('dia-'));
  const removed = manifest.items.length - kept.length;
  manifest.items = kept.concat(items);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\n템플릿 ${items.length}개 기록 (기존 dia-* ${removed}개 교체), manifest 갱신`);
}
