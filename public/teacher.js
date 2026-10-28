(function () {
  'use strict';
  var C = window.C, h = C.h, CATS = C.CATS, post = C.post;
  var root = document.getElementById('app');

  var token = null;
  try { token = sessionStorage.getItem('tt'); } catch (e) { /* 저장 불가 */ }

  var S = { members: [], proposals: [], deck: {}, deckLoaded: false, tTab: 'status', eCat: 'subject', dirty: {}, confirm: '' };
  var R = {};
  var Q = {}, T = {};
  var es = null;

  /* ---------- 로그인 ---------- */
  function showLogin(msg) {
    if (es) { es.close(); es = null; }
    var pin = h('input', { type: 'password', id: 'pin', autocomplete: 'current-password', 'aria-label': '교사 비밀번호', style: 'padding:8px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);min-width:0;flex:1 1 180px' });
    var note = h('p', { class: 'status warn', text: msg || '' });
    function go() {
      note.textContent = '확인하는 중이에요…';
      post('/api/teacher/login', { pin: pin.value }).then(function (r) {
        if (r.ok) { token = r.body.token; try { sessionStorage.setItem('tt', token); } catch (e) { /* 저장 불가 */ } start(); }
        else { note.textContent = '비밀번호가 맞지 않아요.'; pin.select(); }
      }).catch(function () { note.textContent = '서버에 연결하지 못했어요.'; });
    }
    pin.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    root.replaceChildren(
      h('header', { class: 'top' }, h('div', null, h('h1', { text: '프로포즈 대작전' }), h('p', { class: 'sub', text: '교사용 화면' }))),
      h('div', { class: 'notice' },
        h('p', { text: '교사 비밀번호를 입력해 주세요.' }),
        h('div', { class: 'addrow' }, pin, h('button', { class: 'btn primary', type: 'button', onclick: go }, '들어가기')),
        note)
    );
    pin.focus();
  }

  function start() {
    build();
    if (es) es.close();
    es = new EventSource('/api/teacher/stream?token=' + encodeURIComponent(token));
    es.onmessage = function (ev) {
      var d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.type !== 'state') return;
      S.members = d.members; S.proposals = d.proposals;
      CATS.forEach(function (c) {
        if (S.dirty[c.key]) return;
        var x = d.deck[c.key];
        S.deck[c.key] = { cards: x && Array.isArray(x.cards) ? C.clone(x.cards) : [] };
      });
      S.deckLoaded = true;
      paintLive();
      paintEditor(false);
    };
    es.onerror = function () {
      if (es && es.readyState === 2) { try { sessionStorage.removeItem('tt'); } catch (e) { /* 저장 불가 */ } token = null; showLogin('다시 로그인해 주세요.'); }
    };
  }

  /* ---------- 화면 ---------- */
  function build() {
    R = {};
    R.stats = h('div', { class: 'stats' });
    R.groups = h('div');
    R.feed = h('div');
    R.tools = h('div', { class: 'toolbar' });
    R.copyArea = h('div');
    R.live = h('div', { style: 'display:flex;flex-direction:column;gap:22px' }, R.stats, R.tools, R.copyArea, h('div', { class: 'two' }, R.groups, R.feed));
    R.cats = h('div', { class: 'cats', role: 'group', 'aria-label': '카드 종류' });
    R.editor = h('div', { style: 'display:flex;flex-direction:column;gap:14px' });
    R.review = h('div', { style: 'display:flex;flex-direction:column;gap:14px' }, R.cats, R.editor);
    R.tabs = h('div', { class: 'tabs' });
    var studentUrl = location.origin + '/';
    R.link = h('p', { class: 'sub' }, '학생들에게 알려 줄 주소: ', h('b', { text: studentUrl }));
    root.replaceChildren(
      h('header', { class: 'top' }, h('div', null, h('h1', { text: '프로포즈 대작전' }), R.link)),
      R.tabs, R.live, R.review
    );
    paintTabs(); paintLive(); paintEditor(true);
  }
  function paintTabs() {
    R.tabs.replaceChildren(
      h('button', { class: 'tab', type: 'button', 'aria-pressed': String(S.tTab === 'status'), onclick: function () { S.tTab = 'status'; paintTabs(); } }, '활동 현황'),
      h('button', { class: 'tab', type: 'button', 'aria-pressed': String(S.tTab === 'cards'), onclick: function () { S.tTab = 'cards'; paintTabs(); paintEditor(true); } }, '단어 카드 검수')
    );
    R.live.hidden = S.tTab !== 'status';
    R.review.hidden = S.tTab !== 'cards';
  }

  function paintLive() {
    if (!R.stats) return;
    var online = S.members.filter(function (m) { return m.online; }).length;
    R.stats.replaceChildren(
      h('div', { class: 'stat' }, h('b', { text: String(S.members.length) }), h('span', { text: '입장한 조' })),
      h('div', { class: 'stat' }, h('b', { text: String(online) }), h('span', { text: '지금 접속 중' })),
      h('div', { class: 'stat' }, h('b', { text: String(S.proposals.length) }), h('span', { text: '제출된 프로포즈' }))
    );
    var rows = S.members.map(function (m) {
      return h('tr', null,
        h('td', null, h('b', { text: m.group + '조' })),
        h('td', null, h('span', { class: 'dot' + (m.online ? ' on' : '') }), ' ', m.online ? '접속 중' : '나감'),
        h('td', { text: String(m.sent) }), h('td', { text: String(m.received) }));
    });
    R.groups.replaceChildren(
      h('h2', { text: '조별 현황', style: 'margin-bottom:10px' }),
      rows.length
        ? h('div', { class: 'tablewrap' }, h('table', null,
            h('thead', null, h('tr', null, h('th', { text: '조' }), h('th', { text: '상태' }), h('th', { text: '보냄' }), h('th', { text: '받음' }))),
            h('tbody', null, rows)))
        : h('p', { class: 'none', text: '아직 입장한 학생이 없어요. 주소를 학생들에게 알려 주세요.' })
    );
    var feedList = S.proposals.length
      ? h('ul', { class: 'msgs' }, S.proposals.slice(0, 60).map(function (m) { return C.msgItem(m, 'out'); }))
      : h('p', { class: 'none', text: '아직 제출된 문장이 없어요.' });
    R.feed.replaceChildren(h('h2', { text: '실시간 제출 목록', style: 'margin-bottom:10px' }), feedList);
    paintTools();
  }

  function paintTools() {
    var cfm = S.confirm;
    function wipeBtn(kind, label, what) {
      if (cfm === kind) {
        return h('span', { class: 'confirm' }, h('span', { text: what + ' 지울까요?' }),
          h('button', { class: 'btn small danger', type: 'button', onclick: function () { doWipe(kind); } }, '지우기'),
          h('button', { class: 'btn small', type: 'button', onclick: function () { S.confirm = ''; paintTools(); } }, '취소'));
      }
      return h('button', { class: 'btn small danger', type: 'button', onclick: function () { S.confirm = kind; paintTools(); } }, label);
    }
    R.tools.replaceChildren(
      h('button', { class: 'btn small', type: 'button', onclick: copyResults, disabled: !S.proposals.length }, '결과 복사'),
      wipeBtn('proposals', '제출 기록 지우기', '제출 기록을'),
      wipeBtn('all', '새 활동 시작', '제출 기록과 조 번호를 모두')
    );
  }
  function doWipe(kind) {
    S.confirm = ''; paintTools();
    post('/api/teacher/wipe', { kind: kind }, token).then(paintTools);
  }
  function copyResults() {
    var lines = S.proposals.slice().reverse().map(function (p) { return p.from + '조: ' + p.text + ' -> ' + p.to + '조에게'; });
    var text = lines.join('\n');
    function fallback() {
      var ta = h('textarea', { class: 'copybox', readonly: true, id: 'copy-box', 'aria-label': '복사할 결과' });
      ta.value = text;
      R.copyArea.replaceChildren(ta);
      ta.focus(); ta.select();
    }
    try {
      navigator.clipboard.writeText(text).then(function () {
        R.copyArea.replaceChildren(h('p', { class: 'status ok', text: '복사했어요. (' + lines.length + '개)' }));
      }, fallback);
    } catch (e) { fallback(); }
  }
  function downloadDeck() {
    fetch('/api/teacher/deck.json', { headers: { Authorization: 'Bearer ' + token } }).then(function (r) { return r.blob(); }).then(function (b) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = 'deck.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  /* ---------- 카드 검수 ---------- */
  function paintEditor(force) {
    if (!R.editor) return;
    R.cats.replaceChildren.apply(R.cats, CATS.map(function (c) {
      var total = (S.deck[c.key] && S.deck[c.key].cards || []).length;
      return h('button', { class: 'cat k' + c.n, type: 'button', 'aria-pressed': String(S.eCat === c.key),
        onclick: function () { S.eCat = c.key; paintEditor(true); } }, c.name, h('small', { text: String(total) }));
    }));
    if (!force && R.editor.contains(document.activeElement)) return;
    var key = S.eCat, cat = C.catByKey(key);
    var cards = (S.deck[key] && S.deck[key].cards) || [];
    var sig = key + JSON.stringify(cards);
    if (!force && R.edSig === sig) return;
    R.edSig = sig;
    var all = 0, on = 0;
    CATS.forEach(function (c) { var l = (S.deck[c.key] && S.deck[c.key].cards) || []; all += l.length; on += l.filter(function (x) { return x.on !== false; }).length; });

    var rows = cards.map(function (c, i) {
      var cb = h('input', { type: 'checkbox', id: 'on-' + c.id, checked: c.on !== false ? true : null, 'aria-label': '학생에게 보이기' });
      var tx = h('input', { type: 'text', id: 'card-' + c.id, value: c.text, maxlength: '30', 'aria-label': cat.name + ' 카드 글자' });
      var row = h('div', { class: 'edrow k' + cat.n + (c.on === false ? ' off' : '') }, cb, tx,
        h('button', { class: 'xbtn', type: 'button', 'aria-label': '카드 지우기', onclick: function () { cards.splice(i, 1); touch(key, true); paintEditor(true); } }, '지우기'));
      cb.addEventListener('change', function () { c.on = cb.checked; row.classList.toggle('off', !cb.checked); touch(key, true); });
      tx.addEventListener('input', function () { c.text = tx.value; touch(key); });
      tx.addEventListener('blur', function () { flush(key); });
      return row;
    });
    var addIn = h('input', { type: 'text', id: 'add-' + key, maxlength: '30', placeholder: cat.name + ' 카드 새로 만들기', 'aria-label': '새 ' + cat.name + ' 카드' });
    function doAdd() {
      var t = addIn.value.trim();
      if (!t) return;
      if (!S.deck[key]) S.deck[key] = { cards: [] };
      S.deck[key].cards.push({ id: key + '-' + Date.now().toString(36), text: t, on: true });
      touch(key, true); paintEditor(true);
      var next = document.getElementById('add-' + key); if (next) next.focus();
    }
    addIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAdd(); });
    R.editor.replaceChildren(
      h('p', { class: 'hint', style: 'margin:0', text: cat.hint + ' · 체크를 끄면 학생 화면에서 숨겨져요. 전체 ' + all + '장 중 ' + on + '장이 보여요.' }),
      cards.length ? h('div', { class: 'edlist' }, rows) : h('p', { class: 'none', text: '이 종류의 카드가 아직 없어요. 아래에서 만들어 보세요.' }),
      h('div', { class: 'addrow' }, addIn, h('button', { class: 'btn', type: 'button', onclick: doAdd }, '카드 추가')),
      h('div', { class: 'addrow' }, h('button', { class: 'btn small', type: 'button', onclick: downloadDeck }, '카드 전체 내려받기 (deck.json)'),
        h('span', { class: 'none', text: '서버를 다시 켜면 고친 카드는 처음 상태로 돌아가요. 계속 쓰려면 내려받아 deck.json 파일을 바꿔 주세요.' }))
    );
  }
  function touch(key, now) {
    S.dirty[key] = true;
    clearTimeout(T[key]);
    if (now) saveCat(key);
    else T[key] = setTimeout(function () { saveCat(key); }, 700);
  }
  function flush(key) { if (S.dirty[key]) { clearTimeout(T[key]); saveCat(key); } }
  function saveCat(key) {
    var q = Q[key] || (Q[key] = { busy: false, again: false });
    if (q.busy) { q.again = true; return; }
    q.busy = true;
    (function loop() {
      q.again = false;
      post('/api/teacher/deck', { key: key, cards: C.clone((S.deck[key] && S.deck[key].cards) || []) }, token).then(function () {
        if (q.again) loop(); else { q.busy = false; S.dirty[key] = false; }
      }).catch(function () { q.busy = false; S.dirty[key] = false; });
    })();
  }

  if (token) start(); else showLogin('');
})();
