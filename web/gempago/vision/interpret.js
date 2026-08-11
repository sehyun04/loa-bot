/*
 * 화면에서 읽은 글자를 rules.js 의 항목 id 로 바꾼다.
 *
 * 왜 별도 계층인가:
 * reader.js 는 "무슨 글자가 적혀 있나"만 안다. 그 글자가 어느 수치를 가리키는지는
 * 젬마다 다르다 - 화면에는 "1번 효과"가 아니라 "공격력", "아군 피해 강화" 같은
 * 실제 효과 이름이 찍히기 때문이다. 그래서 지금 젬의 슬롯 이름을 같이 받아야 한다.
 *
 * 이 파일은 이미지를 안 만진다. 순수 문자열 -> id 변환이라 캡처 없이도 전부 검증된다.
 */
(function (root, factory) {
  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const api = factory(isNode ? require('../rules.js') : root.GempagoRules);
  if (isNode) module.exports = api;
  else root.GempagoInterpret = api;
})(typeof self !== 'undefined' ? self : this, function (rules) {
  'use strict';

  /** 이름이 고정된 두 수치. 나머지 둘은 젬마다 효과 이름이 달라서 호출부가 알려줘야 한다. */
  const FIXED_LABELS = {
    '의지력 효율': 'will',
    // 젬 계열에 따라 둘 중 하나만 등장한다.
    '혼돈 포인트': 'point',
    '질서 포인트': 'point',
  };

  /**
   * 수치 증감이 아닌 항목들. 화면 표기가 이렇다는 것까지는 캡처로 확인했지만
   * (가공 완료 화면의 "다른 항목 보기 N회"), 증감 항목만큼 여러 번 본 건 아니다.
   * 실제 캡처가 모이면 여기부터 다시 맞춰야 한다.
   */
  const SPECIAL_LABELS = {
    '다른 항목 보기': 'reroll',
    '가공 비용': 'cost',
    '가공 상태 유지': 'keep',
  };

  const norm = (s) => (s == null ? '' : String(s).replace(/\s+/g, ' ').trim());

  /**
   * 옵션명이 어느 수치를 가리키는지.
   * @param {string} labelText 화면에 적힌 옵션명
   * @param {{opt1:string, opt2:string}} slots 지금 젬의 1번/2번 효과 이름
   */
  function resolveSlot(labelText, slots) {
    const t = norm(labelText);
    if (FIXED_LABELS[t]) return FIXED_LABELS[t];
    if (!slots) return null;
    if (norm(slots.opt1) === t) return 'opt1';
    if (norm(slots.opt2) === t) return 'opt2';
    return null;
  }

  /**
   * 값에서 방향과 크기를 뽑는다.
   * 부호는 접두가 아니라 접미(증가/감소)가 결정한다. "+1 감소" 처럼 찍히는지
   * "1 감소" 인지 캡처로 확인하지 못했는데, 접미만 보면 어느 쪽이든 같게 읽힌다.
   */
  function parseDelta(value) {
    if (!value) return null;
    const n = Number(value.digit);
    if (!Number.isInteger(n) || n < 1) return null;
    const s = norm(value.suffix || value.text);
    if (/증가|jeungga/.test(s)) return n;
    if (/감소|gamso/.test(s)) return -n;
    return null;
  }

  const OUTCOME_IDS = new Set(rules.OUTCOMES.map((o) => o.id));

  /**
   * 항목 하나를 id 로.
   * @returns {{ok:true, id:string}|{ok:false, reason:string}}
   */
  function toOutcomeId(reading, slots) {
    const label = norm(reading && reading.labelText);
    if (!label) return { ok: false, reason: '옵션명을 읽지 못했습니다' };

    const special = SPECIAL_LABELS[label];
    if (special === 'keep') return { ok: true, id: 'keep' };
    if (special === 'reroll') {
      const n = Number(reading.value && reading.value.digit);
      if (n !== 1 && n !== 2) return { ok: false, reason: '리롤 획득 횟수를 읽지 못했습니다' };
      return { ok: true, id: 'reroll+' + n };
    }
    if (special === 'cost') {
      const t = norm(reading.value && reading.value.text);
      if (/\+/.test(t)) return { ok: true, id: 'cost:+1' };
      if (/-|−/.test(t)) return { ok: true, id: 'cost:-1' };
      return { ok: false, reason: '비용 증감 방향을 읽지 못했습니다' };
    }

    const slot = resolveSlot(label, slots);
    if (!slot) return { ok: false, reason: `"${label}" 이 젬의 어느 수치인지 모릅니다` };

    // "효과 변경"은 값이 없고 옵션명만 바뀐다는 뜻이다.
    if (/변경/.test(norm(reading.value && reading.value.text))) {
      if (slot !== 'opt1' && slot !== 'opt2') {
        return { ok: false, reason: '의지력/포인트는 변경 대상이 아닙니다' };
      }
      return { ok: true, id: 'change:' + slot };
    }

    const delta = parseDelta(reading.value);
    if (delta == null) return { ok: false, reason: '증감을 읽지 못했습니다' };

    // 효과는 "Lv. N", 의지력/포인트는 "+N" 으로 찍힌다. 어긋나면 슬롯을 잘못 잡은 것이다.
    const prefix = reading.value && reading.value.prefix;
    if (prefix) {
      const isEffect = slot === 'opt1' || slot === 'opt2';
      if (isEffect && prefix !== 'lv') return { ok: false, reason: '효과인데 Lv. 표기가 아닙니다' };
      if (!isEffect && prefix === 'lv') return { ok: false, reason: '수치인데 Lv. 표기입니다' };
    }

    const id = slot + (delta > 0 ? '+' : '') + delta;
    if (!OUTCOME_IDS.has(id)) return { ok: false, reason: `확률 표에 없는 항목입니다: ${id}` };
    return { ok: true, id };
  }

  /**
   * readOptions 결과 4개를 솔버가 먹는 id 배열로.
   * 하나라도 실패하면 ids 는 null 이다 - 셋만 아는 상태로 판단하면 안 된다.
   */
  function toPicks(options, slots) {
    const ids = [];
    const problems = [];
    (options || []).forEach((o, i) => {
      if (o && o.confident === false) problems.push({ column: i + 1, reason: '인식이 불확실합니다' });
      const r = toOutcomeId(o, slots);
      if (r.ok) ids.push(r.id);
      else problems.push({ column: i + 1, reason: r.reason });
    });
    return { ids: ids.length === 4 && !problems.length ? ids : null, resolved: ids, problems };
  }

  /**
   * 반대 방향. 어떤 항목이 화면에 어떻게 찍힐지 만든다.
   * 테스트에서 27개 항목을 왕복시키는 데 쓰고, UI 에서 항목 이름을 젬에 맞게
   * 보여줄 때도 쓴다("1번 효과 +1" 대신 "공격력 Lv. 1 증가").
   */
  function toScreenText(outcome, slots) {
    const s = slots || {};
    const nameOf = (slot) => (slot === 'will' ? '의지력 효율'
      : slot === 'point' ? (s.point || '혼돈 포인트')
      : s[slot] || rules.STAT_LABEL[slot]);

    if (outcome.kind === 'delta') {
      const mag = Math.abs(outcome.delta);
      const dir = outcome.delta > 0 ? '증가' : '감소';
      const isEffect = outcome.stat === 'opt1' || outcome.stat === 'opt2';
      // 감소에 "+" 를 붙이면 "+1 감소" 가 되어 읽는 사람이 헷갈린다. 방향은 접미가 말한다.
      // 실제 게임이 "1 감소" 로 찍는지 "-1 감소" 로 찍는지는 아직 캡처로 확인하지 못했다.
      const num = isEffect ? `Lv. ${mag}` : (outcome.delta > 0 ? `+${mag}` : `${mag}`);
      return {
        labelText: nameOf(outcome.stat),
        value: {
          prefix: isEffect ? 'lv' : 'plus',
          digit: String(mag),
          suffix: dir,
          text: `${num} ${dir}`,
        },
      };
    }
    if (outcome.kind === 'change') {
      return { labelText: nameOf(outcome.slot), value: { text: '효과 변경' } };
    }
    if (outcome.kind === 'cost') {
      return { labelText: '가공 비용', value: { text: (outcome.costMod > 0 ? '+' : '-') + '100%' } };
    }
    if (outcome.kind === 'keep') {
      return { labelText: '가공 상태 유지', value: { text: '' } };
    }
    if (outcome.kind === 'reroll') {
      return {
        labelText: '다른 항목 보기',
        value: { digit: String(outcome.gain), suffix: '증가', text: `${outcome.gain}회 증가` },
      };
    }
    return null;
  }

  return { FIXED_LABELS, SPECIAL_LABELS, resolveSlot, parseDelta, toOutcomeId, toPicks, toScreenText };
});
