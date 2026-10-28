(function () {
  'use strict';
  var C = window.C, h = C.h, CATS = C.CATS, post = C.post;
  var root = document.getElementById('app');
  var MAX_CARDS = 14;

  var pid = null;
  try { pid = localStorage.getItem('pid'); } catch (e) { /* 저장 불가 */ }
  if (!pid) {
    pid = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('p' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    try { localStorage.setItem('pid', pid); } catch (e) { /* 저장 불가 */ }
  }

  var S = {
    state: 'boot', group: null, others: 0, conn: true,
    deck: {}, deckSig: '', inbox: [], outbox: [],
    cat: 'subject', tray: [], sending: false, msg: '', kind: ''
  };
  var R = {};
  var es = null;

  function sentence() { return S.tray.map(function (c) { return c.text; }).join(' '); }
  function setStatus(msg, kind) { S.msg = msg; S.kind = kind || ''; if (R.status) { R.status.textContent = msg; R.status.className = 'status ' + (kind || ''); } }

  /* ---------- 접속 ---------- */
  function join() {
    S.state = 'joining'; paintHeader();
    post('/api/join', { clientId: pid }).then(function (r) {
      if (r.ok) { S.group = r.body.group; S.state = 'ready'; openStream(); paintAll(); }
      else { S.state = 'error'; paintHeader(); setTimeout(join, 3000); }
    }).catch(function () { S.state = 'error'; paintHeader(); setTimeout(join, 3000); });
  }
  function openStream() {
    if (es) es.close();
    es = new EventSource('/api/stream?clientId=' + encodeURIComponent(pid));
    es.onmessage = function (ev) {
      var d;
      try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.type === 'reset') {
        es.close(); es = null; S.group = null; S.tray = []; S.state = 'boot';
        paintHeader(); setTimeout(join, 400);
        return;
      }
      if (d.type === 'state') {
        S.group = d.group; S.others = d.others; S.inbox = d.inbox; S.outbox = d.outbox;
        S.conn = true; S.state = 'ready';
        var sig = JSON.stringify(d.deck);
        var deckChanged = sig !== S.deckSig;
        S.deck = d.deck; S.deckSig = sig;
        paintHeader(); paintTray(); paintInbox();
        if (deckChanged) { paintCats(); paintDeck(); }
      }
    };
    es.onerror = function () {
      if (es && es.readyState === 2) { es.close(); es = null; S.state = 'boot'; paintHeader(); setTimeout(join, 1500); }
      else { S.conn = false; paintHeader(); }
    };
  }

  /* ---------- 화면 ---------- */
  function build() {
    R.sub = h('p', { class: 'sub' });
    R.badge = h('div', { class: 'stamp' });
    R.notice = h('div', { class: 'notice', hidden: true });
    R.cats = h('div', { class: 'cats', role: 'group', 'aria-label': '단어 카드 종류' });
    R.hint = h('p', { class: 'hint' });
    R.deck = h('div', { class: 'deck' });
    R.main = h('section', null, R.cats, R.hint, h('div', { style: 'height:12px' }), R.deck);
    R.chips = h('div', { class: 'chips' });
    R.say = h('p', { class: 'say' });
    R.status = h('div', { class: 'status', 'aria-live': 'polite' });
    R.clear = h('button', { class: 'btn', type: 'button', onclick: function () { S.tray = []; setStatus('', ''); paintTray(); } }, '모두 지우기');
    R.send = h('button', { class: 'btn primary', type: 'button', onclick: submit }, '프로포즈 보내기');
    R.tray = h('section', { class: 'tray', 'aria-label': '내가 만든 문장' },
      h('div', { class: 'tray-label' }, '내가 만든 문장'), R.chips, R.say,
      h('div', { class: 'tray-actions' }, R.send, R.clear, R.status));
    R.inbox = h('div', { class: 'two' });
    root.replaceChildren(
      h('header', { class: 'top' }, h('div', null, h('h1', { text: '프로포즈 대작전' }), R.sub), h('div', { class: 'headright' }, R.badge)),
      R.notice, R.main, R.tray, R.inbox
    );
    paintAll();
  }
  function paintAll() { paintHeader(); paintCats(); paintDeck(); paintTray(); paintInbox(); }

  function paintHeader() {
    var ready = S.state === 'ready' && S.group;
    R.notice.hidden = true; R.notice.replaceChildren();
    R.main.hidden = !ready; R.tray.hidden = !ready; R.inbox.hidden = !ready;
    if (ready) {
      R.badge.hidden = false;
      R.badge.textContent = S.group + '조';
      R.sub.textContent = S.conn
        ? '단어 카드를 이어 붙여 프로포즈 문장을 만들어요. 지금 접속한 다른 조는 ' + S.others + '개예요.'
        : '연결이 잠깐 끊겼어요. 다시 연결하는 중이에요…';
      return;
    }
    R.badge.hidden = true;
    R.sub.textContent = '학급 프로포즈 활동';
    R.notice.hidden = false;
    var msg = S.state === 'error' ? '서버에 연결하지 못했어요. 잠시 뒤에 자동으로 다시 시도해요.' : '조 번호를 받는 중이에요. 접속한 순서대로 정해져요.';
    R.notice.append(h('p', { text: msg }));
  }

  function paintCats() {
    R.cats.replaceChildren.apply(R.cats, CATS.map(function (c) {
      return h('button', {
        class: 'cat k' + c.n, type: 'button', 'aria-pressed': String(S.cat === c.key),
        onclick: function () { S.cat = c.key; paintCats(); paintDeck(); }
      }, c.name, h('small', { text: String((S.deck[c.key] || []).length) }));
    }));
    R.hint.textContent = C.catByKey(S.cat).hint;
  }
  function paintDeck() {
    var cat = C.catByKey(S.cat);
    var cards = S.deck[cat.key] || [];
    if (!cards.length) { R.deck.replaceChildren(h('p', { class: 'empty', text: '이 종류의 카드는 아직 없어요. 다른 종류를 눌러 보세요.' })); return; }
    R.deck.replaceChildren.apply(R.deck, cards.map(function (c) {
      return h('button', { class: 'wc k' + cat.n, type: 'button', onclick: function () { addCard(cat, c); } }, c.text);
    }));
  }
  function addCard(cat, c) {
    if (S.tray.length >= MAX_CARDS) { setStatus('카드는 ' + MAX_CARDS + '장까지 쓸 수 있어요.', 'warn'); return; }
    S.tray.push({ text: c.text, n: cat.n });
    setStatus('', '');
    paintTray();
  }
  function moveCard(i, d) {
    var j = i + d;
    if (j < 0 || j >= S.tray.length) return;
    var t = S.tray[i]; S.tray[i] = S.tray[j]; S.tray[j] = t;
    paintTray();
  }
  function paintTray() {
    R.chips.replaceChildren.apply(R.chips, S.tray.map(function (c, i) {
      return h('span', { class: 'chip k' + c.n },
        h('button', { type: 'button', 'aria-label': '앞으로 옮기기', onclick: function () { moveCard(i, -1); } }, '‹'),
        h('span', { text: c.text }),
        h('button', { type: 'button', 'aria-label': '뒤로 옮기기', onclick: function () { moveCard(i, 1); } }, '›'),
        h('button', { type: 'button', 'aria-label': '카드 빼기', onclick: function () { S.tray.splice(i, 1); paintTray(); } }, '×'));
    }));
    if (S.tray.length) { R.say.textContent = sentence(); R.say.className = 'say'; }
    else { R.say.textContent = '아래 카드를 눌러 문장을 만들어 보세요. 카드는 2장 이상 필요해요.'; R.say.className = 'say ph'; }
    var noTarget = S.others === 0;
    R.send.disabled = S.sending || S.tray.length < 2 || noTarget;
    R.clear.disabled = !S.tray.length;
    if (!S.msg && S.tray.length >= 2 && noTarget) { R.status.textContent = '지금 접속한 다른 조가 없어요.'; R.status.className = 'status warn'; }
    else { R.status.textContent = S.msg; R.status.className = 'status ' + S.kind; }
  }

  function submit() {
    if (S.sending || S.tray.length < 2) return;
    S.sending = true; paintTray();
    post('/api/submit', { clientId: pid, words: S.tray.map(function (c) { return c.text; }) }).then(function (r) {
      S.sending = false;
      if (r.ok) { S.tray = []; setStatus(r.body.to + '조에게 프로포즈를 보냈어요!', 'ok'); }
      else if (r.status === 409) setStatus('지금 접속한 다른 조가 없어요. 잠시 뒤에 다시 눌러 보세요.', 'warn');
      else if (r.status === 429) setStatus('너무 빨라요. 잠깐 쉬었다가 다시 눌러 주세요.', 'warn');
      else if (r.status === 410) { setStatus('다시 연결하는 중이에요.', 'warn'); join(); }
      else setStatus('보내지 못했어요. 카드를 확인하고 한 번 더 눌러 주세요.', 'warn');
      paintTray();
    }).catch(function () { S.sending = false; setStatus('보내지 못했어요. 한 번 더 눌러 주세요.', 'warn'); paintTray(); });
  }

  function paintInbox() {
    var inList = S.inbox.length ? h('ul', { class: 'msgs' }, S.inbox.map(function (m) { return C.msgItem(m, 'in'); })) : h('p', { class: 'none', text: '아직 받은 프로포즈가 없어요.' });
    var outList = S.outbox.length ? h('ul', { class: 'msgs' }, S.outbox.map(function (m) { return C.msgItem(m, 'out'); })) : h('p', { class: 'none', text: '아직 보낸 프로포즈가 없어요.' });
    R.inbox.replaceChildren(
      h('div', { class: 'panel' }, h('h2', { text: '우리 조가 받은 프로포즈' }), inList),
      h('div', { class: 'panel' }, h('h2', { text: '우리 조가 보낸 프로포즈' }), outList)
    );
  }

  build();
  join();
})();
