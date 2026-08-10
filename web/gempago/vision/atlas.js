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

function load() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
  const byFile = new Map(manifest.items.map((i) => [i.file, i]));
  const img = (f) => png.loadGray(path.join(DIR, f));
  const text = { label: {}, prefix: {}, suffix: {} };
  const pattern = { prefix: {} };

  const group = (prefix, kind) => {
    const out = {};
    for (const item of manifest.items) {
      if (!item.file.startsWith(prefix + '-')) continue;
      const key = item.file.slice(prefix.length + 1, -4);
      out[key] = img(item.file);
      if (text[kind]) text[kind][key] = item.text;
      if (item.pattern && pattern[kind]) pattern[kind][key] = item.pattern;
    }
    return out;
  };

  const digit = {};
  for (const item of manifest.items) {
    if (!item.file.startsWith('digit-')) continue;
    digit[item.text] = img(item.file); // 키가 곧 숫자 문자열이다
  }

  return {
    anchor: img('anchor.png'),
    label: group('label', 'label'),
    prefix: group('prefix', 'prefix'),
    suffix: group('suffix', 'suffix'),
    digit,
    text,
    pattern,
    manifest,
    byFile,
  };
}

module.exports = { load, DIR };
