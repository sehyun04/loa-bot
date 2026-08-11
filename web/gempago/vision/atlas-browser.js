/*
 * 브라우저용 템플릿 로더.
 *
 * atlas.js 는 fs 로 PNG 를 읽는 Node 전용이다. 브라우저에서는 canvas 가 디코딩을
 * 대신하므로 png.js 도 필요 없다. 결과 객체 모양은 atlas.js 와 똑같아서
 * reader.js 는 어느 쪽으로 만든 아틀라스인지 알 필요가 없다.
 *
 * 워커에서 부르지 않고 메인 스레드에서 부른다. 워커의 OffscreenCanvas/createImageBitmap
 * 지원을 따질 필요가 없고, 만들어진 Float32Array 는 그대로 워커로 넘기면 되기 때문이다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GempagoAtlasBrowser = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GROUPS = ['label', 'whole', 'prefix', 'suffix', 'digit'];

  function toGray(canvas, ctx) {
    const { width, height } = canvas;
    const { data } = ctx.getImageData(0, 0, width, height);
    const g = new Float32Array(width * height);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return { width, height, data: g };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('템플릿을 불러오지 못했습니다: ' + url));
      img.src = url;
    });
  }

  /**
   * @param {string} base templates 디렉토리 URL (끝에 / 없이)
   * @returns {Promise<object>} atlas.js 의 load() 와 같은 모양
   */
  async function load(base) {
    const dir = base || 'vision/templates';
    const manifest = await (await fetch(dir + '/manifest.json')).json();

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const atlas = { manifest, text: {}, pattern: {}, family: {} };
    for (const g of GROUPS) { atlas[g] = {}; atlas.text[g] = {}; }

    for (const item of manifest.items) {
      const img = await loadImage(dir + '/' + item.file);
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      ctx.drawImage(img, 0, 0);
      const gray = toGray(canvas, ctx);

      if (item.group === 'anchor') { atlas.anchor = gray; continue; }
      if (!GROUPS.includes(item.group)) continue;

      const bucket = atlas[item.group];
      (bucket[item.key] || (bucket[item.key] = [])).push(gray);
      atlas.text[item.group][item.key] = item.text;
      if (item.pattern) atlas.pattern[item.key] = item.pattern;
      if (item.family) atlas.family[item.key] = item.family;
    }

    if (!atlas.anchor) throw new Error('anchor 템플릿이 manifest 에 없습니다');
    return atlas;
  }

  return { load, GROUPS };
});
