'use strict';

// ===== 定数 =====
const N = 8;
const SAVE_KEY = 'hakopita.save.v1';
const BEST_KEY = 'hakopita.best';
const PREF_KEY = 'hakopita.prefs';
const HELP_KEY = 'hakopita.helpSeen';

const COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9', '#4dabf7', '#9775fa', '#f783ac'];

// [形, 出現の重み, 大きいブロックか]
const SHAPE_DEFS = [
  ['#', 2],
  ['##', 3], ['#|#', 3],
  ['###', 3], ['#|#|#', 3],
  ['####', 2], ['#|#|#|#', 2],
  ['#####', 1, 1], ['#|#|#|#|#', 1, 1],
  ['##|##', 3],
  ['###|###|###', 1, 1],
  ['##|#.', 2], ['##|.#', 2], ['#.|##', 2], ['.#|##', 2],
  ['#.|#.|##', 2], ['.#|.#|##', 2], ['##|#.|#.', 2], ['##|.#|.#', 2],
  ['###|#..', 2], ['###|..#', 2], ['#..|###', 2], ['..#|###', 2],
  ['###|.#.', 2], ['.#.|###', 2], ['#.|##|#.', 2], ['.#|##|.#', 2],
  ['##.|.##', 1], ['.##|##.', 1], ['#.|##|.#', 1], ['.#|##|#.', 1],
  ['###|#..|#..', 1, 1], ['###|..#|..#', 1, 1], ['#..|#..|###', 1, 1], ['..#|..#|###', 1, 1],
  ['#.|.#', 1], ['.#|#.', 1],
];
const SHAPES = SHAPE_DEFS.map(([str, weight, big]) => {
  const rows = str.split('|');
  const cells = [];
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '#') cells.push([x, y]); }));
  return { cells, w: rows[0].length, h: rows.length, weight, big: !!big };
});

// ===== 保存（使えない環境でも動くように） =====
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

// ===== ゲーム状態 =====
let board, tray, score, combo, movesSinceClear, over;
let best = store.get(BEST_KEY, 0);
const prefs = Object.assign({ se: true, bgm: false }, store.get(PREF_KEY, {}));

function newGame() {
  board = new Array(N * N).fill(-1);
  score = 0; combo = 0; movesSinceClear = 0; over = false;
  tray = makeTray();
  save();
  updateHud();
}

function save() {
  store.set(SAVE_KEY, { board, tray, score, combo, movesSinceClear, over });
}

function load() {
  const s = store.get(SAVE_KEY, null);
  if (!s || !Array.isArray(s.board) || s.board.length !== N * N || s.over) return false;
  board = s.board; tray = s.tray; score = s.score | 0; combo = s.combo | 0;
  movesSinceClear = s.movesSinceClear | 0; over = false;
  if (!tray.some(Boolean)) tray = makeTray();
  return true;
}

// ===== ブロック生成 =====
function pickShape() {
  // スコアが上がるほど大きいブロックが出やすくなる
  const bigBoost = 1 + Math.min(score / 3000, 1.5);
  const weights = SHAPES.map(s => s.weight * (s.big ? bigBoost : 1));
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < SHAPES.length; i++) { r -= weights[i]; if (r <= 0) return i; }
  return 0;
}

function makeTray() {
  // 少なくとも1つは置けるセットになるよう数回引き直す（理不尽な詰みを減らす）
  let t;
  for (let attempt = 0; attempt < 30; attempt++) {
    t = [0, 1, 2].map(() => ({ s: pickShape(), c: Math.floor(Math.random() * COLORS.length) }));
    if (board && t.some(p => fitsAnywhere(p.s))) break;
  }
  trayBornAt = performance.now();
  return t;
}

// ===== 盤面ロジック =====
function canPlace(si, gx, gy) {
  const sh = SHAPES[si];
  for (const [x, y] of sh.cells) {
    const bx = gx + x, by = gy + y;
    if (bx < 0 || by < 0 || bx >= N || by >= N || board[by * N + bx] !== -1) return false;
  }
  return true;
}

