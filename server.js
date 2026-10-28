'use strict';
// 프로포즈 대작전: 외부 패키지 없이 Node.js만으로 동작하는 서버
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const TEACHER_PIN = String(process.env.TEACHER_PIN || '0000');
const PUB = path.join(__dirname, 'public');
const CATS = ['subject', 'object', 'predicate', 'complement', 'modifier', 'adverbial', 'interjection'];
const MAX_WORDS = 14;

if (!process.env.TEACHER_PIN) {
  console.warn('[주의] TEACHER_PIN 환경변수가 없어서 교사 비밀번호가 0000 이에요. 배포할 때 꼭 바꿔 주세요.');
}

/* ---------- 상태 (서버를 다시 켜면 초기화돼요) ---------- */
let deck = loadDeck();
const students = new Map();   // clientId -> { group, streams:Set<res>, lastSubmit }
let nextGroup = 1;
let proposals = [];           // { id, from, to, text, at }
let propSeq = 0;
const teacherTokens = new Set();
const teacherStreams = new Set();

function loadDeck() {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'deck.json'), 'utf8'));
  const out = {};
  CATS.forEach(function (k) {
    const d = raw[k] || { label: k, order: CATS.indexOf(k) + 1, cards: [] };
    out[k] = { label: String(d.label || k), order: CATS.indexOf(k) + 1, cards: cleanCards(d.cards) || [] };
  });
  return out;
}
function cleanCards(cards) {
  if (!Array.isArray(cards) || cards.length > 80) return null;
  const out = [];
  const seen = {};
  for (const c of cards) {
    if (!c || typeof c.text !== 'string') return null;
    const text = c.text.trim();
    if (!text || text.length > 30) return null;
    let id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) ? c.id : null;
    if (!id || seen[id]) id = 'c' + crypto.randomBytes(4).toString('hex');
    seen[id] = true;
    out.push({ id: id, text: text, on: c.on !== false });
  }
  return out;
}
function enabledDeck() {
  const out = {};
  CATS.forEach(function (k) {
    out[k] = deck[k].cards.filter(function (c) { return c.on; }).map(function (c) { return { id: c.id, text: c.text }; });
  });
  return out;
}
function enabledTexts() {
  const set = new Set();
  CATS.forEach(function (k) { deck[k].cards.forEach(function (c) { if (c.on) set.add(c.text); }); });
  return set;
}
function onlineGroups() {
  const list = [];
  students.forEach(function (s) { if (s.streams.size > 0) list.push(s.group); });
  return list.sort(function (a, b) { return a - b; });
}

/* ---------- 실시간 전송 (SSE) ---------- */
function send(res, obj) {
  try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch (e) { /* 연결이 끊김 */ }
}
function studentSnapshot(s) {
  return {
    type: 'state',
    group: s.group,
    others: onlineGroups().filter(function (g) { return g !== s.group; }).length,
    deck: enabledDeck(),
    inbox: proposals.filter(function (p) { return p.to === s.group; }).slice(-30).reverse(),
    outbox: proposals.filter(function (p) { return p.from === s.group; }).slice(-30).reverse()
  };
}
function teacherSnapshot() {
  const online = new Set(onlineGroups());
  const sent = {}, got = {};
  proposals.forEach(function (p) { sent[p.from] = (sent[p.from] || 0) + 1; got[p.to] = (got[p.to] || 0) + 1; });
  const members = [];
  students.forEach(function (s) {
    members.push({ group: s.group, online: online.has(s.group), sent: sent[s.group] || 0, received: got[s.group] || 0 });
  });
  members.sort(function (a, b) { return a.group - b.group; });
  return { type: 'state', members: members, proposals: proposals.slice(-500).reverse(), deck: deck };
}
let timer = null;
function schedule() {
  if (timer) return;
  timer = setTimeout(function () {
    timer = null;
    students.forEach(function (s) {
      if (!s.streams.size) return;
      const snap = studentSnapshot(s);
      s.streams.forEach(function (res) { send(res, snap); });
    });
    if (teacherStreams.size) {
      const snap = teacherSnapshot();
      teacherStreams.forEach(function (res) { send(res, snap); });
    }
  }, 120);
}
setInterval(function () {
  students.forEach(function (s) { s.streams.forEach(function (res) { try { res.write(':\n\n'); } catch (e) { /* skip */ } }); });
  teacherStreams.forEach(function (res) { try { res.write(':\n\n'); } catch (e) { /* skip */ } });
}, 15000);

