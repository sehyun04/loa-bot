/*
 * 젬 툴팁 화면 인식 POC
 *
 * 흐름: getDisplayMedia 로 화면 캡처 -> 사용자가 지정한 사각형만 캔버스로 크롭
 *       -> 전처리(그레이스케일/대비/반전/이진화) -> Tesseract.js(kor) OCR
 *       -> 정규식 파서로 구조화
 *
 * 파서는 스탯 이름 화이트리스트를 쓰지 않는다. 로스트아크 젬 옵션 풀은 패치마다
 * 바뀌므로, 이름 대신 "Lv.n", "n 포인트", "n%", "줄 끝 숫자" 같은 형태만 보고 뽑는다.
 * 실제 게임 스크린샷으로 검증되지 않은 초안이므로 LINE_PATTERNS 는 튜닝 대상이다.
 */

/**
 * 화면 우상단과 콘솔에 그대로 찍히는 빌드 표시.
 * 이 POC 는 빌드 단계가 없어서 브라우저가 예전 app.js/style.css 를 계속 쓰는 일이
 * 실제로 두 번 있었고, 그때마다 "고쳤는데 화면은 그대로" 라 원인 파악이 한참 늦어졌다.
 * 파일을 고칠 때 이 값과 index.html 의 ?v= 를 같이 올리면, 화면 표시만 보고
 * 지금 브라우저가 어느 판을 돌리는지 바로 알 수 있다.
 */
const BUILD_ID = '2026-08-09.1';

/* =========================================================================
 * 1) 파서 (DOM 비의존 - Node 에서도 그대로 require 해서 테스트 가능)
 * ========================================================================= */

/** 파서 동작 확인용 샘플. 실제 게임 문구가 아니라 형태 예시일 뿐이다. */
const SAMPLE_TEXT = [
  '질서의 젬',
  'Lv.7',
  '아군 공격력 강화 Lv.3',
  '낙인력 강화 Lv.2',
  '포인트 8',
  '보스 피해 12.5%',
  '의지력 효율 : 5',
].join('\n');

/**
 * 젬 계열 판별에 쓰는 키워드. 이 둘은 계열 이름이라 패치 영향이 거의 없다.
 * "혼돈 포인트"는 젬 계열과 무관하게 항상 나오는 스탯 이름이라, 뒤에 "포인트"가
 * 붙으면 계열 표기가 아니라 스탯 줄이므로 제외한다 (실제 가공 화면에서 확인된 오탐).
 */
const GEM_TYPE_RE = /(질서|혼돈)(?!\s*포인트)/;

/**
 * OCR 언어.
 * 'kor' 단독으로는 "Lv." 같은 라틴 문자를 통째로 흘려버리는 것을 합성 이미지로 확인했다.
 * 'kor+eng' 를 써야 레벨 표기가 살아남는다. (학습 데이터를 두 벌 받으므로 첫 로딩은 더 느리다.)
 */
const OCR_LANGS = 'kor+eng';

/**
 * 줄 단위 매칭 규칙. 위에서부터 순서대로 시도하고 첫 매칭을 채택한다.
 * label = 옵션 이름, value = 수치, delta = 증감 표현.
 *
 * 실제 가공 화면을 보고 반영한 것:
 * - 게임은 "Lv. 1" 처럼 점 뒤에 공백을 넣는다. 그래서 Lv\. 뒤에 \s* 가 필요하다.
 * - 가공 화면의 값은 "Lv. 1 증가", "+3 증가" 처럼 증감 접미사가 붙는다.
 *   접미사를 못 받으면 값 줄이 전부 미매칭으로 빠지므로 필수다.
 */
// 값 뒤에 아이콘이 잡음 문자로 붙는 걸 실제 화면에서 확인했다. 상승 화살표(▲)가
// "A" 나 "초" 로 읽히는 식이다. 줄 끝을 \s*$ 로 딱 닫으면 이런 줄이 통째로 미매칭에
// 빠진다.
//
// 다만 여기를 너무 넓히면 반대쪽으로 무너진다. 한때 이 값이
// `[\sA-Za-z"'_().,:▲▼]{0,5}$` 였는데, 그 결과 "가공 완료 가공 하기 (9" 같은
// 장식/버튼 텍스트까지 옵션으로 잡혀서 가짜 항목이 쏟아졌다(실측).
// 실제로 관찰된 잡음은 "짧은 토큰 하나"뿐이라, 딱 그만큼만 허용한다.
const _TAIL = '(?:\\s{0,3}[A-Za-z가-힣"\'_().,:▲▼]{1,3})?\\s*$';

// 증감 접미사. 실제 화면에서 "증가"가 캡처마다 증카/중가/종카/증로 등으로 계속
// 다르게 깨진다 - 두 번째 글자를 하나씩 나열하는 건 끝이 없어서, 값 바로 뒤라는
// 위치로 이미 좁혀졌다는 전제 하에 두 번째 글자는 아무 한글이나 받는다.
//
// 값과 이 접미사 사이에도 아이콘이 마침표로 깨져 끼는 걸 확인했다("+2.증로" -
// 실제로는 "+2 증가"). _BRIDGE 와 같은 이유로 여기도 마침표/따옴표 하나는 건너뛴다.
const _DELTA = '(?:[.："\']\\s*)?(?<delta>증가|감소|[증중종][가-힣])?';

// 라벨과 값 사이의 다리. 콜론뿐 아니라 실측: 라벨 끝에 아이콘이 마침표/따옴표로
// 잘못 읽혀 붙는 경우가 있다("oxy 효율." + " +3 증가" - 실제로는 "의지력 효율").
// 마침표는 라벨의 종결 글자가 될 수 없어서(_LABEL 이 글자로 끝나야 함), 다리 쪽에서
// 안 받아주면 그 사이에 낀 문장부호 하나 때문에 줄 전체가 미매칭으로 빠진다.
// 여는 괄호"("는 일부러 안 넣는다 - "가공 하기 (" 같은 버튼 텍스트를 라벨로 잘못
// 삼키게 만든 원흉이었다(실측, 가짜 옵션 원인).
const _BRIDGE = '\\s*[:：."\']?\\s*';

// 라벨은 비어 있거나, 비어 있지 않다면 반드시 "글자"로 끝나야 한다.
// 예전엔 `.*?[^\s\d.,]` 라서 "가공 완료 가공 하기 (" 처럼 여는 괄호로 끝나는
// 쓰레기 라벨이 통과했다. 이게 가짜 옵션의 주요 통로였다.
//
// 앞쪽에는 아이콘이 깨져 나온 기호 쓰레기가 붙는다(실측: "｢)2 1회 증가").
// 글자로 시작하길 요구하면 이런 줄이 통째로 날아가므로, 글자가 아닌 문자
// 몇 개까지는 앞에서 버린다.
const _LABEL = '(?<junk>[^가-힣A-Za-z]{0,6}?)(?<label>(?:.*?[가-힣A-Za-z])?)';

// 레벨 패턴 전용. 라벨이 "Lv." 를 건너뛰어 삼키지 못하게 막는다.
// 이걸 안 걸면 "효율 강화 Lv.3 (최대 Lv.5)" 에서 앞쪽 Lv.3 매칭이 실패했을 때
// 라벨이 "효율 강화 Lv.3 (최대" 까지 늘어나 뒤쪽 Lv.5 를 값으로 잡아버린다.
const _LABEL_NOLV = '(?<junk>[^가-힣A-Za-z]{0,6}?)(?<label>(?:(?:(?!Lv\\.).)*?[가-힣A-Za-z])?)';

