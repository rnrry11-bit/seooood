(function () {
  'use strict';
  var CATS = [
    { key: 'subject', name: '주어', n: 1, hint: '누가 하는지 정해요. 예) 나는, 내 심장이' },
    { key: 'object', name: '목적어', n: 2, hint: '무엇을 하는지 정해요. 예) 너를, 네 웃음을' },
    { key: 'predicate', name: '서술어', n: 3, hint: '문장의 끝맺음이에요. 예) 좋아해, 기다릴게' },
    { key: 'complement', name: '보어', n: 4, hint: '“되다” 앞에 놓는 말이에요. 예) 네 편이, 네 우산이' },
    { key: 'modifier', name: '관형어', n: 5, hint: '명사를 꾸며 줘요. 예) 반짝이는, 달콤한' },
    { key: 'adverbial', name: '부사어', n: 6, hint: '언제, 어떻게를 꾸며 줘요. 예) 진심으로, 오늘부터' },
    { key: 'interjection', name: '독립어', n: 7, hint: '문장 맨 앞에서 부르거나 놀라요. 예) 저기, 짜잔!' }
  ];

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v == null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'value') el.value = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var kids = [].concat(arguments[i]);
      for (var j = 0; j < kids.length; j++) {
        var kid = kids[j];
        if (kid == null || kid === false) continue;
        el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
      }
    }
    return el;
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function catByKey(k) { return CATS.filter(function (c) { return c.key === k; })[0]; }
  function timeText(ts) {
    try { return new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }
  function post(url, body, token) {
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body || {}) }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }
  function msgItem(m, mode) {
    var li = h('li', { class: 'msg' });
    li.append(h('b', { text: m.from + '조' }), String(m.text));
    if (mode === 'out') li.append(' ', h('span', { class: 'to', text: '→ ' + m.to + '조에게' }));
    li.append(h('time', { text: timeText(m.at) }));
    return li;
  }

  // 무료 서버가 쉬지 않도록 열려 있는 화면에서 4분마다 가볍게 신호를 보내요
  setInterval(function () { fetch('/healthz', { cache: 'no-store' }).catch(function () {}); }, 240000);

  window.C = { CATS: CATS, h: h, clone: clone, catByKey: catByKey, timeText: timeText, post: post, msgItem: msgItem };
})();