/* ---------- 도우미 ---------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 30000) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}
function validId(id) { return typeof id === 'string' && /^[\w-]{8,64}$/.test(id); }
function teacherToken(req, url) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  return t && teacherTokens.has(t) ? t : null;
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
function sse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
}

const STATIC = {
  '/': ['student.html', 'text/html; charset=utf-8'],
  '/teacher': ['teacher.html', 'text/html; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/common.js': ['common.js', 'application/javascript; charset=utf-8'],
  '/student.js': ['student.js', 'application/javascript; charset=utf-8'],
  '/teacher.js': ['teacher.js', 'application/javascript; charset=utf-8']
};

/* ---------- 라우터 ---------- */
const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    if (req.method === 'GET' && STATIC[p]) {
      const f = STATIC[p];
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
      res.end(fs.readFileSync(path.join(PUB, f[0])));
      return;
    }
    if (req.method === 'GET' && p === '/healthz') { json(res, 200, { ok: true }); return; }

    /* 학생 */
    if (req.method === 'POST' && p === '/api/join') {
      const b = await readBody(req);
      if (!validId(b.clientId)) { json(res, 400, { error: 'bad-id' }); return; }
      let s = students.get(b.clientId);
      if (!s) {
        s = { group: nextGroup++, streams: new Set(), lastSubmit: 0 };
        students.set(b.clientId, s);
        schedule();
      }
      json(res, 200, { group: s.group });
      return;
    }
    if (req.method === 'GET' && p === '/api/stream') {
      const id = url.searchParams.get('clientId');
      const s = validId(id) ? students.get(id) : null;
      if (!s) { res.writeHead(410); res.end(); return; }
      sse(res);
      s.streams.add(res);
      send(res, studentSnapshot(s));
      schedule();
      req.on('close', function () { s.streams.delete(res); schedule(); });
      return;
    }
    if (req.method === 'POST' && p === '/api/submit') {
      const b = await readBody(req);
      const s = validId(b.clientId) ? students.get(b.clientId) : null;
      if (!s) { json(res, 410, { error: 'unknown-client' }); return; }
      const words = b.words;
      const allowed = enabledTexts();
      if (!Array.isArray(words) || words.length < 2 || words.length > MAX_WORDS ||
          !words.every(function (w) { return typeof w === 'string' && allowed.has(w); })) {
        json(res, 400, { error: 'bad-words' }); return;
      }
      const now = Date.now();
      if (now - s.lastSubmit < 800) { json(res, 429, { error: 'too-fast' }); return; }
      const targets = onlineGroups().filter(function (g) { return g !== s.group; });
      if (!targets.length) { json(res, 409, { error: 'no-target' }); return; }
      const to = targets[Math.floor(Math.random() * targets.length)];
      s.lastSubmit = now;
      proposals.push({ id: ++propSeq, from: s.group, to: to, text: words.join(' '), at: now });
      if (proposals.length > 5000) proposals = proposals.slice(-5000);
      schedule();
      json(res, 200, { to: to });
      return;
    }

    /* 교사 */
    if (req.method === 'POST' && p === '/api/teacher/login') {
      const b = await readBody(req);
      if (typeof b.pin === 'string' && safeEqual(b.pin, TEACHER_PIN)) {
        const t = crypto.randomBytes(24).toString('hex');
        teacherTokens.add(t);
        json(res, 200, { token: t });
      } else {
        setTimeout(function () { json(res, 401, { error: 'bad-pin' }); }, 600);
      }
      return;
    }
    if (p.startsWith('/api/teacher/')) {
      const tok = teacherToken(req, url);
      if (!tok) { res.writeHead(401); res.end(); return; }

      if (req.method === 'GET' && p === '/api/teacher/stream') {
        sse(res);
        teacherStreams.add(res);
        send(res, teacherSnapshot());
        req.on('close', function () { teacherStreams.delete(res); });
        return;
      }
      if (req.method === 'GET' && p === '/api/teacher/deck.json') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="deck.json"' });
        res.end(JSON.stringify(deck, null, 2));
        return;
      }
      if (req.method === 'POST' && p === '/api/teacher/deck') {
        const b = await readBody(req);
        const cards = cleanCards(b.cards);
        if (CATS.indexOf(b.key) < 0 || !cards) { json(res, 400, { error: 'bad-deck' }); return; }
        deck[b.key].cards = cards;
        schedule();
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && p === '/api/teacher/wipe') {
        const b = await readBody(req);
        proposals = [];
        if (b.kind === 'all') {
          students.forEach(function (s) {
            s.streams.forEach(function (r) { send(r, { type: 'reset' }); try { r.end(); } catch (e) { /* skip */ } });
          });
          students.clear();
          nextGroup = 1;
        }
        schedule();
        json(res, 200, { ok: true });
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('없는 주소예요.');
  } catch (e) {
    try { json(res, 400, { error: 'bad-request' }); } catch (e2) { /* skip */ }
  }
});

server.keepAliveTimeout = 65000;
server.listen(PORT, function () {
  console.log('프로포즈 대작전 서버가 켜졌어요: 포트 ' + PORT);
  console.log('학생 화면: /   교사 화면: /teacher');
});