const LINE_PATTERNS = [
  // "아군 공격력 강화 Lv.3" / "Lv.7" / "공격력 Lv. 1 증가"
  { kind: 'level',   unit: 'Lv',    re: new RegExp(`^${_LABEL_NOLV}\\s*Lv\\.\\s*(?<value>\\d{1,3})\\s*${_DELTA}${_TAIL}`) },

  // "8 포인트" / "의지력 8포인트"
  { kind: 'point',   unit: '포인트', re: new RegExp(`^${_LABEL}\\s*(?<value>[+\\-]?\\d{1,4})\\s*포인트\\s*${_DELTA}${_TAIL}`) },
  // "포인트 8" / "혼돈 포인트 +3 증가"
  { kind: 'point',   unit: '포인트', re: new RegExp(`^(?<label>.*?포인트)${_BRIDGE}(?<value>[+\\-]?\\d{1,4})\\s*${_DELTA}${_TAIL}`) },

  // "보스 피해 12.5%" / "공격력 +3.5 %"
  { kind: 'percent', unit: '%',     re: new RegExp(`^${_LABEL}${_BRIDGE}(?<value>[+\\-]?\\d{1,4}(?:\\.\\d+)?)\\s*%\\s*${_DELTA}${_TAIL}`) },

  // "다른 항목 보기 1회 증가" - 가공 화면의 재굴림 옵션은 Lv/포인트/% 가 아니라 "n회"다.
  { kind: 'count',   unit: '회',    re: new RegExp(`^${_LABEL}${_BRIDGE}(?<value>[+\\-]?\\d{1,3})\\s*회\\s*${_DELTA}${_TAIL}`) },

  // 줄 끝이 아닌 곳에 Lv 가 있는 경우: "아군 공격력 강화 Lv.3 (최대 Lv.5)"
  { kind: 'level',   unit: 'Lv',    re: /^(?<label>.*?)\s*Lv\.\s*(?<value>\d{1,3})\b/ },

  // 마지막 폴백: 라벨 뒤에 숫자만 붙은 줄. "의지력 효율 : 5" / "의지력 효율 +1 증가"
  // 천 단위 쉼표 허용. 없으면 "소지 금액 261,267" 이 "소지 금액 261," + 267 로 잘린다.
  { kind: 'number',  unit: '',      re: new RegExp(`^${_LABEL}${_BRIDGE}(?<value>[+\\-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?)\\s*${_DELTA}${_TAIL}`) },
];

/**
 * 라벨의 "한글다움". 잡음에서 나온 가짜 옵션을 걸러내는 데 쓴다.
 *
 * 신뢰도(confidence)로 거르는 방법을 먼저 실측해봤는데 쓸 수 없었다. 장식 화살표가
 * "A"(신뢰도 87)로, 잘못 읽힌 "함"이 91로 나오는 반면 멀쩡한 "의"가 65로 나왔다.
 * 신뢰도는 잡음과 진짜 글자를 가르지 못한다. 대신 이 게임의 옵션 이름이 전부
 * 한글이라는 사실을 쓴다.
 */
const HANGUL_RE = /[가-힣]/g;
const LABEL_HANGUL_MIN = 0.6;

function labelQuality(label) {
  const s = String(label == null ? '' : label).replace(/\s/g, '');
  if (!s) return 1; // 라벨 없음은 품질 판단 대상이 아니다
  const hangul = (s.match(HANGUL_RE) || []).length;
  return hangul / s.length;
}

/**
 * 열(컬럼) 재구성 기본값. 모두 "글자 높이의 몇 배" 같은 상대값이라
 * 해상도/UI 배율이 달라도 그대로 쓸 수 있다.
 */
const LAYOUT_DEFAULTS = {
  rowGapRatio: 0.6,   // 세로 중심이 글자 높이의 이 배수 이상 벌어지면 다른 행
  cellGapRatio: 1.8,  // 가로 간격이 글자 높이의 이 배수 이상이면 다른 열(셀)
  // 셀 안에서 이 배수 이상 벌어져야 진짜 띄어쓰기로 본다.
  // 실측값: 글자 높이 30px 기준으로 글자끼리 붙은 간격 8~11, 진짜 띄어쓰기 16~22.
  // 이 값이 틀려도 라벨의 공백 모양만 달라질 뿐 수치 파싱에는 영향이 없다.
  wordGapRatio: 0.45,
  // 격자 분할용. 두 행 모두에서 비어 있는 구간만 열 경계로 인정하므로
  // 한 행만 볼 때(cellGapRatio)보다 훨씬 강한 근거다. 그래서 임계값도 낮게 잡는다.
  gridGapRatio: 0.9,
  alignRatio: 0.6,    // 위아래 셀이 같은 열인지 볼 때 중심 x 허용 오차(셀 너비 기준)
  // 3 이상. "가공 비용|900" / "소지 금액|262,326" 처럼 이미 한 행에 라벨+값이
  // 붙어 있는 2열짜리 줄들이 서로 다른 항목인데도 우연히 정렬이 맞아 잘못 짝지어지는
  // 걸 막는 1차 방어선이다 (실제 가공 화면에서 확인됨). 진짜 재구성이 필요한
  // "다음 항목 중 무작위로 적용됩니다" 격자는 항상 3~4열이라 여기엔 영향 없다.
  minCells: 3,
};

/**
 * OCR 결과 정규화.
 * - 전각 영숫자/기호 -> 반각
 * - Lv 표기 흔들림(LV, lv, Ly, Lvl, "Lv 3", "Lv,3") -> "Lv.3" 로 통일
 * - 공백 정리 후 빈 줄 제거
 */
