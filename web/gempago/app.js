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

  const worker = new Worker('worker.js?v=2026-08-15.12');
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
    setNote('계산기를 불러오지 못했습니다', e.message + ' - 로컬 서버로 열었는지 확인하세요.', 'error');
  };

  function ask(type, payload, transfer) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload }, transfer || []);
    });
  }

  /** kind: 'loading' 이면 스피너가 돈다, 'error' 면 빨갛게. */
  function setNote(title, text, kind) {
    $('note').hidden = false;
    $('note').classList.toggle('error', kind === 'error');
    $('noteSpin').hidden = kind !== 'loading';
    $('note').querySelector('strong').textContent = title;
    $('noteText').textContent = text || '';
  }

  /*
   * 오래 걸리는 일에는 화면 전체를 덮는다.
   *
   * 첫 읽기는 배율을 찾느라 1~8초, 목표 첫 풀이는 2~7초 걸린다. 그동안 아무 표시가
   * 없으면 멈춘 것으로 읽힌다. 반대로 배율을 잡은 뒤의 읽기는 60ms 라 그때도 덮으면
   * 0.7초마다 화면이 깜빡인다. 그래서 오래 걸릴 일에만 부르고, 그것도 250ms 뒤에야
   * 띄운다 - 캐시에 걸려 즉시 끝나는 경우까지 덮을 이유가 없다.
   */
  const BUSY_DELAY = 250;
  let busyTimer = null, busyTick = null, busyDepth = 0;
  let busyLabel = '', busySub = '', busyAt = 0;

  function paintBusy() {
    $('busyText').textContent = busyLabel;
    const sec = Math.round((Date.now() - busyAt) / 1000);
    $('busySub').textContent = sec >= 1 ? (busySub ? busySub + ' · ' : '') + sec + '초' : busySub;
  }

  /**
   * 겹쳐 부를 수 있다 - 템플릿 로딩과 첫 풀이가 같이 돈다. 나중에 부른 쪽이 문구를
   * 가져간다. 안 그러면 이미 끝난 단계의 이름을 몇 초씩 보게 된다.
   */
  function busyOn(text, sub) {
    busyDepth++;
    busyLabel = text;
    busySub = sub || '';
    busyAt = Date.now();
    if (!$('busy').hidden) { paintBusy(); return; }
    if (busyTimer) return;
    busyTimer = setTimeout(() => {
      $('busy').hidden = false;
      paintBusy();
      // 숫자가 늘어야 살아 있는 것으로 보인다.
      busyTick = setInterval(paintBusy, 1000);
    }, BUSY_DELAY);
  }

  function busyOff() {
    busyDepth = Math.max(0, busyDepth - 1);
    if (busyDepth) return; // 다 끝나야 걷는다
    busyReset();
  }

  /** 무슨 일이 있어도 갇히지 않게. 실패 경로에서도 부른다. */
  function busyReset() {
    busyDepth = 0;
    clearTimeout(busyTimer); clearInterval(busyTick);
    busyTimer = busyTick = null;
    $('busy').hidden = true;
  }

  // 목표별 첫 풀이만 오래 걸린다. 한 번 푼 목표는 워커가 캐시하므로 덮지 않는다.
  const solvedTargets = new Set();
  let solveShown = false;
  function showBusy(key) {
    if (solvedTargets.has(key)) return;
    solveShown = true;
    busyOn('확률을 푸는 중', '이 목표는 처음이라 한 번만 오래 걸립니다');
  }
  function clearBusy(key) {
    if (key) solvedTargets.add(key);
    if (solveShown) { solveShown = false; busyOff(); }
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
      row.className = 'row stat';
      // 게임 화면이 수치마다 다른 색 다이아를 쓴다. 같은 색이어야 대조가 빠르다.
      row.dataset.k = key;
      const dia = document.createElement('i');
      dia.className = 'dia';
      row.appendChild(dia);
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
  // 목표가 전부 1 이면 조건이 없어서 답 대신 "목표를 정하세요" 만 뜬다. 첫 화면이
  // 비어 있는 것보다 가장 흔한 목표를 걸어두고 사용자가 바꾸게 하는 편이 낫다.
  $('tgt_will').value = '5';
  $('tgt_point').value = '5';

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
    // 화면에 띄운 젬과 같은 색이어야 헷갈리지 않는다. 강조색 전체가 여기서 갈린다.
    document.body.dataset.gem = s.point === '질서 포인트' ? 'order' : 'chaos';
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

  // ---- 접이식 패널 요약 -----------------------------------------------------

  /*
   * 젬 상태와 항목 4개는 이제 전부 자동으로 채워지므로 평소에는 접어 둔다.
   * 다만 접혀 있어도 무엇이 들어갔는지는 한 줄로 계속 보여야 한다 - 안 보이면
   * 잘못 읽은 값으로 계산된 답을 그대로 믿게 된다("조용히 틀리지 않는다").
   */
  const GRADE_KO = { 5: '고급', 7: '희귀', 9: '영웅' };
  const COST_KO = { '-1': '비용 -100%', 0: '', 1: '비용 +100%' };

  function renderGemSummary() {
    const s = readSlots();
    const st = readState();
    const names = { will: '의지', point: s.point.replace(' 포인트', ''), opt1: s.opt1, opt2: s.opt2 };
    const bits = [
      GRADE_KO[$('grade').value],
      STATS.map(({ key }) => `${names[key]} ${st[key]}`).join(' / '),
      `가공 ${st.n}회`,
      `리롤 ${st.r}회`,
      COST_KO[String(st.cost)],
    ];
    if ($('gemSummary')) $('gemSummary').textContent = bits.filter(Boolean).join(' · ');
    // 젬 포인트 = 네 수치의 합. 화면에 적힌 값과 눈으로 대조하라고 같이 보여준다.
    if ($('gemPointSum')) {
      $('gemPointSum').textContent = String(STATS.reduce((a, { key }) => a + st[key], 0));
    }
  }

  function renderPickSummary() {
    // 요약 span 은 HTML 에서 빠질 수 있다. 없으면 조용히 넘어간다.
    const el = $('pickSummary');
    if (!el) return;
    const texts = picks.map((sel) => (sel.value && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : null));
    const n = texts.filter(Boolean).length;
    if (n === 4) el.textContent = texts.join(' / ');
    else if (n) el.textContent = `${n}/4 만 채웠다 - 나머지는 직접 고르세요`;
    else el.textContent = '';
  }

  /**
   * 접이식 패널에 문제 표시를 달고, 문제가 새로 생긴 순간에만 펼친다.
   * 매번 펼치면 자동 갱신이 도는 동안 사용자가 접어도 계속 다시 열려서 못 쓴다.
   */
  function markFold(id, level) {
    const el = $(id);
    const was = el.dataset.flagged || '';
    el.classList.toggle('attention', level === 'attention');
    el.classList.toggle('bad', level === 'bad');
    if (level && level !== was) el.open = true;
    el.dataset.flagged = level || '';
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
      renderGemSummary();
      renderPickSummary();

      if (!Object.keys(target).length) {
        clearBusy(null);
        $('result').hidden = true;
        setNote('목표를 정하세요', '전부 1 이면 아무 조건이 없어서 확률이 항상 100% 입니다.');
        return;
      }

      const solveKey = JSON.stringify(target) + '|' + maxAttempts;
      showBusy(solveKey);
      const res = await ask('evaluate', {
        state, target, maxAttempts, picks: readPicks(), slots: readSlots(),
      });
      clearBusy(solveKey);
      render(state, res);
    } catch (err) {
      solveShown = false;
      busyReset();
      setNote('계산 실패', err.message, 'error');
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

  // ---- 화면에서 읽기 -------------------------------------------------------

  const grabCanvas = document.createElement('canvas');
  const grabCtx = grabCanvas.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let autoTimer = null;
  let atlasReady = false;
  let reading = false;
  // 배율 탐색이 끝나면 읽기가 60ms 라 계속 읽어도 부담이 없다. 사람이 버튼을 누르는
  // 간격보다 촘촘하면 그만이다.
  const AUTO_MS = 700;
  let lastScale = null;
  let lastChangeAt = 0;
  let liveKind = null;
  // 배율 탐색 안내를 이미 띄웠는가. 가공 화면이 안 보이면 자동 갱신이 0.7초마다
  // 실패하는데, 그때마다 화면을 덮으면 아무것도 못 누르는 상태로 갇힌다.
  let searchAnnounced = false;

  // 공유 전 안내 문구. HTML 에 적힌 것을 그대로 쓴다 - 문구는 거기서 고치면 된다.
  const IDLE_LIVE = $('liveState').textContent;

  function setCapture(text, kind) {
    const el = $('captureStatus');
    el.textContent = text;
    el.className = 'capture-status' + (kind ? ' ' + kind : '');
    // 문제가 있을 때만 접힌 채로 알린다. 잘 읽히는 중에는 비어 있는 게 맞다.
    $('readSummary').textContent = kind ? String(text).split('\n')[0] : '';
    markFold('foldRead', kind === 'bad' ? 'bad' : '');
  }

  /** 공유 줄 한 줄. 지금 살아 있는지, 화면이 바뀌었는지만 말한다. */
  function renderLive() {
    const el = $('liveState');
    let text;
    // 대기 문구는 HTML 에 적힌 것을 그대로 쓴다. 사용자가 거기서 고칠 수 있어야 한다.
    if (!atlasReady || !stream) text = IDLE_LIVE;
    else if (lastScale == null) text = '가공 화면을 찾는 중입니다. 처음 한 번은 2초쯤 걸립니다.';
    else {
      const sec = Math.round((Date.now() - lastChangeAt) / 1000);
      text = `${autoTimer ? '자동으로 읽는 중' : '자동 꺼짐'} · 배율 ${lastScale} · `
        + (sec < 2 ? '방금 갱신' : `${sec}초째 그대로`);
    }
    el.textContent = text;
    el.className = 'live-state' + (liveKind ? ' ' + liveKind : '');
  }

  /** 이미지/비디오 한 장을 회색조로. 워커로 넘길 수 있게 Float32Array 로 만든다. */
  function toGray(source, w, h) {
    grabCanvas.width = w;
    grabCanvas.height = h;
    grabCtx.drawImage(source, 0, 0, w, h);
    const { data } = grabCtx.getImageData(0, 0, w, h);
    const g = new Float32Array(w * h);
    for (let i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
    }
    return { width: w, height: h, data: g };
  }

  async function readImage(image, label, quiet) {
    if (!atlasReady || reading) return;
    reading = true;
    // 배율을 모르면 탐색이 붙어 몇 초 걸린다. 아는 상태의 읽기는 60ms 라 덮지 않는다.
    // 자동 갱신은 한 번만 알린다. 직접 누른 읽기는 언제나 알린다.
    const slow = lastScale == null && (!quiet || !searchAnnounced);
    if (slow) { searchAnnounced = true; busyOn('가공 화면을 찾는 중', '처음 한 번만 오래 걸립니다'); }
    try {
      // 자동 갱신은 상태줄을 건드리지 않는다. 0.7초마다 "읽는 중"으로 깜빡이면
      // 정작 읽어낸 내용을 읽을 수가 없다.
      if (!quiet) setCapture((label || '읽는 중') + '...');
      // 회색조 버퍼는 수 MB 라 복사하지 않고 소유권을 넘긴다.
      const res = await ask('read', { image, slots: readSlots() }, [image.data.buffer]);
      await applyWithAutofill(res, quiet);
    } catch (err) {
      setCapture('읽기 실패: ' + err.message, 'bad');
      liveKind = 'bad';
    } finally {
      reading = false;
      if (slow) busyOff();
      renderLive();
    }
  }

  /**
   * 화면에서 읽은 효과 이름을 비어 있는 "1번/2번 효과 이름" 칸에 넣는다.
   * 어느 쪽이 1번인지는 옵션 목록만 봐서는 알 수 없다. 확률 표에서 두 효과는 완전히
   * 대칭이라 바뀌어도 계산은 같지만, 목표를 1번/2번으로 나눠 잡을 때는 달라진다.
   * 그래서 채워 넣되 바꿀 수 있게 알려준다.
   * @returns {{slot:string,name:string}[]} 실제로 채운 것들
   */
  function autofillEffectNames(res) {
    const known = new Set([$('name_opt1').value.trim(), $('name_opt2').value.trim()].filter(Boolean));
    const found = [];
    for (const o of res.options) {
      if (!o.labelText || o.slot || o.special) continue; // 이미 아는 수치이거나 특수 항목
      if (known.has(o.labelText) || found.includes(o.labelText)) continue;
      found.push(o.labelText);
    }
    const filled = [];
    for (const name of found) {
      const empty = ['name_opt1', 'name_opt2'].find((id) => !$(id).value.trim());
      if (!empty) break;
      $(empty).value = name;
      filled.push({ slot: empty === 'name_opt1' ? '1번' : '2번', name });
    }
    return filled;
  }

  const POS_KO = { top: '의지력', left: '왼쪽 효과', right: '오른쪽 효과', bottom: '포인트' };

  /**
   * 좌/우 다이아를 1번/2번 효과 칸에 배정한다.
   *
   * 다이아의 이름이 이 젬의 현재 효과 이름이다 - 화면이 진실이므로 입력칸이 다르면
   * 입력칸을 고친다. "효과 변경" 이 뜨면 효과 이름 자체가 바뀌는데(공격력 -> 보스 피해),
   * 예전에는 칸이 비어 있을 때만 채워서 옛 이름이 그대로 남았고 그 뒤로 아무것도
   * 매칭되지 않았다.
   *
   * 배정 규칙: **아직 남아 있는 이름은 자기 칸을 지킨다.** 그래야 바뀐 효과만 갈리고
   * 사용자가 정해둔 1번/2번 구분(목표를 그 기준으로 잡는다)이 흔들리지 않는다.
   */
  function assignEffectSlots(gem) {
    const names = { opt1: $('name_opt1').value.trim(), opt2: $('name_opt2').value.trim() };
    const out = {};
    const used = new Set();

    for (const pos of ['left', 'right']) {
      const t = gem[pos] && gem[pos].confident ? gem[pos].labelText : null;
      if (!t) continue;
      for (const slot of ['opt1', 'opt2']) {
        if (!used.has(slot) && names[slot] === t) { out[pos] = slot; used.add(slot); break; }
      }
    }
    for (const pos of ['left', 'right']) {
      const t = gem[pos] && gem[pos].confident ? gem[pos].labelText : null;
      if (!t || out[pos]) continue;
      const free = ['opt1', 'opt2'].find((s) => !used.has(s));
      if (free) { out[pos] = free; used.add(free); }
    }
    return out;
  }

  /**
   * 다이아에서 읽은 현재 수치를 입력칸에 넣는다. 의심 표시된 자리는 건드리지 않는다 -
   * 조용히 틀린 값을 넣는 것보다 사람이 한 번 보는 게 낫다.
   */
  function applyGemState(res) {
    const out = { filled: [], skipped: [], slotsChanged: false, renamed: [] };
    if (!res.found || !res.gem) return out;

    const slotOf = assignEffectSlots(res.gem);

    for (const pos of ['top', 'left', 'right', 'bottom']) {
      const g = res.gem[pos];
      if (!g || !g.slot) continue;
      // 못 채웠어도 무엇으로 읽었는지는 보여준다. 안 보여주면 사용자가 왜 안 채워졌는지
      // 알 수 없고, 이상하게 읽는 화면을 나중에 재현할 수도 없다.
      if (!g.confident) {
        const guess = g.labelText ? `${g.labelText} ${g.value == null ? '?' : g.value}` : '?';
        out.skipped.push(`${POS_KO[pos]}: ${guess} 로 읽었지만 확실치 않음`);
        continue;
      }

      let slot = g.slot;
      if (slot === 'opt1' || slot === 'opt2') {
        slot = slotOf[pos];
        if (!slot) { out.skipped.push(`${POS_KO[pos]} "${g.labelText}" (효과 칸 배정 실패)`); continue; }
        const input = $('name_' + slot);
        if (input.value.trim() !== g.labelText) {
          if (input.value.trim()) out.renamed.push(`${input.value.trim()} -> ${g.labelText}`);
          input.value = g.labelText;
          out.slotsChanged = true;
        }
      }
      // 아래 다이아의 이름이 젬 계열(혼돈/질서)을 알려준다.
      if (slot === 'point' && g.labelText && $('gemType').value !== g.labelText) {
        $('gemType').value = g.labelText;
        out.slotsChanged = true;
      }
      $('cur_' + slot).value = String(g.value);
      out.filled.push(`${g.labelText} ${g.value}`);
    }
    return out;
  }

  /**
   * 리롤/가공 횟수를 입력칸에 넣는다. 전체 횟수(M)가 등급을 알려주므로 등급까지 맞춘다.
   * 다이아처럼 의심 표시된 값은 건드리지 않는다.
   */
  function applyMeta(res) {
    const out = { filled: [], skipped: [] };
    if (!res.found || !res.meta) return out;
    const m = res.meta;

    if (m.attemptsMax && m.attemptsMax.confident && ['5', '7', '9'].includes(String(m.attemptsMax.value))) {
      const grade = String(m.attemptsMax.value);
      if ($('grade').value !== grade) {
        $('grade').value = grade;
        fillRange($('attempts'), 0, +grade, +grade);
      }
    } else if (m.attemptsMax) {
      out.skipped.push('등급 (확실치 않음)');
    }

    if (m.attemptsLeft && m.attemptsLeft.confident && m.attemptsLeft.value <= +$('grade').value) {
      $('attempts').value = String(m.attemptsLeft.value);
      out.filled.push(`남은 가공 ${m.attemptsLeft.value}회`);
    } else if (m.attemptsLeft) {
      out.skipped.push('남은 가공 (확실치 않음)');
    }

    if (m.reroll && m.reroll.confident) {
      $('rerolls').value = String(m.reroll.value);
      out.filled.push(`리롤 ${m.reroll.value}회`);
    } else if (m.reroll) {
      out.skipped.push('리롤 (확실치 않음)');
    }

    // 비용은 화면의 금액을 배율로 뒤집은 값이다. 아는 금액이 아니면 reader 가 null 을
    // 주므로(예: 아직 표본이 없는 +100%) 그때는 조용히 손대지 않는다.
    if (m.cost && m.cost.confident) {
      const COST_KO = { '-1': '-100%', 0: '기본', 1: '+100%' };
      $('cost').value = String(m.cost.mod);
      out.filled.push(`가공 비용 ${COST_KO[m.cost.mod]}`);
    } else if (m.cost) {
      out.skipped.push('가공 비용 (확실치 않음)');
    }
    return out;
  }

  /** 자동 입력 결과를 읽기 상태줄 밑에 덧붙인다. */
  function noteGemState(gem) {
    if (!gem.filled.length && !gem.skipped.length) return;
    const lines = [];
    if (gem.filled.length) lines.push('현재 수치 자동 입력: ' + gem.filled.join(' · '));
    if (gem.skipped.length) lines.push('그대로 둠: ' + gem.skipped.join(', '));
    $('captureStatus').textContent += '\n' + lines.join('\n');
  }

  function applyReading(res) {
    if (!res.found) {
      setCapture(res.reason + '\n가공 화면이 보이는 상태인지 확인하세요.', 'warn');
      lastScale = null;
      liveKind = 'warn';
      renderLive();
      return;
    }

    const read = res.options.map((o, i) =>
      `${i + 1} ${o.labelText || '?'} / ${o.valueText || '?'}${o.confident ? '' : ' (확인 필요)'}`);

    if (res.picks) {
      // 지금 입력한 젬 수치에서는 나올 수 없는 항목이면 목록에 아예 없다.
      // 예를 들어 "의지력 효율 +4 증가" 는 의지력이 1 일 때만 뜬다. 이런 항목이 화면에
      // 보인다는 건 화면과 입력한 수치가 어긋났다는 뜻이라 조용히 넘기면 안 된다.
      const missing = [];
      res.picks.forEach((id, i) => {
        const opt = picks[i].querySelector(`option[value="${CSS.escape(id)}"]`);
        if (opt) picks[i].value = id;
        else missing.push(`열${i + 1} ${res.options[i].labelText} / ${res.options[i].valueText}`);
      });

      if (missing.length) {
        $('pickStatus').hidden = false;
        $('pickStatus').className = 'capture-status bad';
        $('pickStatus').textContent =
          '화면에 보이는데 지금 입력한 젬 상태에서는 나올 수 없는 항목이 있습니다.\n' +
          missing.join('\n') +
          '\n왼쪽 수치가 화면과 같은지 확인하세요 (예: "+4 증가" 는 그 수치가 1 일 때만 뜹니다).';
      } else {
        $('pickStatus').hidden = true;
      }
      markFold('foldPicks', missing.length ? 'bad' : '');

      setCapture(
        `읽음 (배율 ${res.scale}, 앵커 ${res.anchorScore.toFixed(2)}, ${res.ms}ms)\n` + read.join('\n'),
        missing.length ? 'warn' : null
      );
      liveKind = missing.length ? 'warn' : null;
      renderLive();
      refresh();
      return;
    }

    // 4개를 다 알아내지 못했으면 아무것도 채우지 않는다. 셋만 넣으면 오히려 헷갈린다.
    // 다만 아래 결과는 반드시 다시 계산한다 - 안 그러면 방금 자동 입력한 수치·횟수가
    // 반영되지 않은 옛 판단이 그대로 남아서, 화면과 다른 확률을 보고 판단하게 된다.
    // 알아낸 열만 채우고 나머지는 비운다. 안 비우면 이전 화면의 선택이 남아서
    // 지금 화면과 무관한 판단이 아래에 뜬다 (실측: 젬을 바꿔도 옛 확률이 그대로였다).
    (res.resolved || []).forEach((id, i) => {
      const opt = id && picks[i].querySelector(`option[value="${CSS.escape(id)}"]`);
      picks[i].value = opt ? id : '';
    });

    // 채웠는데 애매한 것과 아예 못 채운 것은 사용자가 할 일이 다르다.
    // 앞은 "맞는지 봐 주세요", 뒤는 "직접 고르세요" 다.
    const filled = (res.resolved || []).filter(Boolean).length;
    const names = res.problems.map((p) => `열${p.column}: ${p.reason}`);
    $('pickStatus').hidden = false;
    $('pickStatus').className = 'capture-status warn';
    $('pickStatus').textContent = (filled === 4
      ? '4개 다 채웠지만 확실하지 않은 항목이 있습니다. 화면과 같은지 봐 주세요.\n'
      : '항목 4개 중 자동으로 못 채운 게 있어 그 칸은 비워 뒀습니다.\n') + names.join('\n')
      + '\n위 결과는 지금 입력된 값 기준입니다.';
    markFold('foldPicks', filled === 4 ? 'attention' : 'bad');
    setCapture(`읽음 (배율 ${res.scale}, ${res.ms}ms)\n` + read.join('\n'), 'warn');
    liveKind = 'warn';
    renderLive();
    refresh();
  }

  /*
   * 이번에 읽어낸 내용의 지문. 화면이 그대로면 입력칸을 다시 건드릴 이유가 없다.
   *
   * 자동 갱신이 0.7초마다 도는데 매번 덮어쓰면 사용자가 손으로 고친 값이 다음 틱에
   * 그대로 뭉개진다. 인식이 애매해서 사람이 고쳐 넣는 경우가 바로 그 상황이라
   * 하필 제일 필요할 때 못 쓰게 된다. 그래서 "화면이 실제로 바뀌었을 때만" 반영한다.
   */
  function readingKey(res) {
    if (!res.found) return 'none:' + res.reason;
    const parts = [];
    for (const p of ['top', 'left', 'right', 'bottom']) {
      const g = res.gem && res.gem[p];
      parts.push(g ? `${g.labelText}=${g.value}${g.confident ? '' : '?'}` : '-');
    }
    const m = res.meta;
    const v = (x) => (x ? `${x.value}${x.confident ? '' : '?'}` : '-');
    parts.push(m ? `n${v(m.attemptsLeft)}/${v(m.attemptsMax)} r${v(m.reroll)} c${m.cost ? m.cost.mod : '-'}` : '-');
    for (const o of res.options) parts.push(`${o.labelText}|${o.valueText}|${o.confident ? 1 : 0}`);
    return parts.join(';');
  }

  let lastKey = null;

  /** 읽고 -> 다이아로 현재 수치·이름을 채우고 -> 모르는 효과 이름이면 채우고 -> 다시 해석한다. */
  async function applyWithAutofill(res, quiet) {
    const key = readingKey(res);
    // 수동 읽기는 지문이 같아도 다시 적용한다. 사용자가 뭔가 꼬였다고 느꼈을 때
    // 강제로 되돌릴 수단이 하나는 있어야 한다.
    if (quiet && key === lastKey) return;
    lastKey = key;
    lastChangeAt = Date.now();
    if (res.found) { lastScale = res.scale; searchAnnounced = false; }

    if (!res.found) { applyReading(res); return; }

    // 다이아가 젬 계열이나 효과 이름을 바꿨으면 옵션 4개를 그 이름으로 다시 해석한다.
    const gem = applyGemState(res);
    const meta = applyMeta(res);
    gem.filled.push.apply(gem.filled, meta.filled);
    gem.skipped.push.apply(gem.skipped, meta.skipped);
    // 효과가 바뀌면("효과 변경") 이름 칸도 따라 바뀐다. 조용히 바꾸면 목표를 1번/2번으로
    // 나눠 잡은 사용자가 눈치채지 못하므로 알린다.
    if (gem.renamed && gem.renamed.length) {
      gem.filled.push(`효과 이름 갱신: ${gem.renamed.join(', ')}`);
    }
    // 젬 포인트 검산 결과. 복구된 값은 이미 confident 로 채워져 있다.
    if (res.sumCheck && res.sumCheck.status === 'recovered') {
      gem.filled.push(`(${POS_KO[res.sumCheck.pos]}는 젬 포인트 합으로 보정)`);
    }
    // 네 자리가 전부 "배경판이 안 맞아서" 막힌 경우는 원인이 하나다 - 이 화면의 출처가
    // 아틀라스에 없는 것이다. 값을 하나씩 고치라고 하는 것보다 프레임을 받는 게 빠르다.
    const noisy = ['top', 'left', 'right', 'bottom']
      .filter((p) => res.gem && res.gem[p] && res.gem[p].scores.bgNoise > 0.2);
    if (noisy.length === 4) {
      gem.skipped.length = 0;
      gem.skipped.push('현재 수치 4개 전부: 이 화면 출처의 표본이 없어 숫자를 못 믿습니다.'
        + ' "이 화면 저장" 을 눌러 나온 PNG 를 몇 장 모아 주면 읽을 수 있게 됩니다.');
    }
    let gemLevel = gem.skipped.length ? 'attention' : '';
    if (noisy.length === 4) gemLevel = 'bad';
    if (res.sumCheck && res.sumCheck.status === 'mismatch') {
      gem.skipped.push(`수치 합 ${res.sumCheck.sum} 인데 화면의 젬 포인트는 ${res.sumCheck.gemPoint}`
        + ' - 네 수치를 직접 확인하세요');
      gemLevel = 'bad';
    }
    markFold('foldGem', gemLevel);
    if (gem.slotsChanged) {
      syncStatLabels();
      res = Object.assign(
        { scale: res.scale, ms: res.ms, anchorScore: res.anchorScore, gem: res.gem },
        await ask('resolve', { slots: readSlots() })
      );
    }

    applyReading(res);
    noteGemState(gem);
    if (res.picks) return;

    const filled = autofillEffectNames(res);
    if (!filled.length) return;

    syncStatLabels();
    const again = await ask('resolve', { slots: readSlots() });
    applyReading(Object.assign({ scale: res.scale, ms: res.ms, anchorScore: res.anchorScore }, again));
    noteGemState(gem);
    if (again.picks) {
      $('pickStatus').hidden = false;
      $('pickStatus').className = 'capture-status';
      $('pickStatus').textContent =
        '효과 이름을 화면에서 읽어 채웠습니다: ' +
        filled.map((f) => `${f.slot} "${f.name}"`).join(', ') +
        '\n어느 쪽이 1번인지는 옵션 목록만으로는 알 수 없습니다. 다르면 두 칸을 바꿔 주세요.';
    }
  }

  async function grabAndRead(label, quiet) {
    const v = $('preview');
    if (!v.videoWidth) { if (!quiet) setCapture('아직 영상이 안 들어왔습니다.', 'warn'); return; }
    await readImage(toGray(v, v.videoWidth, v.videoHeight), label, quiet);
  }

  function startAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => grabAndRead(null, true), AUTO_MS);
  }

  function stopShare() {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    clearInterval(autoTimer);
    autoTimer = null;
    lastScale = null;
    lastKey = null;
    liveKind = null;
    searchAnnounced = false;
    $('preview').hidden = true;
    $('preview').srcObject = null;
    $('shareBtn').textContent = '화면 공유 시작';
    $('shareBtn').classList.remove('on');
    $('readBtn').disabled = true;
    $('saveFrameBtn').disabled = true;
    $('autoRead').disabled = true;
    renderLive();
  }

  $('shareBtn').addEventListener('click', async () => {
    if (stream) { stopShare(); setCapture('공유를 껐습니다.'); return; }
    try {
      // 30fps 로 받을 이유가 없다. 화면이 바뀔 때만 읽으면 되고 인식이 프레임당 수십 ms 다.
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      const v = $('preview');
      v.srcObject = stream;
      v.hidden = false;
      await v.play();
      // 사용자가 브라우저 UI 로 공유를 끄는 경우도 있다.
      stream.getVideoTracks()[0].addEventListener('ended', () => { stopShare(); setCapture('공유가 끝났습니다.'); });

      $('shareBtn').textContent = '공유 끄기';
      $('shareBtn').classList.add('on');
      $('readBtn').disabled = false;
      $('saveFrameBtn').disabled = false;
      $('autoRead').disabled = false;
      $('autoRead').checked = true;
      // 창 크기가 바뀌면 배율도 바뀐다. 캐시를 비우고 처음부터 찾게 한다.
      lastScale = null;
      lastKey = null;
      searchAnnounced = false;
      await ask('forgetScale', {});
      // 들어오는 프레임 크기를 보여준다. 창모드 공유나 브라우저 다운스케일 때문에
      // 게임 해상도와 다른 경우가 많고, 그 차이가 인식 실패의 흔한 원인이다.
      setCapture(`공유 중 (${v.videoWidth}x${v.videoHeight}). 가공 화면을 띄우면 알아서 읽습니다.`
        + '\n처음 한 번은 배율을 찾느라 2초쯤 걸립니다.');
      renderLive();
      startAuto();
    } catch (err) {
      stopShare();
      setCapture(err.name === 'NotAllowedError' ? '공유를 취소했습니다.' : '공유 실패: ' + err.message,
        err.name === 'NotAllowedError' ? null : 'bad');
    }
  });

  $('readBtn').addEventListener('click', () => grabAndRead());

  /*
   * 공유 화면 한 프레임을 그대로 PNG 로 내려받는다.
   *
   * 게임의 스크린샷 폴더 파일과 이 프레임은 같은 화면이어도 픽셀이 다르다 - 창모드
   * 크기와 브라우저 다운스케일을 거치기 때문이다. 다이아 숫자는 글자가 3~12px 라
   * 그 차이에 그대로 무너진다(README "같은 문자열이라도 템플릿을 여러 개 둔다").
   * 그래서 실제로 읽히는 프레임 자체를 표본으로 받을 방법이 필요하다.
   */
  $('saveFrameBtn').addEventListener('click', () => {
    const v = $('preview');
    if (!v.videoWidth) { setCapture('아직 영상이 안 들어왔습니다.', 'warn'); return; }
    grabCanvas.width = v.videoWidth;
    grabCanvas.height = v.videoHeight;
    grabCtx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight);
    grabCanvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `share-${v.videoWidth}x${v.videoHeight}-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      setCapture(`프레임을 저장했습니다 (${v.videoWidth}x${v.videoHeight}). 다운로드 폴더를 보세요.`, 'ok');
    }, 'image/png');
  });

  $('autoRead').addEventListener('change', (e) => {
    clearInterval(autoTimer);
    autoTimer = null;
    if (e.target.checked) startAuto();
    renderLive();
  });

  // 파일을 끌어다 놓아도 읽는다. 공유가 안 될 때 확인용으로도 쓴다.
  let dragDepth = 0;
  document.addEventListener('dragenter', (e) => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return;
    if (++dragDepth === 1) document.body.classList.add('dragging');
  });
  document.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;

    const img = new Image();
    img.src = URL.createObjectURL(file);
    try {
      await img.decode();
      // 파일마다 해상도가 다를 수 있으므로 배율을 다시 찾게 한다.
      lastScale = null;
      searchAnnounced = false;
      await ask('forgetScale', {});
      await readImage(toGray(img, img.naturalWidth, img.naturalHeight), file.name + ' 읽는 중');
    } catch (err) {
      setCapture('이미지를 열지 못했습니다: ' + err.message, 'bad');
    } finally {
      URL.revokeObjectURL(img.src);
    }
  });

  (async () => {
    try {
      busyOn('준비하는 중', '');
      const atlas = await GempagoAtlasBrowser.load('vision/templates');
      await ask('atlas', { atlas });
      atlasReady = true;
      busyOff();
    } catch (err) {
      busyReset();
      setCapture('템플릿을 불러오지 못했습니다: ' + err.message, 'bad');
      liveKind = 'bad';
    }
    renderLive();
  })();

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
  renderLive();
  refresh();

  // 자동 갱신이 도는 동안 "몇 초째 화면 그대로" 가 멈춰 있으면 죽은 화면처럼 보인다.
  setInterval(() => { if (stream) renderLive(); }, 1000);
})();