function fitsAnywhere(si) {
  const sh = SHAPES[si];
  for (let gy = 0; gy <= N - sh.h; gy++)
    for (let gx = 0; gx <= N - sh.w; gx++)
      if (canPlace(si, gx, gy)) return true;
  return false;
}

// 置いたと仮定したときに消える行・列
function linesAfter(si, gx, gy) {
  const tmp = board.slice();
  for (const [x, y] of SHAPES[si].cells) tmp[(gy + y) * N + gx + x] = 0;
  const rows = [], cols = [];
  for (let i = 0; i < N; i++) {
    let r = true, c = true;
    for (let j = 0; j < N; j++) {
      if (tmp[i * N + j] === -1) r = false;
      if (tmp[j * N + i] === -1) c = false;
    }
    if (r) rows.push(i);
    if (c) cols.push(i);
  }
  return { rows, cols };
}

function place(slot, gx, gy) {
  const p = tray[slot];
  const sh = SHAPES[p.s];
  const { rows, cols } = linesAfter(p.s, gx, gy);
  for (const [x, y] of sh.cells) board[(gy + y) * N + gx + x] = p.c;
  tray[slot] = null;

  let gain = sh.cells.length;
  const lines = rows.length + cols.length;
  const now = performance.now();

  // 置いたブロックの着地アニメ
  for (const [x, y] of sh.cells) landing.push({ i: (gy + y) * N + gx + x, t0: now });

  if (lines > 0) {
    combo++;
    movesSinceClear = 0;
    const cleared = new Set();
    rows.forEach(r => { for (let j = 0; j < N; j++) cleared.add(r * N + j); });
    cols.forEach(c => { for (let j = 0; j < N; j++) cleared.add(j * N + c); });
    cleared.forEach(i => {
      clearing.push({ i, color: board[i], t0: now, delay: delayFor(i, rows, cols, gx + sh.w / 2, gy + sh.h / 2) });
      board[i] = -1;
    });
    const lineBonus = 10 * lines * (lines + 1) / 2;
    gain += lineBonus * combo;

    const cx = layout.boardX + (gx + sh.w / 2) * layout.cell;
    const cy = layout.boardY + (gy + sh.h / 2) * layout.cell;
    let msg = lines >= 3 ? 'すごい！' : lines === 2 ? 'ナイス！' : '';
    if (board.every(v => v === -1)) {
      gain += 300;
      popups.push({ text: 'ぴたっ！ +300', x: layout.boardX + layout.boardSize / 2, y: layout.boardY + layout.boardSize / 2, t0: now + 200, size: 1.6, color: '#ff7a59' });
      sfx.perfect();
    }
    popups.push({ text: '+' + (lineBonus * combo + sh.cells.length), x: cx, y: cy, t0: now, size: 1, color: COLORS[p.c] });
    if (combo >= 2) popups.push({ text: combo + ' コンボ！', x: cx, y: cy - layout.cell * 0.9, t0: now + 120, size: 0.9, color: '#ff7a59' });
    else if (msg) popups.push({ text: msg, x: cx, y: cy - layout.cell * 0.9, t0: now + 120, size: 0.9, color: '#ff7a59' });
    sfx.clear(lines, combo);
    vibrate(lines > 1 ? [20, 40, 30] : 25);
  } else {
    movesSinceClear++;
    if (movesSinceClear >= 3) combo = 0; // 3手消さないとコンボが途切れる
    sfx.place();
    vibrate(10);
  }

  score += gain;
  if (score > best) { best = score; store.set(BEST_KEY, best); }

  if (!tray.some(Boolean)) tray = makeTray();
  checkOver();
  save();
  updateHud();
}

function delayFor(i, rows, cols, cx, cy) {
  const x = i % N, y = Math.floor(i / N);
  return Math.hypot(x + 0.5 - cx, y + 0.5 - cy) * 35;
}