function normalizeOcrText(text) {
  let s = String(text == null ? '' : text);

  if (typeof s.normalize === 'function') s = s.normalize('NFC');

  // 전각 -> 반각
  s = s.replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  s = s.replace(/　/g, ' ');
  // OCR 이 자주 흘리는 유사 기호들
  s = s.replace(/[·・･]/g, '·').replace(/[―—–ー]/g, '-');

  // Lv 표기 통일. L/l/I + v/V/y/Y (+ 선택적 l) + 구분자 + 숫자
  // 실측: Tesseract 가 "Lv.3" 을 "Lv3" 으로 흘리는 경우가 흔해 점 없는 형태도 받는다.
  s = s.replace(/\b[LlI][vVyY]l?\s*[.,·:]?\s*(\d{1,3})/g, 'Lv.$1');

  // 실측 보정: 'L' 이 통째로 날아가 "강화 v2" 처럼 나오는 경우가 있다.
  // 한글 툴팁에서 홀로 선 v + 숫자는 사실상 레벨 표기뿐이라 되살린다.
  // (로마 숫자 V 를 쓰는 문구가 있다면 이 줄을 지워야 한다.)
  s = s.replace(/\b[vVyY]\s*[.,·:]?\s*(\d{1,3})\b/g, 'Lv.$1');

  return s
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** 라벨 앞뒤에 붙은 잡기호 제거. */
function cleanLabel(raw) {
  return String(raw == null ? '' : raw)
    .replace(/^[\s\-·•*\[\]{}()|:：>]+/, '')
    .replace(/[\s:：\-|]+$/, '')
    .trim();
}

/** 한 줄을 옵션으로 해석. 실패하면 null. */
function parseLine(line) {
  for (const pat of LINE_PATTERNS) {
    const m = pat.re.exec(line);
    if (!m || !m.groups) continue;

    // 천 단위 쉼표는 떼고 숫자로 만든다.
    const value = Number(String(m.groups.value).replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;

    let label = cleanLabel(m.groups.label);
    if (!label && pat.kind === 'point') label = '포인트';

    // 라벨이 통째로 비어 있고 kind 가 number 인 경우는 의미 없는 숫자 줄로 본다.
    if (!label && pat.kind === 'number') continue;

    const opt = {
      raw: line,
      label: label || null,
      kind: pat.kind,
      value,
      // 원문 표기를 그대로 보존한다. "+1" 의 부호가 Number() 에서 사라지기 때문.
      valueText: m.groups.value,
      unit: pat.unit,
      // "증카"/"중가"/"종카" 는 전부 "증가"의 OCR 오독이라 그대로 보존하지 않고 되돌린다
      // (실측: 같은 화면 안에서도 매번 다른 글자로 깨졌다). "감소"는 이렇게 깨지는 걸
      // 본 적이 없어 그대로 둔다.
      delta: m.groups.delta ? (m.groups.delta === '감소' ? '감소' : '증가') : null,
    };

    opt.labelQuality = labelQuality(opt.label);

    // 라벨이 한글답지 않으면 "의심" 표시를 단다.
    // 다만 kind 가 level/point/percent/count 인 것은 단위까지 맞아떨어진 강한 매칭이라
    // 라벨만 깨졌을 뿐 값은 진짜일 가능성이 높다("XA효율 +3 증가" 같은 실측 사례).
    // 그래서 버리지 않고 값만 살린다. 가짜 옵션이 쏟아지던 통로는 단위 없는 number 쪽이다.
    opt.labelSuspect = opt.labelQuality < LABEL_HANGUL_MIN;

    // 옵션 목록에서 아예 빼버릴지의 판단.
    // 단위(Lv/포인트/%/회)가 맞아떨어진 강한 매칭이거나, 증감 접미사가 붙어 있으면
    // 라벨만 깨졌을 뿐 진짜 옵션 줄일 가능성이 높다("XA효율 +3 증가" 실측 사례).
    // 단위도 없고 증감도 없는데 라벨까지 잡음이면 그때만 가짜로 본다 - 실제로
    // 가짜 항목이 쏟아지던 통로가 정확히 여기였다.
    opt.suspect = opt.labelSuspect && pat.kind === 'number' && !opt.delta;

    opt.text = formatOption(opt);
    return opt;
  }
  return null;
}

/** 옵션 하나를 사람이 읽는 한 줄로. */
function formatOption(opt) {
  // 라벨이 '포인트' 하나뿐이면 단위가 겹치므로 라벨을 생략한다.
  const bare = !opt.label || (opt.kind === 'point' && opt.label === '포인트');
  const head = bare ? '' : opt.label + ' ';
  const num = opt.valueText != null ? opt.valueText : String(opt.value);
  const tail = opt.delta ? ' ' + opt.delta : '';

  if (opt.kind === 'level') return `${head}Lv.${num}${tail}`;
  if (opt.kind === 'point') {
    // "혼돈 포인트" 처럼 화면에 표시되는 라벨이 이미 단위로 끝나면 단위를 또 붙이지 않는다.
    // 라벨을 생략한 경우(bare)에는 단위가 있어야 뜻이 통한다.
    const unit = (!bare && /포인트\s*$/.test(opt.label || '')) ? '' : ' 포인트';
    return `${head}${num}${unit}${tail}`;
  }
  if (opt.kind === 'percent') return `${head}${num}%${tail}`;
  if (opt.kind === 'count') return `${head}${num}회${tail}`;
  return `${head}${num}${tail}`;
}

/**
 * 이미 정규화된 줄 배열 -> 구조화 결과. 평문 경로와 열 재구성 경로가 공유한다.
 */
function parseLinesArray(lines) {
  const result = {
    type: null,        // '질서' | '혼돈' | null
    typeLine: null,    // 계열이 검출된 원본 줄
    gemLevel: null,    // 젬 자체 레벨로 추정되는 값
    options: [],
    suspect: [],       // 라벨이 잡음으로 보이는 것들. 옵션 목록과 분리해서 보여준다.
    unmatched: [],
    normalized: lines.join('\n'),
  };

  for (const line of lines) {
    if (result.type === null) {
      const t = GEM_TYPE_RE.exec(line);
      if (t) {
        result.type = t[1];
        result.typeLine = line;
      }
    }

    const opt = parseLine(line);
    if (!opt) {
      result.unmatched.push(line);
    } else if (opt.suspect) {
      // 라벨이 잡음투성이인 단위 없는 숫자 줄. 옵션 목록을 오염시키므로 따로 뺀다.
      result.suspect.push(opt);
    } else {
      result.options.push(opt);
    }
  }

  // 젬 자체 레벨 추정.
  // 예전엔 "라벨이 없는 레벨 옵션" 이면 무조건 집었는데, 장식 영역 잡음에서 나온
  // 라벨 없는 레벨이 gemLevel 로 올라오는 사고가 있었다(실측: gemLevel 437).
  // 그래서 '젬' 이 명시된 라벨이거나, 라벨이 없으면서 줄 자체가 짧은 경우만 인정한다.
  const gemLevelOpt = result.options.find((o) => {
    if (o.kind !== 'level') return false;
    if (o.label) return /젬/.test(o.label) && !o.labelSuspect;
    return String(o.raw || '').trim().length <= 8; // "Lv.7" 같은 짧은 줄만
  });
  if (gemLevelOpt) {
    result.gemLevel = gemLevelOpt.value;
    gemLevelOpt.isGemLevel = true;
  }

  return result;
}

/**
 * 젬 툴팁 텍스트 -> 구조화 결과. (위치 정보 없는 평문 경로)
 * @param {string} rawText OCR 원문
 */
function parseGemTooltip(rawText) {
  const normalized = normalizeOcrText(rawText);
  const result = parseLinesArray(normalized ? normalized.split('\n') : []);
  result.mode = 'text';
  return result;
}

/* -------------------------------------------------------------------------
 * 열(컬럼) 재구성
 *
 * 왜 필요한가: 가공 화면 하단은 4개 항목이 가로로 늘어서 있고, 각 항목이
 * "이름 줄 + 값 줄" 2단으로 쌓여 있다. Tesseract 는 PSM_SINGLE_BLOCK 에서
 * 이미지를 위에서 아래로 훑기 때문에 data.text 가
 *   "의지력 효율   공격력   혼돈 포인트   낙인력"
 *   "+1 증가   Lv. 1 증가   +3 증가   Lv. 1 증가"
 * 처럼 나온다. 어떤 값이 어떤 이름의 것인지 평문만으로는 복구할 수 없다.
 *
 * 그래서 단어 bbox 를 쓴다. (tesseract.js 5.1.1 은 recognize() 결과의
 * data.words[].bbox 를 기본으로 채워준다. 별도 output 인자 불필요 - 실측 확인.)
 * ------------------------------------------------------------------------- */

/** recognize() 결과에서 bbox 있는 단어만 평탄화. words -> blocks 순으로 시도. */
function flattenWords(data) {
  const ok = (w) =>
    w && w.bbox &&
    typeof w.bbox.x0 === 'number' && typeof w.bbox.x1 === 'number' &&
    typeof w.bbox.y0 === 'number' && typeof w.bbox.y1 === 'number' &&
    String(w.text == null ? '' : w.text).trim().length > 0;

  if (!data) return [];
  if (Array.isArray(data.words) && data.words.length) return data.words.filter(ok);

  const out = [];
  for (const blk of data.blocks || []) {
    for (const para of blk.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const w of line.words || []) out.push(w);
      }
    }
  }
  return out.filter(ok);
}

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = a.length >> 1;
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 세로 중심 좌표의 간격으로 단어를 행으로 묶는다. */
function groupRows(words, opts) {
  const items = words.map((w) => ({
    w,
    cy: (w.bbox.y0 + w.bbox.y1) / 2,
    h: w.bbox.y1 - w.bbox.y0,
  }));
  if (!items.length) return [];

  const h = median(items.map((i) => i.h)) || 1;
  const thr = h * opts.rowGapRatio;

  items.sort((a, b) => a.cy - b.cy);

  const rows = [];
  let cur = [];
  let prevCy = null;
  for (const it of items) {
    if (prevCy !== null && it.cy - prevCy > thr) {
      rows.push(cur);
      cur = [];
    }
    cur.push(it);
    prevCy = it.cy;
  }
  if (cur.length) rows.push(cur);

  return rows.map((r) => r.map((i) => i.w).sort((a, b) => a.bbox.x0 - b.bbox.x0));
}

