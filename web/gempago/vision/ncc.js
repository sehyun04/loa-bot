/*
 * 정규화 상호상관(NCC) 템플릿 매칭. OpenCV 의 TM_CCOEFF_NORMED 와 같은 계산이다.
 *
 * 왜 OCR 이 아니라 이건가:
 * 젬 가공 화면에 뜨는 글자는 게임이 고정 폰트로 렌더한, 종류가 정해진 문자열이다.
 * 즉 "인식" 문제가 아니라 "정해진 후보 중 어느 것인가" 하는 조회 문제다.
 * 범용 OCR 은 오답일 때도 그럴듯한 글자를 뱉어서 틀린 걸 알 수가 없지만(실측: 7라운드 내내
 * 매번 새로운 형태로 깨졌다), NCC 는 점수를 주므로 "모르겠다"고 말할 수 있다.
 *
 * 평균을 빼고 정규화하므로 밝기/대비 차이에는 영향받지 않고 모양만 본다.
 * 값 범위는 -1 ~ 1, 1 이면 완전히 동일한 패턴.
 *
 * 이미지 표현은 { width, height, data } 이고 data 는 그레이스케일 Float32Array(0..255).
 * 브라우저에서는 imageDataToGray() 로, Node 에서는 png.js 의 toGray() 로 만든다.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GempagoNCC = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function stats(data, x0, y0, tw, th, stride) {
    let sum = 0;
    for (let j = 0; j < th; j++) {
      const o = (y0 + j) * stride + x0;
      for (let i = 0; i < tw; i++) sum += data[o + i];
    }
    const mean = sum / (tw * th);
    let ss = 0;
    for (let j = 0; j < th; j++) {
      const o = (y0 + j) * stride + x0;
      for (let i = 0; i < tw; i++) {
        const d = data[o + i] - mean;
        ss += d * d;
      }
    }
    return { mean, norm: Math.sqrt(ss) };
  }

  /**
   * 템플릿을 이미지의 band 영역 안에서 슬라이딩하며 전 위치의 점수를 낸다.
   * @param {{width:number,height:number,data:Float32Array}} img
   * @param {{width:number,height:number,data:Float32Array}} tpl
   * @param {{x:number,y:number,w:number,h:number}} [band] 없으면 이미지 전체
   * @returns {{x:number,y:number,score:number}[]}
   */
  function matchTemplate(img, tpl, band) {
    const bx = band ? band.x : 0;
    const by = band ? band.y : 0;
    const bw = band ? band.w : img.width;
    const bh = band ? band.h : img.height;

    const t = stats(tpl.data, 0, 0, tpl.width, tpl.height, tpl.width);
    const results = [];

    const yEnd = Math.min(by + bh, img.height) - tpl.height;
    const xEnd = Math.min(bx + bw, img.width) - tpl.width;

    for (let y = by; y <= yEnd; y++) {
      for (let x = bx; x <= xEnd; x++) {
        const s = stats(img.data, x, y, tpl.width, tpl.height, img.width);
        // 완전히 균일한 영역(단색 배경)은 상관을 정의할 수 없다.
        if (s.norm === 0 || t.norm === 0) continue;

        let acc = 0;
        for (let j = 0; j < tpl.height; j++) {
          const io = (y + j) * img.width + x;
          const to = j * tpl.width;
          for (let i = 0; i < tpl.width; i++) {
            acc += (img.data[io + i] - s.mean) * (tpl.data[to + i] - t.mean);
          }
        }
        results.push({ x, y, score: acc / (s.norm * t.norm) });
      }
    }
    return results;
  }

  /** 최고 점수 위치 하나. 후보가 없으면 null. */
  function best(img, tpl, band) {
    let b = null;
    for (const r of matchTemplate(img, tpl, band)) {
      if (!b || r.score > b.score) b = r;
    }
    return b;
  }

  /**
   * 서로 겹치지 않는 상위 n개 피크.
   * 최고점 주변은 거의 같은 점수가 나오므로, minDist 안쪽은 같은 글자로 보고 버린다.
   */
  function peaks(img, tpl, band, n, minDist) {
    const all = matchTemplate(img, tpl, band).sort((a, b) => b.score - a.score);
    const out = [];
    const d = minDist == null ? Math.max(tpl.width, tpl.height) * 0.7 : minDist;
    for (const r of all) {
      if (out.length >= n) break;
      if (out.some((o) => Math.abs(o.x - r.x) < d && Math.abs(o.y - r.y) < d)) continue;
      out.push(r);
    }
    return out;
  }

  /**
   * 여러 후보 템플릿 중 가장 잘 맞는 것을 고른다.
   * OCR 과 달리 2등과의 격차를 같이 돌려주므로, 호출부가 "확실한가"를 판단할 수 있다.
   * @param {Object<string, {width:number,height:number,data:Float32Array}>} templates
   * @returns {{label:string, score:number, x:number, y:number, margin:number, runnerUp:string|null}|null}
   */
  function classify(img, templates, band) {
    const scored = [];
    for (const label of Object.keys(templates)) {
      const b = best(img, templates[label], band);
      if (b) scored.push({ label, score: b.score, x: b.x, y: b.y });
    }
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const second = scored[1] || null;
    return {
      ...top,
      margin: second ? top.score - second.score : top.score,
      runnerUp: second ? second.label : null,
    };
  }

  /** 브라우저 canvas 의 ImageData -> 그레이 이미지. */
  function imageDataToGray(imageData) {
    const { width, height, data } = imageData;
    const g = new Float32Array(width * height);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return { width, height, data: g };
  }

  return { matchTemplate, best, peaks, classify, imageDataToGray };
});