function checkOver() {
  const alive = tray.some(p => p && fitsAnywhere(p.s));
  if (!alive) {
    over = true;
    const isRecord = score >= best && score > 0;
    setTimeout(() => showOver(isRecord), 900);
    sfx.over();
  }
}

// ===== 描画 =====
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const layout = {};
let theme = {};
let dpr = 1;
let trayBornAt = 0;
const clearing = [];
const landing = [];
const popups = [];
const particles = [];
let drag = null; // { slot, x, y, gx, gy, ok, lines }

function readTheme() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  theme = dark
    ? { board: '#262935', empty: '#323646', line: 'rgba(255,255,255,.04)', text: '#ecebf3' }
    : { board: '#e9e1d4', empty: '#f8f4ee', line: 'rgba(0,0,0,.03)', text: '#3a3442' };
}

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = cv.clientWidth, H = cv.clientHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const pad = 16;
  let boardSize = Math.min(W - pad * 2, 520);
  const trayRatio = 0.42;
  if (boardSize * (1 + trayRatio) + 20 > H) boardSize = (H - 20) / (1 + trayRatio);
  // 縦に余裕があればトレイを広げて、指で掴みやすくする
  const trayH = Math.min(boardSize * 0.55, Math.max(boardSize * trayRatio, (H - boardSize - 12) * 0.75));
  const used = boardSize + trayH + 12;
  layout.W = W; layout.H = H;
  layout.boardSize = boardSize;
  layout.cell = boardSize / N;
  layout.boardX = (W - boardSize) / 2;
  layout.boardY = Math.max(8, (H - used) / 2);
  layout.trayY = layout.boardY + boardSize + 12;
  layout.trayH = trayH;
  layout.slotW = Math.min(W, boardSize + 40) / 3;
  layout.trayX = (W - layout.slotW * 3) / 2;
  layout.trayCell = Math.min(layout.cell * 0.55, layout.slotW / 5.6, trayH / 5.6);
  requestDraw();
}

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBlock(x, y, s, color, alpha = 1, scale = 1) {
  if (scale !== 1) {
    const d = s * (1 - scale) / 2;
    x += d; y += d; s *= scale;
  }
  if (s <= 0.5) return;
  const g = s * 0.05, r = s * 0.2;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  rr(x + g, y + g, s - g * 2, s - g * 2, r);
  ctx.fill();
  // 下側の影
  ctx.fillStyle = 'rgba(0,0,0,.14)';
  rr(x + g, y + s * 0.62, s - g * 2, s * 0.38 - g, r);
  ctx.fill();
  ctx.fillStyle = color;
  rr(x + g, y + g, s - g * 2, s * 0.86 - g, r);
  ctx.fill();
  // 上側のハイライト
  ctx.fillStyle = 'rgba(255,255,255,.32)';
  rr(x + s * 0.18, y + s * 0.14, s * 0.64, s * 0.16, s * 0.08);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPiece(si, color, x, y, s, alpha = 1) {
  for (const [cx, cy] of SHAPES[si].cells) drawBlock(x + cx * s, y + cy * s, s, color, alpha);
}

function slotCenter(i) {
  return { x: layout.trayX + layout.slotW * (i + 0.5), y: layout.trayY + layout.trayH / 2 };
}

let rafId = 0;
function requestDraw() {
  if (!rafId) rafId = requestAnimationFrame(frame);
}

function frame(now) {
  rafId = 0;
  draw(now);
  if (drag || clearing.length || landing.length || popups.length || particles.length || now - trayBornAt < 400) requestDraw();
}

function draw(now) {
  const { cell, boardX, boardY, boardSize } = layout;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, layout.W, layout.H);

  // 盤面
  ctx.fillStyle = theme.board;
  rr(boardX - 6, boardY - 6, boardSize + 12, boardSize + 12, 16);
  ctx.fill();

  // ドラッグ中：消える予定の行・列は置くブロックの色で光らせる
  let hl = null;
  if (drag && drag.ok) {
    hl = new Set();
    drag.lines.rows.forEach(r => { for (let j = 0; j < N; j++) hl.add(r * N + j); });
    drag.lines.cols.forEach(c => { for (let j = 0; j < N; j++) hl.add(j * N + c); });
  }
  const dragColor = drag ? COLORS[tray[drag.slot].c] : null;

  // 着地アニメの拡大率
  const landScale = {};
  for (let k = landing.length - 1; k >= 0; k--) {
    const t = (now - landing[k].t0) / 180;
    if (t >= 1) { landing.splice(k, 1); continue; }
    landScale[landing[k].i] = 1 + Math.sin(t * Math.PI) * 0.12;
  }

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const px = boardX + x * cell, py = boardY + y * cell;
      ctx.fillStyle = theme.empty;
      rr(px + cell * 0.05, py + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.18);
      ctx.fill();
      if (board[i] !== -1) {
        drawBlock(px, py, cell, hl && hl.has(i) ? dragColor : COLORS[board[i]], 1, landScale[i] || 1);
      }
    }
  }

  // ゴースト（置ける場所のプレビュー）
  if (drag && drag.ok) {
    const sh = SHAPES[tray[drag.slot].s];
    for (const [x, y] of sh.cells) {
      drawBlock(boardX + (drag.gx + x) * cell, boardY + (drag.gy + y) * cell, cell, dragColor, 0.4);
    }
    if (hl) {
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = dragColor;
      drag.lines.rows.forEach(r => { rr(boardX, boardY + r * cell, boardSize, cell, cell * 0.2); ctx.fill(); });
      drag.lines.cols.forEach(c => { rr(boardX + c * cell, boardY, cell, boardSize, cell * 0.2); ctx.fill(); });
      ctx.globalAlpha = 1;
    }
  }

  // 消えるアニメ
  for (let k = clearing.length - 1; k >= 0; k--) {
    const c = clearing[k];
    const t = (now - c.t0 - c.delay) / 260;
    if (t >= 1) {
      spawnParticles(boardX + (c.i % N + 0.5) * cell, boardY + (Math.floor(c.i / N) + 0.5) * cell, COLORS[c.color]);
      clearing.splice(k, 1);
      continue;
    }
    const px = boardX + (c.i % N) * cell, py = boardY + Math.floor(c.i / N) * cell;
    if (t < 0) drawBlock(px, py, cell, COLORS[c.color]);
    else {
      drawBlock(px, py, cell, COLORS[c.color], 1 - t * 0.6, 1 + t * 0.15 - t * t * 1.1);
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.fillStyle = '#fff';
      rr(px + cell * 0.1, py + cell * 0.1, cell * 0.8, cell * 0.8, cell * 0.2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // トレイ
  const appear = Math.min(1, (now - trayBornAt) / 300);
  for (let i = 0; i < 3; i++) {
    const p = tray[i];
    if (!p || (drag && drag.slot === i)) continue;
    const sh = SHAPES[p.s];
    const ease = 1 - Math.pow(1 - Math.min(1, appear * 1.4 - i * 0.2 > 0 ? appear * 1.4 - i * 0.2 : 0), 3);
    const s = layout.trayCell * (0.6 + 0.4 * ease);
    const c = slotCenter(i);
    const fits = fitsAnywhere(p.s);
    drawPiece(p.s, COLORS[p.c], c.x - sh.w * s / 2, c.y - sh.h * s / 2, s, (fits ? 1 : 0.28) * ease);
  }

  // ドラッグ中のブロック
  if (drag) {
    const p = tray[drag.slot];
    drawPiece(p.s, COLORS[p.c], drag.x, drag.y, cell * 0.96, 0.95);
  }

  // パーティクル
  for (let k = particles.length - 1; k >= 0; k--) {
    const q = particles[k];
    q.life -= 1 / 40;
    if (q.life <= 0) { particles.splice(k, 1); continue; }
    q.x += q.vx; q.y += q.vy; q.vy += 0.25;
    ctx.globalAlpha = q.life;
    ctx.fillStyle = q.color;
    ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;

  // 得点ポップアップ
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let k = popups.length - 1; k >= 0; k--) {
    const q = popups[k];
    const t = (now - q.t0) / 900;
    if (t >= 1) { popups.splice(k, 1); continue; }
    if (t < 0) continue;
    const pop = t < 0.15 ? t / 0.15 : 1;
    ctx.globalAlpha = t > 0.7 ? (1 - t) / 0.3 : 1;
    ctx.font = `900 ${Math.round(cell * 0.62 * q.size * (0.7 + 0.3 * pop))}px system-ui, sans-serif`;
    ctx.lineWidth = cell * 0.12;
    ctx.strokeStyle = theme.board;
    ctx.strokeText(q.text, q.x, q.y - t * cell * 0.8);
    ctx.fillStyle = q.color;
    ctx.fillText(q.text, q.x, q.y - t * cell * 0.8);
  }
  ctx.globalAlpha = 1;
}

function spawnParticles(x, y, color) {
  for (let k = 0; k < 4; k++) {
    const a = Math.random() * Math.PI * 2, v = 1.5 + Math.random() * 3;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: 1, color, size: layout.cell * (0.12 + Math.random() * 0.12) });
  }
}