/** 단어 묶음 하나를 셀로 만든다. */
function makeCell(ws, spaceThr) {
  const parts = ws
    .map((w) => ({ t: String(w.text).trim(), bbox: w.bbox }))
    .filter((p) => p.t);

  let text = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && parts[i].bbox.x0 - parts[i - 1].bbox.x1 > spaceThr) text += ' ';
    text += parts[i].t;
  }

  if (!ws.length) return { text: '', x0: 0, x1: 0, cx: 0, words: [] };
  const x0 = Math.min.apply(null, ws.map((w) => w.bbox.x0));
  const x1 = Math.max.apply(null, ws.map((w) => w.bbox.x1));
  return { text, x0, x1, cx: (x0 + x1) / 2, words: ws };
}

/* -------------------------------------------------------------------------
 * 격자 기반 열 분할
 *
 * 한 행만 보고 가로 간격으로 쪼개면(splitCells) 실제 화면에서 두 열이 통째로
 * 붙어버리는 일이 생긴다. 실측 사례:
 *   "공격력 +3증가\"속 14. 1 증가 A"   <- 3번 칸과 4번 칸이 한 셀로 합쳐짐
 * 원인은 열 사이 간격이 좁아서가 아니라, 화살표 아이콘이 문자로 깨져 나온
 * 잡음 토큰(\", 속)이 열과 열 사이 빈 공간에 걸터앉아 다리를 놓기 때문이다.
 * 빈 공간이 잡음으로 메워지니 양쪽 틈이 각각 임계값 밑으로 내려간다.
 *
 * (참고: cellGapRatio 는 글자 높이에 대한 비율이라 확대 배율에 영향받지 않는다.
 *  간격과 글자 높이가 같이 커지므로 배율을 올려도 비율은 그대로다.
 *  즉 이 증상은 배율 탓이 아니다.)
 *
 * 그래서 임계값을 낮추는 대신(낮추면 "의지력 효율" 같은 진짜 라벨이 쪼개진다)
 * 두 행을 함께 본다. 진짜 열 경계라면 이름 행에서도 값 행에서도 비어 있어야 한다.
 * 두 행의 빈 구간을 교집합하면 잡음이 한쪽 행을 메워도 나머지 틈이 남는다.
 * 덤으로 두 행의 셀 개수가 항상 같아져서 짝짓기가 단순해진다.
 * ------------------------------------------------------------------------- */

/** 단어들의 x 구간을 병합해 "글자가 있는 구간" 목록을 만든다. */
function occupiedSpans(words) {
  const spans = words
    .map((w) => [w.bbox.x0, w.bbox.x1])
    .sort((a, b) => a[0] - b[0]);

  const out = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

/** 글자가 하나도 없는 가로 구간(빈 복도). 바깥 여백은 제외. */
function emptyGaps(words) {
  const occ = occupiedSpans(words);
  const gaps = [];
  for (let i = 1; i < occ.length; i++) gaps.push([occ[i - 1][1], occ[i][0]]);
  return gaps;
}

/** 두 빈 구간 목록의 교집합. 둘 다 비어 있는 곳만 진짜 열 경계 후보다. */
function intersectGaps(a, b) {
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const s = Math.max(a[i][0], b[j][0]);
    const e = Math.min(a[i][1], b[j][1]);
    if (e > s) out.push([s, e]);
    if (a[i][1] < b[j][1]) i++;
    else j++;
  }
  return out;
}

/** 두 행을 함께 보고 열 경계 x 좌표를 구한다. */
function gridBoundaries(topWords, bottomWords, opts) {
  const all = topWords.concat(bottomWords);
  const h = median(all.map((w) => w.bbox.y1 - w.bbox.y0)) || 1;
  const thr = h * opts.gridGapRatio;

  return intersectGaps(emptyGaps(topWords), emptyGaps(bottomWords))
    .filter((g) => g[1] - g[0] >= thr)
    .map((g) => (g[0] + g[1]) / 2);
}

/** 주어진 경계 x 좌표들로 한 행을 쪼갠다. 빈 칸도 자리를 유지한다. */
function splitByBounds(rowWords, bounds, spaceThr) {
  const buckets = [];
  for (let i = 0; i <= bounds.length; i++) buckets.push([]);

  for (const w of rowWords) {
    const cx = (w.bbox.x0 + w.bbox.x1) / 2;
    let k = 0;
    while (k < bounds.length && cx > bounds[k]) k++;
    buckets[k].push(w);
  }
  return buckets.map((ws) => makeCell(ws, spaceThr));
}

/** 한 행을 가로 간격 기준으로 셀(열)로 쪼갠다. */
function splitCells(rowWords, opts) {
  const h = median(rowWords.map((w) => w.bbox.y1 - w.bbox.y0)) || 1;
  const thr = h * opts.cellGapRatio;

  const groups = [];
  let cur = [];
  for (const w of rowWords) {
    if (cur.length && w.bbox.x0 - cur[cur.length - 1].bbox.x1 > thr) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);

  // Tesseract 는 한글을 글자 단위 "단어"로 쪼개는 일이 잦다("의","지","력").
  // 무조건 공백으로 이으면 "의 지 력 효율" 이 되므로, 실제로 벌어진 곳에만 공백을 넣는다.
  const spaceThr = h * opts.wordGapRatio;

  return groups.map((ws) => makeCell(ws, spaceThr));
}

const HAS_DIGIT_RE = /\d/;

/**
 * 위/아래 행을 칸 단위로 "이름 + 값" 으로 짝짓는다.
 *
 * 처음엔 "위/아래 칸 개수가 정확히 같아야" 짝짓기를 시도했는데, 실제 가공 화면은
 * 라벨 행에 아이콘/장식이 섞여 칸이 실제보다 더 쪼개지거나("의지력효율 3A", "_" 같은
 * 잡음 칸), 반대로 값 행에서 칸 사이 간격이 좁아 두 값이 한 칸으로 붙어버리는 일이
 * 흔해서 개수가 거의 항상 어긋났다 (실측). 그래서 개수 일치를 요구하는 대신, 값처럼
 * 보이는(숫자 포함) 아래 행 칸마다 x 중심이 가장 가까운 위 행 칸을 하나씩 찾아 짝짓는
 * 방식으로 바꿨다 - 짝을 못 찾은 값은 라벨 없이 값만 낸다(완전히 버리는 것보단 낫다).
 *
 * "가공 비용 | 900" + "소지 금액 | 261,267" 같은, 서로 다른 줄인데 우연히 정렬이
 * 맞아 잘못 묶이는 걸 막는 방어선은 opts.minCells 다 - 값 칸이 그 개수 미만이면
 * (2열짜리 표는 값 칸이 1개뿐) 애초에 짝짓기를 시도하지 않는다.
 */
function pairRowsByColumn(top, bottom, opts, topWords, bottomWords) {
  if (!top || !bottom) return null;

  // 1순위: 두 행을 함께 보고 격자로 쪼갠다. 성공하면 칸 개수가 같으므로
  // 위아래를 그냥 같은 자리끼리 붙이면 된다.
  if (topWords && bottomWords) {
    const bounds = gridBoundaries(topWords, bottomWords, opts);
    if (bounds.length >= opts.minCells - 1) {
      const h = median(topWords.concat(bottomWords).map((w) => w.bbox.y1 - w.bbox.y0)) || 1;
      const spaceThr = h * opts.wordGapRatio;

      const gTop = splitByBounds(topWords, bounds, spaceThr);
      const gBottom = splitByBounds(bottomWords, bounds, spaceThr);

      const valueCount = gBottom.filter((c) => HAS_DIGIT_RE.test(c.text)).length;
      if (valueCount >= opts.minCells) {
        const lines = [];
        for (let k = 0; k < gBottom.length; k++) {
          const v = gBottom[k];
          if (!HAS_DIGIT_RE.test(v.text)) continue;
          const label = gTop[k] && !HAS_DIGIT_RE.test(gTop[k].text) ? gTop[k].text.trim() : '';
          lines.push({ text: (label ? label + ' ' + v.text : v.text).trim(), source: 'column' });
        }
        if (lines.length) return lines;
      }
    }
  }

  // 2순위: 행마다 따로 쪼갠 결과로 순서를 지키는 최소 비용 정렬.
  const values = bottom.filter((c) => HAS_DIGIT_RE.test(c.text));
  if (values.length < opts.minCells) return null;

  // 라벨 후보: 숫자가 없고 두 글자 이상인 칸.
  const labels = top.filter((c) => !HAS_DIGIT_RE.test(c.text) && c.text.trim().length >= 2);

  const assign = assignMonotonic(labels, values, opts);

  return values.map((v, j) => {
    const li = assign[j];
    const text = li >= 0 ? (labels[li].text + ' ' + v.text).trim() : v.text;
    return { text, source: 'column' };
  });
}

