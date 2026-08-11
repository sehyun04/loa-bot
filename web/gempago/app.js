/*
 * 젬파고 계산기 UI.
 *
 * 계산은 전부 worker.js 안의 solver.js 가 한다. 여기서는 확률을 흉내내지 않는다.
 * 값이 의심스러우면 `node web/gempago/test.js` 가 같은 코드를 검증한다.
 */
(function () {
  'use strict';

  const STATS = [
    { key: 'will', label: '의지력 효율' },
    { key: 'point', label: '포인트' },
    { key: 'opt1', label: '1번 효과' },
    { key: 'opt2', label: '2번 효과' },
  ];

  const $ = (id) => document.getElementById(id);

  // 고점 목표는 확률이 0.2% 대까지 내려간다. 소수점 2자리로 자르면 서로 다른 값이
  // 똑같이 보이고, "리롤한다"고 해놓고 양쪽에 같은 숫자를 띄우는 꼴이 된다.
  function pct(v) {
    const p = v * 100;
    if (p === 0 || p >= 1) return p.toFixed(2) + '%';
    return p.toFixed(p >= 0.1 ? 3 : 4) + '%';
  }

  function pp(v) {
    const p = v * 100;
    if (p >= 0.01) return p.toFixed(2) + '%p';
    return p.toFixed(4) + '%p';
  }

  const worker = new Worker('worker.js?v=2026-08-11.2');
  let seq = 0;
  const pending = new Map();

  worker.onmessage = (e) => {
    const { id, ok, result, error } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error));
  };
  worker.onerror = (e) => {
    setNote('계산기를 불러오지 못했습니다', e.message + ' - 로컬 서버로 열었는지 확인하세요.', true);
  };

  function ask(type, payload) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload });
    });
  }

  function setNote(title, text, isError) {
    $('note').hidden = false;
    $('note').classList.toggle('error', !!isError);
    $('note').querySelector('strong').textContent = title;
    $('noteText').textContent = text || '';
  }

  function fillRange(sel, from, to, value) {
    sel.innerHTML = '';
    for (let v = from; v <= to; v++) {
      const o = document.createElement('option');
      o.value = String(v);
      o.textContent = String(v);
      sel.appendChild(o);
    }
    sel.value = String(value);
  }

  // 현재 수치 / 목표 수치 입력칸을 같은 모양으로 만든다.
  function buildStatInputs(container, prefix, initial) {
    container.innerHTML = '';
    for (const { key, label } of STATS) {
      const row = document.createElement('label');
      row.className = 'row';
      const span = document.createElement('span');
      span.textContent = label;
      const sel = document.createElement('select');
      sel.id = prefix + '_' + key;
      fillRange(sel, 1, 5, initial);
      row.appendChild(span);
      row.appendChild(sel);
      container.appendChild(row);
    }
  }

  buildStatInputs($('stats'), 'cur', 1);
  buildStatInputs($('target'), 'tgt', 1);

  const picks = [];
  for (let i = 0; i < 4; i++) {
    const sel = document.createElement('select');
    sel.id = 'pick' + i;
    $('picks').appendChild(sel);
    picks.push(sel);
  }

  function readState() {
    const s = { n: +$('attempts').value, cost: +$('cost').value, r: +$('rerolls').value };
    for (const { key } of STATS) s[key] = +$('cur_' + key).value;
    return s;
  }

  function readSlots() {
    return {
      opt1: $('name_opt1').value.trim() || '1번 효과',
      opt2: $('name_opt2').value.trim() || '2번 효과',
      point: $('gemType').value,
    };
  }

  // 수치 입력칸 이름도 젬에 맞춰 바꾼다. 화면과 같은 단어를 봐야 헷갈리지 않는다.
  function syncStatLabels() {
    const s = readSlots();
    const names = { will: '의지력 효율', point: s.point, opt1: s.opt1, opt2: s.opt2 };
    for (const { key } of STATS) {
      for (const prefix of ['cur', 'tgt']) {
        const span = $(prefix + '_' + key).parentElement.querySelector('span');
        span.textContent = names[key];
      }
    }
  }

  function readTarget() {
    const t = {};
    for (const { key } of STATS) {
      const v = +$('tgt_' + key).value;
      if (v > 1) t[key] = v; // 1 은 제약이 아니다
    }
    return t;
  }

  function syncPresetButtons() {
    const cur = JSON.stringify(readTarget());
    for (const b of $('presets').children) {
      const same = JSON.stringify(JSON.parse(b.dataset.target)) === cur;
      b.setAttribute('aria-pressed', same ? 'true' : 'false');
    }
  }

  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const t = JSON.parse(b.dataset.target);
    for (const { key } of STATS) $('tgt_' + key).value = String(t[key] || 1);
    syncPresetButtons();
    refresh();
  });

  $('grade').addEventListener('change', () => {
    const max = +$('grade').value;
    fillRange($('attempts'), 0, max, max);
    refresh();
  });

  // 남은 가공 횟수가 바뀌면 뜰 수 있는 항목도 바뀌므로 선택지를 다시 채운다.
  let lastOutcomeKey = '';
  async function refreshOutcomes(state, slots) {
    const key = STATS.map((s) => state[s.key]).join(',') + '|' + (state.n <= 1) + '|' + state.cost
      + '|' + slots.opt1 + '|' + slots.opt2 + '|' + slots.point;
    if (key === lastOutcomeKey) return;
    lastOutcomeKey = key;

    const outs = await ask('outcomes', { state, slots });
    for (const sel of picks) {
      const keep = sel.value;
      sel.innerHTML = '';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '(선택)';
      sel.appendChild(blank);
      for (const o of outs) {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      // 상태가 바뀌어 더 이상 못 뜨는 항목이면 자동으로 비워진다.
      sel.value = outs.some((o) => o.id === keep) ? keep : '';
    }
  }

  function readPicks() {
    const ids = picks.map((s) => s.value).filter(Boolean);
    return ids.length === 4 ? ids : null;
  }

  let running = false, queued = false;

  async function refresh() {
    if (running) { queued = true; return; }
    running = true;
    try {
      const state = readState();
      const target = readTarget();
      const maxAttempts = +$('grade').value;

      if (state.n > maxAttempts) {
        fillRange($('attempts'), 0, maxAttempts, maxAttempts);
        state.n = maxAttempts;
      }

      syncStatLabels();
      await refreshOutcomes(state, readSlots());

      if (!Object.keys(target).length) {
        $('result').hidden = true;
        setNote('목표를 정하세요', '전부 1 이면 아무 조건이 없어서 확률이 항상 100% 입니다.');
        return;
      }

      setNote('계산 중', '처음 한 번만 오래 걸립니다 (목표당 약 2초).');
      const res = await ask('evaluate', {
        state, target, maxAttempts, picks: readPicks(), slots: readSlots(),
      });
      render(state, res);
    } catch (err) {
      setNote('계산 실패', err.message, true);
      $('result').hidden = true;
    } finally {
      running = false;
      if (queued) { queued = false; refresh(); }
    }
  }

  function render(state, res) {
    $('note').hidden = true;
    $('result').hidden = false;

    const d = res.decision;
    const verdict = $('verdict');

    if (res.alreadyMet) {
      verdict.className = 'verdict commit';
      verdict.innerHTML = '';
      verdict.append('목표 달성 - 지금 가공 완료');
      const small = document.createElement('small');
      small.textContent = '더 굴리면 -1 이 뜰 수 있어서 손해만 본다.';
      verdict.appendChild(small);
    } else if (!d) {
      verdict.className = 'verdict';
      verdict.innerHTML = '';
      verdict.append('현재 목표 달성 확률 ' + pct(res.value));
      const small = document.createElement('small');
      small.textContent = '화면에 뜬 4개를 고르면 굴리기/리롤을 판단한다.';
      verdict.appendChild(small);
    } else {
      const isCommit = d.action === 'commit';
      // 차이가 이 정도면 어느 쪽을 골라도 사실상 같다. 근소한 우위를 단정적으로
      // 말하면 실제보다 확신 있는 조언처럼 읽힌다.
      const marginal = d.reroll !== null && d.gain < 0.0005;

      verdict.className = 'verdict ' + (marginal ? '' : d.action);
      verdict.innerHTML = '';
      verdict.append(marginal ? '어느 쪽이든 비슷하다' : (isCommit ? '굴린다' : '리롤한다'));

      const small = document.createElement('small');
      if (d.reroll === null) {
        small.textContent = '리롤이 없어서 선택지가 없다.';
      } else if (marginal) {
        small.textContent =
          `굳이 따지면 ${isCommit ? '굴리기' : '리롤'}이 ${pp(d.gain)} 앞선다. 리롤을 아껴도 된다.`;
      } else {
        small.textContent = `${isCommit ? '리롤' : '굴리기'}보다 ${pp(d.gain)} 유리하다.`;
      }
      verdict.appendChild(small);
    }

    $('valCommit').textContent = d ? pct(d.commit) : pct(res.value);
    $('valReroll').textContent = d && d.reroll !== null ? pct(d.reroll) : '-';
    $('optCommit').classList.toggle('pick', !!d && d.action === 'commit');
    $('optReroll').classList.toggle('pick', !!d && d.action === 'reroll');

    const tb = $('breakdown');
    tb.innerHTML = '';
    for (const p of (res.perPick || [])) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = p.label;
      const td2 = document.createElement('td');
      td2.textContent = pct(p.value);
      tr.append(td1, td2);
      tb.appendChild(tr);
    }
    tb.parentElement.hidden = !(res.perPick && res.perPick.length);

    $('meta').textContent =
      `남은 가공 ${state.n}회 · 리롤 ${state.r}회 · 이 목표 전체 풀이 ${res.ms}ms`;
  }

  fillRange($('attempts'), 0, 9, 9);
  fillRange($('rerolls'), 0, 6, 2);

  document.addEventListener('change', (e) => {
    if (e.target.matches('select')) { syncPresetButtons(); refresh(); }
  });
  // 효과 이름은 타이핑 중에도 반영한다. change 는 포커스가 빠져야 오는데,
  // 이름만 고치고 바로 항목을 고르는 흐름이라 그때는 이미 목록이 낡아 있다.
  let nameTimer = null;
  document.addEventListener('input', (e) => {
    if (!e.target.matches('input[type="text"]')) return;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(refresh, 250);
  });

  syncPresetButtons();
  refresh();
})();