// ===== 操作（ドラッグ＆ドロップ） =====
function toLocal(e) {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function updateDrag(px, py) {
  const p = tray[drag.slot];
  const sh = SHAPES[p.s];
  const s = layout.cell * 0.96;
  // 指でブロックが隠れないよう、指より少し上に表示する
  drag.x = px - sh.w * s / 2;
  drag.y = py - sh.h * s - layout.cell * 1.1;
  const gx = Math.round((drag.x - layout.boardX) / layout.cell);
  const gy = Math.round((drag.y - layout.boardY) / layout.cell);
  drag.gx = gx; drag.gy = gy;
  drag.ok = canPlace(p.s, gx, gy);
  drag.lines = drag.ok ? linesAfter(p.s, gx, gy) : null;
}

cv.addEventListener('pointerdown', e => {
  if (over || drag) return;
  audio.unlock();
  const { x, y } = toLocal(e);
  if (y < layout.trayY - 10) return;
  const slot = Math.floor((x - layout.trayX) / layout.slotW);
  if (slot < 0 || slot > 2 || !tray[slot]) return;
  drag = { slot, pointerId: e.pointerId };
  try { cv.setPointerCapture(e.pointerId); } catch {}
  updateDrag(x, y);
  sfx.pick();
  requestDraw();
});

cv.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { x, y } = toLocal(e);
  const prevOk = drag.ok, pgx = drag.gx, pgy = drag.gy;
  updateDrag(x, y);
  if (drag.ok && (!prevOk || pgx !== drag.gx || pgy !== drag.gy)) vibrate(4);
  requestDraw();
});