/**
 * 라벨 칸과 값 칸을 x 위치로 짝짓는다.
 *
 * 처음엔 "값마다 제일 가까운 라벨을 하나씩 집어가는" 그리디 방식이었는데, 그리디는
 * 처리 순서에 따라 앞쪽 값이 뒤쪽 값의 라벨을 가로채면 그 뒤가 줄줄이 밀리는
 * 연쇄 오배정이 날 수 있다. 격자 UI 에서 라벨과 값의 순서는 절대 뒤바뀌지 않으므로
 * (i번째 라벨이 j번째 값보다 오른쪽에 있는데 짝이 되는 일은 없다), 순서를 지키는
 * 최소 비용 정렬을 DP 로 구한다. 칸 수가 한 자리라 비용은 무시할 만하고,
 * 결과는 처리 순서와 무관하게 항상 같다.
 *
 * @returns {number[]} values[j] 에 배정된 labels 인덱스 (없으면 -1)
 */
function assignMonotonic(labels, values, opts) {
  const L = labels.length;
  const V = values.length;
  const UNMATCHED = 1e6; // 값에 라벨을 못 붙이는 비용 (붙이는 쪽을 강하게 선호)

  const cost = (i, j) => {
    const width = Math.max(labels[i].x1 - labels[i].x0, values[j].x1 - values[j].x0);
    const tol = Math.max(width * opts.alignRatio, 8);
    const dist = Math.abs(labels[i].cx - values[j].cx);
    return dist <= tol ? dist : Infinity;
  };

  // dp[i][j] = labels[i..] 와 values[j..] 를 처리하는 최소 비용
  const dp = [];
  const choice = [];
  for (let i = 0; i <= L; i++) {
    dp.push(new Array(V + 1).fill(Infinity));
    choice.push(new Array(V + 1).fill(0));
  }
  for (let i = 0; i <= L; i++) dp[i][V] = 0; // 값이 다 처리되면 끝

  for (let j = V - 1; j >= 0; j--) {
    for (let i = L; i >= 0; i--) {
      // 이 값은 라벨 없이 간다
      let best = UNMATCHED + dp[i][j + 1];
      let pick = 0;

      if (i < L) {
        // 라벨 i 를 건너뛴다
        const skip = dp[i + 1][j];
        if (skip < best) { best = skip; pick = 1; }

        // 라벨 i 를 값 j 에 붙인다
        const c = cost(i, j);
        if (c !== Infinity) {
          const take = c + dp[i + 1][j + 1];
          if (take < best) { best = take; pick = 2; }
        }
      }
      dp[i][j] = best;
      choice[i][j] = pick;
    }
  }

  const out = new Array(V).fill(-1);
  let i = 0;
  let j = 0;
  while (j < V) {
    const pick = choice[i][j];
    if (pick === 2) { out[j] = i; i++; j++; }
    else if (pick === 1) { i++; }
    else { j++; }
  }
  return out;
}

/**
 * 관심 영역 게이트.
 *
 * 가짜 옵션의 가장 큰 원천은 파서가 아니라 "화면에서 볼 필요 없는 부분까지 읽는 것"이다.
 * 실측에서 상단 원형 장식 배경의 판독 불가 잡음이 그럴듯한 숫자로 파싱되어
 * gemLevel 437 같은 값이 나왔고, 하단 버튼("가공 하기 (9/9)")도 옵션으로 잡혔다.
 *
 * 정규식을 더 느슨하게 만드는 대신 화면 자체의 구조를 쓴다. 가공 화면에는
 * "다음 항목 중 무작위로 적용됩니다" 라는 문구가 옵션 격자 바로 위에 있고,
 * 그 아래로는 "가공 비용 / 소지 금액" 이 온다. 이 두 문구 사이만 남기면
 * 장식 영역과 버튼 영역이 통째로 사라진다.
 *
 * 앵커가 안 보이면(사용자가 이미 좁게 잘랐거나 젬 툴팁을 보는 중이면) 아무것도 하지 않는다.
 */
const REGION_ANCHORS = {
  // 짧고 잘 안 깨지는 조각만 쓴다. 문장 전체를 요구하면 한 글자만 깨져도 못 찾는다.
  start: /무작위|적용됩니다|적용 됩니다/,
  end: /가공\s*비용|소지\s*금액|가공\s*완료|가공\s*하기/,
};

function gateRegion(rowTexts) {
  let from = 0;
  let to = rowTexts.length;
  let applied = false;

  for (let i = 0; i < rowTexts.length; i++) {
    if (REGION_ANCHORS.start.test(rowTexts[i])) {
      from = i + 1;
      applied = true;
      break;
    }
  }
  for (let i = from; i < rowTexts.length; i++) {
    if (REGION_ANCHORS.end.test(rowTexts[i])) {
      to = i;
      applied = true;
      break;
    }
  }

  // 게이트를 걸었는데 남는 게 없으면 잘못 잡은 것이다. 원본을 그대로 쓴다.
  if (!applied || to - from < 1) return { from: 0, to: rowTexts.length, applied: false };
  return { from, to, applied: true };
}

/**
 * 단어 bbox -> 논리적인 줄 목록.
 * 열 구조로 보이는 두 행은 칸 단위로 "이름 값" 으로 합치고,
 * 그렇지 않은 행은 원래대로 한 줄로 흘려보낸다.
 * @returns {Array<{text: string, source: 'column'|'row'}>}
 */
function reconstructLines(words, options) {
  const opts = Object.assign({}, LAYOUT_DEFAULTS, options || {});
  const allRowWords = groupRows(words || [], opts);
  const allRows = allRowWords.map((r) => splitCells(r, opts));

  // 관심 영역 밖(장식 배경, 하단 버튼)을 먼저 잘라낸다.
  const rowTexts = allRows.map((r) => r.map((c) => c.text).join(' '));
  const gate = opts.useAnchors === false
    ? { from: 0, to: allRows.length, applied: false }
    : gateRegion(rowTexts);

  const rows = allRows.slice(gate.from, gate.to);
  const rowWords = allRowWords.slice(gate.from, gate.to);

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const top = rows[i];
    const bottom = rows[i + 1];

    const paired = pairRowsByColumn(top, bottom, opts, rowWords[i], rowWords[i + 1]);
    if (paired) {
      out.push.apply(out, paired);
      i++; // 아래 행까지 소비
    } else {
      out.push({ text: top.map((c) => c.text).join(' ').trim(), source: 'row' });
    }
  }

  const result = out.filter((o) => o.text);
  result.gate = {
    applied: gate.applied,
    dropped: allRows.length - rows.length,
    total: allRows.length,
  };
  return result;
}

/**
 * recognize() 결과의 단어 bbox 로 열을 재구성한 뒤 파싱.
 * bbox 가 없으면 null 을 돌려주고, 호출부가 평문 경로로 되돌아간다.
 */
function parseGemWords(data, options) {
  const words = flattenWords(data);
  if (!words.length) return null;

  const recon = reconstructLines(words, options);

  const lines = [];
  for (const r of recon) {
    const n = normalizeOcrText(r.text);
    if (n) lines.push.apply(lines, n.split('\n'));
  }

  const result = parseLinesArray(lines);
  result.reconstructed = recon;
  result.gate = recon.gate || null;
  result.mode = recon.some((r) => r.source === 'column') ? 'column' : 'row';
  return result;
}

