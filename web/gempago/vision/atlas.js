/*
 * 템플릿 묶음 로더 (Node 전용).
 *
 * 브라우저에서는 canvas 로 디코딩해야 하므로 같은 모양의 객체를 따로 만들어 넘기면 된다.
 * 파일명을 ASCII 로 둔 이유: 한글 파일명은 플랫폼마다 정규화(NFC/NFD)가 달라서
 * git 체크아웃 후 경로가 안 맞는 일이 생긴다. 실제 문자열은 manifest.json 에 있다.
 */
const path = require('path');
const fs = require('fs');
const png = require('./png.js');

const DIR = path.join(__dirname, 'templates');
const GROUPS = ['label', 'whole', 'prefix', 'suffix', 'digit'];

/**
 * 같은 key 에 템플릿이 여러 개일 수 있다. 출처(선명한 원본 / 리샘플된 캡처)가 다르면
 * 같은 글자라도 점수가 크게 갈리기 때문이다 - 매칭은 그중 최고점을 쓴다.
 * 자세한 실측값은 vision/README.md 참고.
 */
function load(dir) {
  const base = dir || DIR;
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8'));

  const atlas = { manifest, text: {}, pattern: {}, family: {} };
  for (const g of GROUPS) {
    atlas[g] = {};
    atlas.text[g] = {};
  }

  for (const item of manifest.items) {
    if (item.group === 'anchor') {
      atlas.anchor = png.loadGray(path.join(base, item.file));
      continue;
    }
    if (!GROUPS.includes(item.group)) continue;

    const bucket = atlas[item.group];
    (bucket[item.key] || (bucket[item.key] = [])).push(png.loadGray(path.join(base, item.file)));
    atlas.text[item.group][item.key] = item.text;
    if (item.pattern) atlas.pattern[item.key] = item.pattern;
    if (item.family) atlas.family[item.key] = item.family;
  }

  if (!atlas.anchor) throw new Error('anchor 템플릿이 manifest 에 없습니다');
  return atlas;
}

module.exports = { load, DIR, GROUPS };