function endDrag(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  if (d.ok && e.type === 'pointerup') place(d.slot, d.gx, d.gy);
  requestDraw();
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);

// iOS のピンチ・ダブルタップ拡大を防ぐ
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

function vibrate(p) {
  if (prefs.se && navigator.vibrate) try { navigator.vibrate(p); } catch {}
}

// ===== サウンド（WebAudio で合成、音声ファイルなし） =====
const audio = {
  ctx: null, master: null, bgmGain: null,
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      // iOS ではマナーモード時に鳴らないようにする
      try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.35;
      this.bgmGain.connect(this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (prefs.bgm) bgm.start();
  },
  tone(freq, dur, { type = 'sine', vol = 0.3, when = 0, slide = 0, out } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out || this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
};

const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5]; // ドレミソラ…
const sfx = {
  pick() { if (prefs.se) audio.tone(660, 0.06, { type: 'triangle', vol: 0.15 }); },
  place() { if (prefs.se) { audio.tone(220, 0.09, { type: 'triangle', vol: 0.35, slide: 0.6 }); } },
  clear(lines, combo) {
    if (!prefs.se) return;
    const base = Math.min(combo - 1, 3);
    const n = Math.min(2 + lines, 6);
    for (let k = 0; k < n; k++) audio.tone(NOTES[Math.min(base + k, NOTES.length - 1)], 0.18, { type: 'triangle', vol: 0.22, when: k * 0.055 });
  },
  perfect() {
    if (!prefs.se) return;
    [0, 2, 4, 5, 7].forEach((n, k) => audio.tone(NOTES[n] || 1568, 0.3, { type: 'square', vol: 0.08, when: 0.25 + k * 0.08 }));
  },
  over() {
    if (!prefs.se) return;
    [392, 330, 262, 196].forEach((f, k) => audio.tone(f, 0.28, { type: 'triangle', vol: 0.25, when: 0.3 + k * 0.16 }));
  },
};