/* =========================================================================
 * 2) 브라우저 UI (Node 에서 require 할 때는 실행되지 않음)
 * ========================================================================= */

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

/** 파싱 방식 표시용 라벨. */
const MODE_LABEL = {
  column: '열 재구성 (bbox)',
  row: '행 단위 (bbox)',
  text: '평문',
};

function initApp() {
  const $ = (id) => document.getElementById(id);

  const els = {
    btnShare: $('btnShare'),
    btnStop: $('btnStop'),
    btnRecognize: $('btnRecognize'),
    btnResetSel: $('btnResetSel'),
    btnSample: $('btnSample'),
    btnCopy: $('btnCopy'),
    btnReparse: $('btnReparse'),
    chkAuto: $('chkAuto'),
    chkColumns: $('chkColumns'),
    chkInvert: $('chkInvert'),
    chkContrast: $('chkContrast'),
    rngScale: $('rngScale'),
    rngThresh: $('rngThresh'),
    selPsm: $('selPsm'),
    valScale: $('valScale'),
    valThresh: $('valThresh'),
    video: $('video'),
    stageWrap: $('stageWrap'),
    stage: $('stage'),
    selBox: $('selBox'),
    selLabel: $('selLabel'),
    selInfo: $('selInfo'),
    sourceInfo: $('sourceInfo'),
    stagePlaceholder: $('stagePlaceholder'),
    cropCanvas: $('cropCanvas'),
    cropInfo: $('cropInfo'),
    rawText: $('rawText'),
    confInfo: $('confInfo'),
    outMode: $('outMode'),
    outGate: $('outGate'),
    outSuspect: $('outSuspect'),
    outRecon: $('outRecon'),
    outType: $('outType'),
    outGemLevel: $('outGemLevel'),
    outOptions: $('outOptions'),
    outUnmatched: $('outUnmatched'),
    outJson: $('outJson'),
    engineDot: $('engineDot'),
    engineStatus: $('engineStatus'),
    engineLog: $('engineLog'),
    progressWrap: $('progressWrap'),
    progressBar: $('progressBar'),
  };

  const state = {
    stream: null,
    sel: null,          // {x, y, w, h} - 영상 원본 픽셀 좌표계
    stageScale: 1,      // 화면 표시 px -> 원본 px 변환 배율
    worker: null,
    workerInit: null,
    busy: false,
    autoTimer: null,
    lastParsed: null,
  };

  const MIN_SEL = 16; // 원본 픽셀 기준 최소 선택 크기

  /* ---------- 상태 표시 ---------- */

  function setEngine(kind, text) {
    els.engineDot.className = 'dot dot-' + kind;
    els.engineStatus.textContent = text;
  }

  function log(msg) {
    els.engineLog.textContent = msg;
  }

  function setProgress(ratio) {
    if (ratio == null) {
      els.progressWrap.hidden = true;
      els.progressBar.style.width = '0%';
      return;
    }
    els.progressWrap.hidden = false;
    els.progressBar.style.width = Math.round(ratio * 100) + '%';
  }

  /* ---------- 환경 점검 ---------- */

  const hasDisplayMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  if (!hasDisplayMedia) {
    els.btnShare.disabled = true;
    setEngine('error', '화면 공유 불가');
    log('이 브라우저/환경에서는 getDisplayMedia 를 쓸 수 없습니다. https 또는 localhost 로 접속했는지 확인하세요. file:// 로 연 경우 동작하지 않습니다.');
  }

  const hasTesseract = typeof Tesseract !== 'undefined';
  if (!hasTesseract) {
    setEngine('error', 'OCR 엔진 없음');
    log('Tesseract.js 를 CDN 에서 불러오지 못했습니다. 네트워크 또는 광고 차단 확장을 확인하세요. (파서 테스트는 계속 쓸 수 있습니다.)');
  }

  /* ---------- 화면 공유 ---------- */

  async function startShare() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 10, max: 30 } },
        audio: false,
      });
      state.stream = stream;
      els.video.srcObject = stream;
      await els.video.play().catch(() => {});

      stream.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', stopShare);
      });

      els.btnShare.disabled = true;
      els.btnStop.disabled = false;
      els.btnRecognize.disabled = !hasTesseract;
      els.chkAuto.disabled = !hasTesseract;
      els.stagePlaceholder.hidden = true;

      onVideoReady();
      log('공유 시작. 젬 툴팁 영역에 사각형을 맞춘 뒤 "지금 인식"을 누르세요.');
    } catch (err) {
      if (err && err.name === 'NotAllowedError') {
        log('사용자가 화면 공유를 취소했습니다.');
      } else {
        log('화면 공유 실패: ' + (err && err.message ? err.message : String(err)));
      }
    }
  }

  function stopShare() {
    stopAuto();
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
    els.video.srcObject = null;
    els.btnShare.disabled = !hasDisplayMedia;
    els.btnStop.disabled = true;
    els.btnRecognize.disabled = true;
    els.chkAuto.disabled = true;
    els.chkAuto.checked = false;
    els.stage.hidden = true;
    els.stagePlaceholder.hidden = false;
    els.sourceInfo.textContent = '해상도 -';
    log('화면 공유를 중지했습니다.');
  }

  function onVideoReady() {
    const v = els.video;
    if (!v.videoWidth || !v.videoHeight) return;

    els.sourceInfo.textContent = `해상도 ${v.videoWidth} x ${v.videoHeight}`;

    if (!state.sel) resetSelection();
    layoutStage();
  }

  els.video.addEventListener('loadedmetadata', onVideoReady);
  els.video.addEventListener('resize', onVideoReady);

  /* ---------- 선택 영역 ---------- */

  function resetSelection() {
    const v = els.video;
    const W = v.videoWidth || 1920;
    const H = v.videoHeight || 1080;
    state.sel = {
      x: Math.round(W * 0.35),
      y: Math.round(H * 0.28),
      w: Math.round(W * 0.30),
      h: Math.round(H * 0.42),
    };
    renderSel();
  }

  /** 영상 표시 영역(레터박스 제외)에 stage 를 정확히 겹친다. */
  function layoutStage() {
    const v = els.video;
    if (!v.videoWidth || !v.videoHeight) {
      els.stage.hidden = true;
      return;
    }
    const wrapW = els.stageWrap.clientWidth;
    const wrapH = els.stageWrap.clientHeight;
    const scale = Math.min(wrapW / v.videoWidth, wrapH / v.videoHeight);

    const dispW = v.videoWidth * scale;
    const dispH = v.videoHeight * scale;

    els.stage.style.left = ((wrapW - dispW) / 2) + 'px';
    els.stage.style.top = ((wrapH - dispH) / 2) + 'px';
    els.stage.style.width = dispW + 'px';
    els.stage.style.height = dispH + 'px';
    els.stage.hidden = false;

    state.stageScale = scale;
    renderSel();
  }

  function clampSel(sel) {
    const v = els.video;
    const W = v.videoWidth || 1;
    const H = v.videoHeight || 1;

    const out = {
      x: Math.round(sel.x),
      y: Math.round(sel.y),
      w: Math.round(sel.w),
      h: Math.round(sel.h),
    };
    out.w = Math.max(MIN_SEL, Math.min(out.w, W));
    out.h = Math.max(MIN_SEL, Math.min(out.h, H));
    out.x = Math.max(0, Math.min(out.x, W - out.w));
    out.y = Math.max(0, Math.min(out.y, H - out.h));
    return out;
  }

  function renderSel() {
    if (!state.sel) return;
    const s = state.stageScale;
    const sel = state.sel;

    els.selBox.style.left = (sel.x * s) + 'px';
    els.selBox.style.top = (sel.y * s) + 'px';
    els.selBox.style.width = (sel.w * s) + 'px';
    els.selBox.style.height = (sel.h * s) + 'px';

    els.selLabel.textContent = `${sel.w} x ${sel.h}`;
    els.selInfo.textContent = `선택 영역 x:${sel.x} y:${sel.y} w:${sel.w} h:${sel.h}`;

    if (state.stream) updateCropPreview();
  }

  // 포인터 -> 원본 픽셀 좌표
  function toSource(evt) {
    const rect = els.stage.getBoundingClientRect();
    const s = state.stageScale || 1;
    return {
      x: (evt.clientX - rect.left) / s,
      y: (evt.clientY - rect.top) / s,
    };
  }

  let drag = null;

  function beginDrag(evt, mode) {
    if (!state.sel || evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();

    drag = {
      mode,
      start: toSource(evt),
      orig: Object.assign({}, state.sel),
    };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function onDragMove(evt) {
    if (!drag) return;
    const p = toSource(evt);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const o = drag.orig;

    if (drag.mode === 'move') {
      state.sel = clampSel({ x: o.x + dx, y: o.y + dy, w: o.w, h: o.h });
    } else if (drag.mode === 'new') {
      const x = Math.min(drag.start.x, p.x);
      const y = Math.min(drag.start.y, p.y);
      state.sel = clampSel({ x, y, w: Math.abs(dx), h: Math.abs(dy) });
    } else {
      // 방향별 리사이즈. 좌/상 방향은 위치까지 같이 움직인다.
      let { x, y, w, h } = o;
      if (drag.mode.includes('e')) w = o.w + dx;
      if (drag.mode.includes('s')) h = o.h + dy;
      if (drag.mode.includes('w')) { x = o.x + dx; w = o.w - dx; }
      if (drag.mode.includes('n')) { y = o.y + dy; h = o.h - dy; }

      if (w < MIN_SEL) { if (drag.mode.includes('w')) x = o.x + o.w - MIN_SEL; w = MIN_SEL; }
      if (h < MIN_SEL) { if (drag.mode.includes('n')) y = o.y + o.h - MIN_SEL; h = MIN_SEL; }

      state.sel = clampSel({ x, y, w, h });
    }
    renderSel();
  }

  function endDrag() {
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
  }

  els.selBox.addEventListener('pointerdown', (e) => beginDrag(e, 'move'));

  els.selBox.querySelectorAll('.handle').forEach((h) => {
    h.addEventListener('pointerdown', (e) => beginDrag(e, h.dataset.dir));
  });

  // 빈 곳을 끌면 새 사각형을 그린다.
  els.stage.addEventListener('pointerdown', (e) => {
    if (e.target !== els.stage) return;
    const p = toSource(e);
    state.sel = clampSel({ x: p.x, y: p.y, w: MIN_SEL, h: MIN_SEL });
    renderSel();
    beginDrag(e, 'new');
  });

  els.btnResetSel.addEventListener('click', resetSelection);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(layoutStage).observe(els.stageWrap);
  }
  window.addEventListener('resize', layoutStage);

  /* ---------- 크롭 + 전처리 ---------- */

  /**
   * 현재 프레임에서 선택 영역을 잘라 전처리한 캔버스를 돌려준다.
   * OCR 입력이자 화면 미리보기용으로 같은 캔버스를 쓴다.
   */
  function grabCrop() {
    const v = els.video;
    if (!v.videoWidth || !v.videoHeight || !state.sel) return null;

    const sel = clampSel(state.sel);
    const scale = Number(els.rngScale.value) || 2;

    const cw = Math.max(1, Math.round(sel.w * scale));
    const ch = Math.max(1, Math.round(sel.h * scale));

    // 지나치게 큰 입력은 OCR 이 느려지기만 한다.
    const MAX_PIXELS = 4000 * 4000;
    if (cw * ch > MAX_PIXELS) {
      log('선택 영역이 너무 큽니다. 확대 배율을 낮추거나 영역을 줄이세요.');
      return null;
    }

    const canvas = els.cropCanvas;
    canvas.width = cw;
    canvas.height = ch;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(v, sel.x, sel.y, sel.w, sel.h, 0, 0, cw, ch);

    preprocess(ctx, cw, ch);

    els.cropInfo.textContent = `${cw} x ${ch} px`;
    return canvas;
  }

  /**
   * 그레이스케일 -> 자동 대비 -> 반전 -> 이진화.
   * 게임 툴팁은 대개 어두운 배경 + 밝은 글씨라 반전을 기본으로 켠다.
   * (Tesseract 는 밝은 배경 + 어두운 글씨에서 가장 잘 동작한다.)
   */
  function preprocess(ctx, w, h) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;

    const gray = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      gray[i] = (d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114) | 0;
    }

    if (els.chkContrast.checked) {
      const hist = new Uint32Array(256);
      for (let i = 0; i < n; i++) hist[gray[i]]++;

      // 양끝 2% 를 잘라내고 남은 범위를 0..255 로 늘린다.
      const cut = Math.max(1, Math.floor(n * 0.02));
      let lo = 0, hi = 255, acc = 0;
      for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= cut) { lo = v; break; } }
      acc = 0;
      for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= cut) { hi = v; break; } }

      if (hi > lo) {
        const span = hi - lo;
        for (let i = 0; i < n; i++) {
          const val = ((gray[i] - lo) * 255) / span;
          gray[i] = val < 0 ? 0 : val > 255 ? 255 : val;
        }
      }
    }

    if (els.chkInvert.checked) {
      for (let i = 0; i < n; i++) gray[i] = 255 - gray[i];
    }

    const thresh = Number(els.rngThresh.value) || 0;
    if (thresh > 0) {
      for (let i = 0; i < n; i++) gray[i] = gray[i] < thresh ? 0 : 255;
    }

    for (let i = 0; i < n; i++) {
      const p = i * 4;
      d[p] = d[p + 1] = d[p + 2] = gray[i];
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  let previewTimer = null;
  function updateCropPreview() {
    // 드래그 중 매 프레임 재계산하지 않도록 살짝 묶어둔다.
    if (previewTimer) return;
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (state.stream && !state.busy) grabCrop();
    }, 60);
  }

  els.rngScale.addEventListener('input', () => {
    els.valScale.textContent = Number(els.rngScale.value).toFixed(1) + 'x';
    updateCropPreview();
  });

  els.rngThresh.addEventListener('input', () => {
    const v = Number(els.rngThresh.value);
    els.valThresh.textContent = v > 0 ? String(v) : '사용 안 함';
    updateCropPreview();
  });

  els.chkInvert.addEventListener('change', updateCropPreview);
  els.chkContrast.addEventListener('change', updateCropPreview);

  /* ---------- OCR ---------- */

  function onTesseractLog(m) {
    if (!m) return;
    if (typeof m.progress === 'number') setProgress(m.progress);
    log(`[${m.status || '진행'}] ${Math.round((m.progress || 0) * 100)}%`);
  }

  async function getWorker() {
    if (state.worker) return state.worker;
    if (state.workerInit) return state.workerInit;

    state.workerInit = (async () => {
      setEngine('busy', '엔진 초기화 중');
      log(`학습 데이터(${OCR_LANGS})를 내려받는 중입니다. 첫 실행은 수십 초 걸릴 수 있습니다.`);

      const worker = await Tesseract.createWorker(OCR_LANGS, 1, { logger: onTesseractLog });

      await worker.setParameters({
        preserve_interword_spaces: '1',
        tessedit_pageseg_mode: els.selPsm.value || '6',
      });

      state.worker = worker;
      state.appliedPsm = els.selPsm.value || '6';
      setEngine('ready', '엔진 준비 완료');
      return worker;
    })();

    try {
      return await state.workerInit;
    } catch (err) {
      state.workerInit = null;
      throw err;
    }
  }

  async function recognizeNow() {
    if (state.busy) return;
    if (!hasTesseract) {
      log('OCR 엔진을 불러오지 못해 인식할 수 없습니다.');
      return;
    }

    const canvas = grabCrop();
    if (!canvas) {
      log('캡처할 프레임이 없습니다. 화면 공유 상태와 선택 영역을 확인하세요.');
      return;
    }

    state.busy = true;
    els.btnRecognize.disabled = true;
    setEngine('busy', '인식 중');
    setProgress(0);

    try {
      const worker = await getWorker();

      // PSM 은 워커 생성 이후에도 바꿀 수 있어야 한다(워커는 한 번만 만든다).
      const psm = els.selPsm.value || '6';
      if (psm !== state.appliedPsm) {
        await worker.setParameters({ tessedit_pageseg_mode: psm });
        state.appliedPsm = psm;
      }

      const { data } = await worker.recognize(canvas);

      const text = data && data.text ? data.text : '';
      els.rawText.value = text;
      els.confInfo.textContent = (data && typeof data.confidence === 'number')
        ? `신뢰도 ${data.confidence.toFixed(1)}`
        : '신뢰도 -';

      // 우선 단어 bbox 로 열 재구성을 시도하고, 안 되면 평문 파싱으로 되돌아간다.
      let parsed = null;
      if (els.chkColumns.checked) {
        try {
          parsed = parseGemWords(data);
        } catch (e) {
          parsed = null;
        }
      }
      if (!parsed) parsed = parseGemTooltip(text);

      showParsed(parsed);
      setEngine('ready', '인식 완료');
      log(`인식 완료. ${text.split('\n').filter(Boolean).length}줄 검출. 방식: ${MODE_LABEL[parsed.mode] || parsed.mode}`);
    } catch (err) {
      setEngine('error', '인식 실패');
      log('인식 실패: ' + (err && err.message ? err.message : String(err)));
    } finally {
      setProgress(null);
      state.busy = false;
      els.btnRecognize.disabled = !state.stream;
    }
  }

  /* ---------- 자동 반복 ---------- */

  function startAuto() {
    stopAuto();
    state.autoTimer = setInterval(() => {
      if (!state.busy && state.stream) recognizeNow();
    }, 2000);
    log('2초 간격 자동 인식을 켰습니다.');
  }

  function stopAuto() {
    if (state.autoTimer) {
      clearInterval(state.autoTimer);
      state.autoTimer = null;
    }
  }

  els.chkAuto.addEventListener('change', () => {
    if (els.chkAuto.checked) startAuto();
    else stopAuto();
  });

  /* ---------- 결과 렌더링 ---------- */

  /** 텍스트만 있을 때(수동 편집, 샘플)는 평문 경로로 파싱. */
  function applyParse(text) {
    showParsed(parseGemTooltip(text));
  }

  function showParsed(parsed) {
    state.lastParsed = parsed;

    els.outMode.textContent = MODE_LABEL[parsed.mode] || '-';

    els.outGate.textContent = parsed.gate && parsed.gate.applied
      ? `적용 (${parsed.gate.dropped}/${parsed.gate.total}행 제외)`
      : '미적용';

    renderList(els.outSuspect, parsed.suspect || [], (opt) => {
      const li = document.createElement('li');
      li.textContent = `${opt.label || '(이름 없음)'} = ${opt.valueText}`;
      return li;
    }, '없음');

    renderList(els.outRecon, parsed.reconstructed || [], (r) => {
      const li = document.createElement('li');
      const tag = document.createElement('span');
      tag.className = 'o-kind';
      tag.textContent = r.source === 'column' ? 'COL' : 'ROW';
      const txt = document.createElement('span');
      txt.textContent = r.text;
      li.appendChild(txt);
      li.appendChild(tag);
      return li;
    }, '위치 정보 없이 평문으로 파싱했습니다.');

    els.outType.textContent = parsed.type ? `${parsed.type}의 젬` : '-';
    els.outGemLevel.textContent = parsed.gemLevel != null ? `Lv.${parsed.gemLevel}` : '-';

    renderList(els.outOptions, parsed.options, (opt) => {
      const li = document.createElement('li');

      const left = document.createElement('span');
      left.className = 'o-label';
      left.textContent = opt.label || '(이름 없음)';
      if (opt.labelSuspect) {
        const warn = document.createElement('span');
        warn.className = 'o-kind o-kind-warn';
        warn.textContent = '이름?';
        left.appendChild(warn);
      }
      if (opt.isGemLevel) {
        const tag = document.createElement('span');
        tag.className = 'o-kind';
        tag.textContent = 'GEM';
        left.appendChild(tag);
      }

      const right = document.createElement('span');
      right.className = 'o-value';
      const num = opt.valueText != null ? opt.valueText : String(opt.value);
      const tail = opt.delta ? ' ' + opt.delta : '';
      right.textContent =
        opt.kind === 'level'   ? `Lv.${num}${tail}` :
        opt.kind === 'point'   ? `${num} 포인트${tail}` :
        opt.kind === 'percent' ? `${num}%${tail}` :
        `${num}${tail}`;

      li.appendChild(left);
      li.appendChild(right);
      return li;
    }, '인식된 옵션이 없습니다.');

    renderList(els.outUnmatched, parsed.unmatched, (line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }, '-');

    els.outJson.textContent = JSON.stringify(
      {
        mode: parsed.mode,
        type: parsed.type,
        gemLevel: parsed.gemLevel,
        options: parsed.options.map((o) => ({
          label: o.label,
          kind: o.kind,
          value: o.value,
          valueText: o.valueText,
          unit: o.unit,
          delta: o.delta,
        })),
        unmatched: parsed.unmatched,
      },
      null,
      2
    );
  }

  function renderList(host, items, make, emptyText) {
    host.textContent = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = emptyText;
      host.appendChild(li);
      return;
    }
    items.forEach((item) => host.appendChild(make(item)));
  }

  /* ---------- 기타 버튼 ---------- */

  els.btnShare.addEventListener('click', startShare);
  els.btnStop.addEventListener('click', stopShare);
  els.btnRecognize.addEventListener('click', recognizeNow);
  els.btnReparse.addEventListener('click', () => applyParse(els.rawText.value));

  els.btnSample.addEventListener('click', () => {
    els.rawText.value = SAMPLE_TEXT;
    els.confInfo.textContent = '신뢰도 - (샘플)';
    applyParse(SAMPLE_TEXT);
    log('샘플 텍스트로 파서를 실행했습니다. OCR 은 거치지 않았습니다.');
  });

  els.btnCopy.addEventListener('click', async () => {
    const text = els.outJson.textContent || '{}';
    try {
      await navigator.clipboard.writeText(text);
      log('JSON 을 클립보드에 복사했습니다.');
    } catch (err) {
      log('클립보드 복사 실패. JSON 영역에서 직접 선택해 복사하세요.');
    }
  });

  els.rawText.addEventListener('input', () => applyParse(els.rawText.value));

  window.addEventListener('beforeunload', () => {
    stopAuto();
    if (state.stream) state.stream.getTracks().forEach((t) => t.stop());
    if (state.worker) { try { state.worker.terminate(); } catch (e) { /* 무시 */ } }
  });

  // 초기 상태
  applyParse('');
  els.valScale.textContent = Number(els.rngScale.value).toFixed(1) + 'x';
}

/* =========================================================================
 * 3) Node 테스트용 export (브라우저에서는 무시됨)
 * ========================================================================= */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SAMPLE_TEXT,
    LINE_PATTERNS,
    LAYOUT_DEFAULTS,
    OCR_LANGS,
    normalizeOcrText,
    cleanLabel,
    parseLine,
    formatOption,
    parseLinesArray,
    parseGemTooltip,
    flattenWords,
    groupRows,
    splitCells,
    makeCell,
    occupiedSpans,
    emptyGaps,
    intersectGaps,
    gridBoundaries,
    splitByBounds,
    pairRowsByColumn,
    reconstructLines,
    parseGemWords,
  };
}