// のんびりしたBGM（コード進行に合わせてアルペジオを自動生成）
const bgm = {
  timer: 0, step: 0,
  chords: [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [174.61, 220, 261.63, 329.63], [196, 246.94, 293.66, 392]],
  start() {
    if (this.timer || !audio.ctx) return;
    this.timer = setInterval(() => this.tick(), 280);
  },
  stop() { clearInterval(this.timer); this.timer = 0; },
  tick() {
    if (!audio.ctx || audio.ctx.state !== 'running') return;
    const chord = this.chords[Math.floor(this.step / 16) % 4];
    const k = this.step % 16;
    if (k % 8 === 0) audio.tone(chord[0] / 2, 2.2, { type: 'sine', vol: 0.18, out: audio.bgmGain });
    if (k % 2 === 0 || Math.random() < 0.3) {
      const pattern = [0, 1, 2, 3, 2, 1, 2, 3];
      const f = chord[pattern[(k / 2 | 0) % 8]] * (Math.random() < 0.15 ? 2 : 1);
      audio.tone(f, 0.5, { type: 'triangle', vol: 0.07, out: audio.bgmGain });
    }
    this.step++;
  },
};

document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) audio.ctx.suspend();
  else if (prefs.se || prefs.bgm) audio.ctx.resume();
});

// ===== 画面（HUD・ボタン・オーバーレイ） =====
const $ = id => document.getElementById(id);

function updateHud() {
  $('score').textContent = score;
  $('best').textContent = best;
  $('btn-se').classList.toggle('off', !prefs.se);
  $('btn-bgm').classList.toggle('off', !prefs.bgm);
}

function showOver(isRecord) {
  $('over-score').textContent = score;
  $('over-record').hidden = !isRecord;
  $('over-best').textContent = 'ベスト ' + best;
  $('over').hidden = false;
}

$('btn-again').addEventListener('click', () => {
  $('over').hidden = true;
  newGame();
  requestDraw();
});

$('btn-help').addEventListener('click', () => { $('help').hidden = false; });
$('btn-help-close').addEventListener('click', () => {
  $('help').hidden = true;
  store.set(HELP_KEY, true);
  audio.unlock();
});

$('btn-restart').addEventListener('click', () => {
  if (score === 0 && board.every(v => v === -1)) return;
  $('confirm').hidden = false;
});
$('btn-confirm-no').addEventListener('click', () => { $('confirm').hidden = true; });
$('btn-confirm-yes').addEventListener('click', () => {
  $('confirm').hidden = true;
  newGame();
  requestDraw();
});

$('btn-se').addEventListener('click', () => {
  prefs.se = !prefs.se;
  store.set(PREF_KEY, prefs);
  audio.unlock();
  updateHud();
  sfx.pick();
});
$('btn-bgm').addEventListener('click', () => {
  prefs.bgm = !prefs.bgm;
  store.set(PREF_KEY, prefs);
  audio.unlock();
  if (prefs.bgm) bgm.start(); else bgm.stop();
  updateHud();
});

matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { readTheme(); requestDraw(); });
window.addEventListener('resize', resize);

// ===== 起動 =====
readTheme();
if (!load()) newGame();
updateHud();
resize();
if (!store.get(HELP_KEY, false)) $('help').hidden = false;

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
