'use strict';

/* ═══════════════════════════════════════════════════════════════
   Xếp bóng – game.js
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ─────────────────────────────────────────────────────────────────
const DEFAULT_CAPACITY = 4;
const BALL_SIZE        = 52;   // px – base size, dynamically scaled in applyLevelSizing
const BALL_GAP         = 4;    // px – gap inside .tube
const TUBE_PAD_TOP     = 4;    // px – padding-top inside .tube
const MAX_UNDO         = 40;
const SAVE_KEY         = 'bsp_v1';   // bump version if save format changes

const DIFFICULTY_NAME  = ['', 'DỄ', 'DỄ', 'TB', 'TB', 'KHÓ', 'KHÓ', 'SIÊU KHÓ'];

const COLORS = [
  { bg: 'linear-gradient(145deg, #ff6b6b, #ee5253)', shadow: 'rgba(238, 82, 83, 0.45)' }, // 0 Đỏ san hô
  { bg: 'linear-gradient(145deg, #48dbfb, #0abde3)', shadow: 'rgba(10, 189, 227, 0.45)' }, // 1 Xanh da trời
  { bg: 'linear-gradient(145deg, #1dd1a1, #10ac84)', shadow: 'rgba(16, 172, 132, 0.45)' }, // 2 Xanh ngọc
  { bg: 'linear-gradient(145deg, #feca57, #ff9f43)', shadow: 'rgba(255, 159, 67, 0.45)' }, // 3 Vàng cam
  { bg: 'linear-gradient(145deg, #a29bfe, #6c5ce7)', shadow: 'rgba(108, 92, 231, 0.45)' }, // 4 Tím pastel
  { bg: 'linear-gradient(145deg, #ff9ff3, #f368e0)', shadow: 'rgba(243, 104, 224, 0.45)' }, // 5 Hồng phấn
  { bg: 'linear-gradient(145deg, #ff7675, #d63031)', shadow: 'rgba(214, 48, 49, 0.45)' },  // 6 Đỏ ruby
  { bg: 'linear-gradient(145deg, #54a0ff, #2e86de)', shadow: 'rgba(46, 134, 222, 0.45)' }, // 7 Xanh coban
  { bg: 'linear-gradient(145deg, #55efc4, #00b894)', shadow: 'rgba(0, 184, 148, 0.45)' },  // 8 Xanh mint
  { bg: 'linear-gradient(145deg, #ffeaa7, #fdcb6e)', shadow: 'rgba(253, 203, 110, 0.45)' }, // 9 Vàng tươi
  { bg: 'linear-gradient(145deg, #fd79a8, #e84393)', shadow: 'rgba(232, 67, 147, 0.45)' }, // 10 Hồng đậm
  { bg: 'linear-gradient(145deg, #81ecec, #00cec9)', shadow: 'rgba(0, 206, 201, 0.45)' },  // 11 Xanh cyan
];

// ── Sound Settings & Volume State ─────────────────────────────
const SOUND_SETTING_KEY = 'captain_sound_settings_v1';
let soundVolume = 0.8; // 0.0 -> 1.0 (mặc định 80%)
let isSoundMuted = false;

function loadSoundSettings() {
  try {
    const raw = localStorage.getItem(SOUND_SETTING_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (typeof data.volume === 'number') soundVolume = Math.max(0, Math.min(1, data.volume));
      if (typeof data.muted === 'boolean') isSoundMuted = data.muted;
    }
  } catch (_) {}
}

function saveSoundSettings() {
  try {
    localStorage.setItem(SOUND_SETTING_KEY, JSON.stringify({
      volume: soundVolume,
      muted: isSoundMuted
    }));
  } catch (_) {}
}

loadSoundSettings();

// ── Sound System (Web Audio API – no external files) ──────────────────────────
let _ctx = null;

/** Lazily create / resume the AudioContext (required by browser autoplay policy). */
function getCtx() {
  try {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  } catch (_) { return null; }
}

/** Safe wrapper – nhân với âm lượng hiện tại, nếu tắt âm (muted) thì bỏ qua */
function snd(fn) {
  if (isSoundMuted || soundVolume <= 0) return;
  try {
    const ctx = getCtx();
    if (ctx) fn(ctx, soundVolume);
  } catch (_) {}
}

const SFX = {
  /** Short bright tick – tube selected */
  select() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(850, t);
      osc.frequency.exponentialRampToValueAtTime(1050, t + 0.06);
      g.gain.setValueAtTime(0.24 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.10);
    });
  },

  /** Soft downward tick – tube deselected */
  deselect() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1050, t);
      osc.frequency.exponentialRampToValueAtTime(750, t + 0.07);
      g.gain.setValueAtTime(0.20 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.10);
    });
  },

  /** Airy whoosh – ball(s) in flight */
  move() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      const size = Math.floor(ctx.sampleRate * 0.18);
      const buf  = ctx.createBuffer(1, size, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / size) ** 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bpf = ctx.createBiquadFilter();
      bpf.type = 'bandpass'; bpf.Q.value = 1.8;
      bpf.frequency.setValueAtTime(2800, t);
      bpf.frequency.exponentialRampToValueAtTime(500, t + 0.18);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      src.connect(bpf); bpf.connect(g); g.connect(ctx.destination);
      src.start(t);
    });
  },

  /** Soft thud – ball(s) land in tube */
  land() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(340, t);
      osc.frequency.exponentialRampToValueAtTime(140, t + 0.10);
      g.gain.setValueAtTime(0.45 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.14);
    });
  },

  /** Low buzz – invalid move attempt */
  invalid() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(160, t);
      g.gain.setValueAtTime(0.18 * vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(t); osc.stop(t + 0.18);
    });
  },

  /** Rising 3-note chime – tube solved */
  complete() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      [523, 659, 784].forEach((freq, i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.10);
        g.gain.setValueAtTime(0, t + i * 0.10);
        g.gain.linearRampToValueAtTime(0.38 * vol, t + i * 0.10 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.10 + 0.36);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t + i * 0.10); osc.stop(t + i * 0.10 + 0.37);
      });
    });
  },

  /** Celebratory 5-note ascending arpeggio – level cleared */
  win() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      [523, 659, 784, 1047, 1319].forEach((freq, i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.13);
        g.gain.setValueAtTime(0, t + i * 0.13);
        g.gain.linearRampToValueAtTime(0.42 * vol, t + i * 0.13 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.13 + 0.55);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t + i * 0.13); osc.stop(t + i * 0.13 + 0.56);
      });
    });
  },

  /** Descending tone – no moves left (stuck) */
  stuck() {
    snd((ctx, vol) => {
      const t = ctx.currentTime;
      [360, 280, 220].forEach((freq, i) => {
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t + i * 0.12);
        g.gain.setValueAtTime(0, t + i * 0.12);
        g.gain.linearRampToValueAtTime(0.30 * vol, t + i * 0.12 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.28);
        osc.connect(g); g.connect(ctx.destination);
        osc.start(t + i * 0.12); osc.stop(t + i * 0.12 + 0.29);
      });
    });
  },
};

// ── Game State ─────────────────────────────────────────────────────────────────
const G = {
  level: 1, tubes: [], selectedTube: null, moveCount: 0,
  hintsUsed: 0, undoStack: [], config: null, initialTubes: null,
  isAnimating: false, hintTimer: null,
  isLiveMode: false, // false = Chơi Thường (Classic), true = Chơi TikTok Live
};

// ── Tube Capacity Helper ───────────────────────────────────────────────────────
function getTubeCapacity() {
  return (G.config && G.config.capacity) ? G.config.capacity : DEFAULT_CAPACITY;
}

// ── Level Configuration ────────────────────────────────────────────────────────
/**
 * Quy định độ khó theo màn:
 * - Số màu bóng TỐI ĐA là 5 màu.
 * - Khởi đầu là 4 bóng, mỗi 10 level tăng thêm 1 bóng:
 *   + Level 1 – 10:  4 bóng / ống
 *   + Level 11 – 20: 5 bóng / ống
 *   + Level 21 – 30: 6 bóng / ống
 *   + Level 31 – 40: 7 bóng / ống
 *   + Level 41 – 50: 8 bóng / ống
 *   + ...
 * - Toàn bộ bóng luôn hiển thị rõ ràng (không ẩn bóng).
 */
function getLevelConfig(level) {
  // Số bóng mỗi ống (hàng dọc): khởi đầu 4 bóng, mỗi 10 level tăng thêm 1 bóng
  const capacity = 4 + Math.floor((level - 1) / 10);

  // Số màu: Level 1-3 có 3 màu, Level 4-7 có 4 màu, từ Level 8 trở đi đạt 5 màu tối đa
  const colors = level <= 3 ? 3 : (level <= 7 ? 4 : 5);

  const emptyTubes = 2;
  const shuffles = Math.min(300, 20 + capacity * 14 + (level * 2));
  const difficulty = Math.min(6, 1 + Math.floor((level - 1) / 8));

  return { colors, capacity, emptyTubes, fogOfWar: false, shuffles, difficulty };
}

// ── Level Generation ───────────────────────────────────────────────────────────
/**
 * Tạo bố cục màn chơi hợp lệ.
 *
 * Thuật toán mới (3 giai đoạn):
 *  1. Phân phối ngẫu nhiên hoàn toàn: tạo pool tất cả bóng rồi xáo và chia đều vào ống.
 *     Điều này đảm bảo KHÔNG có chuỗi dài cùng màu do bắt đầu từ trạng thái đã giải.
 *  2. Phá vỡ chuỗi dài: nếu còn ống có > MAX_RUN bóng liên tiếp cùng màu, hoán đổi
 *     với bóng từ ống khác để phá vỡ.
 *  3. Kiểm tra hợp lệ: phải có ít nhất 1 nước đi và chưa thắng sẵn.
 */
function generateLevel(cfg) {
  const cap    = cfg.capacity || DEFAULT_CAPACITY;
  const colors = cfg.colors;
  const MAX_RUN = Math.max(2, Math.floor(cap / 3)); // chuỗi tối đa cho phép trong ống

  for (let attempt = 0; attempt < 80; attempt++) {

    // ── Giai đoạn 1: Phân phối ngẫu nhiên vào TẤT CẢ ống ───────────────────
    // Tạo pool: mỗi màu có đúng `cap` bóng
    const pool = [];
    for (let c = 0; c < colors; c++) {
      for (let b = 0; b < cap; b++) pool.push(c);
    }
    // Fisher-Yates shuffle pool
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    // Khởi tạo TẤT CẢ ống (kể cả ống "rỗng") dưới dạng mảng trống
    const totalTubes = colors + cfg.emptyTubes;
    const tubes = Array.from({ length: totalTubes }, () => []);

    // Phân phối từng bóng một vào ống ngẫu nhiên còn chỗ
    // → bóng sẽ trải đều ra tất cả 7 ống thay vì chỉ 5 ống
    for (const ballColor of pool) {
      const withSpace = [];
      for (let t = 0; t < totalTubes; t++) {
        if (tubes[t].length < cap) withSpace.push(t);
      }
      const target = withSpace[Math.floor(Math.random() * withSpace.length)];
      tubes[target].push({ colorIndex: ballColor, revealed: true });
    }

    // ── Giai đoạn 2: Phá vỡ chuỗi dài ──────────────────────────────────────
    // Lặp tối đa 5*cap lần hoán đổi có chủ đích
    for (let pass = 0; pass < 5 * cap; pass++) {
      let fixed = true;
      for (let ti = 0; ti < totalTubes; ti++) {
        const tube = tubes[ti];
        if (tube.length < 2) continue;
        // Tìm chuỗi dài nhất trong ống này
        let maxRun = 1, run = 1;
        let runStart = 0;
        for (let bi = 1; bi < tube.length; bi++) {
          if (tube[bi].colorIndex === tube[bi - 1].colorIndex) {
            run++;
            if (run > maxRun) { maxRun = run; runStart = bi - run + 1; }
          } else {
            run = 1;
          }
        }
        if (maxRun <= MAX_RUN) continue;

        // Chọn ngẫu nhiên 1 bóng trong chuỗi vi phạm để hoán đổi
        const swapPos = runStart + Math.floor(Math.random() * maxRun);
        const swapColor = tube[swapPos].colorIndex;

        // Tìm ống khác có bóng khác màu để hoán đổi
        const candidates = [];
        for (let tj = 0; tj < totalTubes; tj++) {
          if (tj === ti) continue;
          for (let bj = 0; bj < tubes[tj].length; bj++) {
            if (tubes[tj][bj].colorIndex !== swapColor) {
              candidates.push({ tj, bj });
            }
          }
        }
        if (!candidates.length) continue;
        const { tj, bj } = candidates[Math.floor(Math.random() * candidates.length)];

        // Hoán đổi
        const tmp = tubes[ti][swapPos];
        tubes[ti][swapPos] = tubes[tj][bj];
        tubes[tj][bj] = tmp;
        fixed = false;
      }
      if (fixed) break;
    }

    // ── Giai đoạn 3: Đảm bảo có ống trống ───────────────────────────────────
    const emptyCount = tubes.filter(t => t.length === 0).length;
    if (emptyCount === 0) {
      const sortedIdx = tubes.map((t, idx) => ({ idx, len: t.length }))
                             .sort((a, b) => a.len - b.len);
      const emptiest = sortedIdx[0].idx;
      while (tubes[emptiest].length > 0) {
        const ball = tubes[emptiest].pop();
        const receiver = tubes.find((t, i) => i !== emptiest && t.length < cap);
        if (receiver) receiver.push(ball);
        else { tubes[emptiest].push(ball); break; }
      }
    }

    // ── Giai đoạn 4: Kiểm tra hợp lệ ────────────────────────────────────────
    let hasMove = false;
    for (let from = 0; from < tubes.length; from++) {
      const f = tubes[from];
      if (!f.length) continue;
      if (f.length === cap && f.every(b => b.colorIndex === f[0].colorIndex)) continue;

      const topColor = f[f.length - 1].colorIndex;
      let stackSize = 0;
      for (let i = f.length - 1; i >= 0 && f[i].colorIndex === topColor; i--) stackSize++;

      for (let to = 0; to < tubes.length; to++) {
        if (from === to) continue;
        const t = tubes[to];
        if (t.length >= cap || t.length + stackSize > cap) continue;
        if (!t.length || t[t.length - 1].colorIndex === topColor) {
          hasMove = true; break;
        }
      }
      if (hasMove) break;
    }

    const alreadyWon = tubes.every(t => !t.length || (t.length === cap && t.every(b => b.colorIndex === t[0].colorIndex)));

    if (hasMove && !alreadyWon) return tubes;
  }

  // Fallback an toàn nếu sau nhiều lần vẫn không đạt:
  const tubes = Array.from({ length: cfg.colors }, (_, i) =>
    Array.from({ length: cap }, () => ({ colorIndex: i, revealed: true }))
  );
  for (let i = 0; i < cfg.emptyTubes; i++) tubes.push([]);
  // Hoán đổi bóng đỉnh của ống 0 và ống 1 để tạo 1 câu đố hợp lệ
  if (tubes.length >= 2 && tubes[0].length && tubes[1].length) {
    const b0 = tubes[0].pop();
    const b1 = tubes[1].pop();
    tubes[0].push(b1);
    tubes[1].push(b0);
  }
  return tubes;
}

// ── Stack Helper ──────────────────────────────────────────────────────────────
/**
 * Counts consecutive same-colored balls at the TOP of a tube.
 * @param {number} tubeIdx
 * @returns {number}
 */
function getStackSize(tubeIdx) {
  const tube = G.tubes[tubeIdx];
  if (!tube.length) return 0;
  const topColor = tube[tube.length - 1].colorIndex;
  let n = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i].colorIndex === topColor; i--) {
    n++;
  }
  return n;
}

// ── Core Game Logic ───────────────────────────────────────────────────────────

/**
 * Returns true if moving the entire same-color stack from→to is valid.
 * The whole stack must fit in the destination tube.
 */
function canMove(from, to) {
  const f = G.tubes[from], t = G.tubes[to];
  const cap = getTubeCapacity();
  if (from === to || !f.length || t.length >= cap) return false;
  const stackSize = getStackSize(from);
  if (t.length + stackSize > cap) return false;   // stack won't fit
  if (!t.length) return true;                     // empty tube: ok
  return f[f.length - 1].colorIndex === t[t.length - 1].colorIndex;
}

function isSolved(tube) {
  const cap = getTubeCapacity();
  return tube.length === cap &&
    tube.every(b => b.colorIndex === tube[0].colorIndex);
}

function checkWin() {
  return G.tubes.every(t => !t.length || isSolved(t));
}

/**
 * Executes a move: transfers the entire same-color stack from→to.
 * Must be called AFTER the animation finishes.
 */
function doMove(from, to) {
  G.undoStack.push(cloneTubes(G.tubes));
  if (G.undoStack.length > MAX_UNDO) G.undoStack.shift();

  const stackSize = getStackSize(from);
  // splice the top `stackSize` balls from source (they're at the end of the array)
  const stack = G.tubes[from].splice(G.tubes[from].length - stackSize, stackSize);
  G.tubes[to].push(...stack);

  G.moveCount++;
}

function getHint() {
  let best = null;
  for (let from = 0; from < G.tubes.length; from++) {
    if (!G.tubes[from].length || isSolved(G.tubes[from])) continue;
    for (let to = 0; to < G.tubes.length; to++) {
      if (!canMove(from, to)) continue;
      // Skip a lone ball going to an empty tube (rarely useful)
      if (!G.tubes[to].length && G.tubes[from].length === 1) continue;
      if (!best || G.tubes[to].length > 0) best = { from, to };
    }
  }
  return best;
}

/**
 * Kiểm tra xem còn bất kỳ nước đi hợp lệ nào trên bàn cờ hay không.
 * @returns {boolean} true nếu còn ít nhất 1 nước đi hợp lệ
 */
function hasAnyValidMoves() {
  for (let from = 0; from < G.tubes.length; from++) {
    if (!G.tubes[from].length || isSolved(G.tubes[from])) continue;
    for (let to = 0; to < G.tubes.length; to++) {
      if (canMove(from, to)) return true;
    }
  }
  return false;
}

function calcStars() {
  const cap = getTubeCapacity();
  const est = G.config.colors * cap * 1.5;
  const r = G.moveCount / est;
  if (r <= 1.5) return 3;
  if (r <= 2.5) return 2;
  return 1;
}

function cloneTubes(tubes) {
  return tubes.map(t => t.map(b => ({ ...b })));
}

// ── Rendering ──────────────────────────────────────────────────────────────────
function render() {
  renderHeader();
  renderTubes();
}

function applyLevelSizing() {
  const cap = getTubeCapacity();
  const totalTubes = G.tubes.length || (G.config ? G.config.colors + G.config.emptyTubes : 7);
  const root = document.documentElement;

  // Lấy chiều cao hiển thị thực tế (tránh bị Safari iOS tính sai do thanh URL)
  const visibleH = Math.min(window.innerHeight, document.documentElement.clientHeight || window.innerHeight);

  // Lấy kích thước thực của tubes-area
  const tubesArea = document.querySelector('.tubes-area');
  const areaW = tubesArea && tubesArea.clientWidth > 0 ? tubesArea.clientWidth : Math.min(window.innerWidth, 960);
  const rawAreaH = tubesArea && tubesArea.clientHeight > 0 ? tubesArea.clientHeight : (visibleH - 100);
  const areaH = Math.min(rawAreaH, visibleH - 110);

  // Tính theo chiều ngang (1 hàng)
  const gapBetween = Math.max(4, Math.min(12, Math.floor(areaW / (totalTubes * 8))));
  const totalHorizontalGap = (totalTubes - 1) * gapBetween + 16;
  const perTubeW = Math.floor((areaW - totalHorizontalGap) / totalTubes);
  const maxBallW = Math.max(10, perTubeW - 10);

  // Ống có nhiều bóng (cap >= 12, cap = 16 ở mức khó) cần trừ bù khoảng cách an toàn lớn hơn
  const safeMargin = cap >= 12 ? 65 : (cap >= 8 ? 50 : 35);
  const availableH = Math.max(60, areaH - safeMargin);
  
  // ballGap nhỏ hơn ở các ống dài để tiết kiệm chiều cao
  const ballGap = cap >= 12 ? 1 : (cap >= 8 ? 2 : Math.max(2, Math.min(4, Math.floor(maxBallW / 12))));

  // Tính kích thước bóng tối đa phù hợp chiều cao
  const maxBallH = Math.floor((availableH - ((cap - 1) * ballGap) - 10) / cap);

  // Chọn kích thước bóng vừa cả 2 chiều
  let ballSize = Math.min(maxBallH, maxBallW);
  ballSize = Math.max(10, Math.min(56, ballSize));

  const tubeW = ballSize + (ballSize < 24 ? 6 : 10);
  const tubeH = cap * ballSize + (cap - 1) * ballGap + 10;
  const radius = Math.round(tubeW / 2);

  root.style.setProperty('--ball-size', `${ballSize}px`);
  root.style.setProperty('--ball-gap', `${ballGap}px`);
  root.style.setProperty('--tube-w', `${tubeW}px`);
  root.style.setProperty('--tube-h', `${tubeH}px`);
  root.style.setProperty('--tube-gap', `${gapBetween}px`);
  root.style.setProperty('--radius-tube', `${radius}px`);
}

// ── TikTok Live Broadcast Channel Sync ───────────────────────────
const LIVE_CHANNEL_NAME = 'tiktok_xep_bong_channel';
const liveChannel = new BroadcastChannel(LIVE_CHANNEL_NAME);

let liveData = {
  tiktokId: '',
  currentLevel: 1,
  totalLevels: 50,
  isPaused: false,
  tickerText: 'Hãy Follow và Tặng quà để cộng thêm màn thử thách cho Streamer nhé!',
  tickerSpeed: 'normal',
  tickerVisible: true
};

// Đọc liveState từ localStorage nếu có sẵn
try {
  const savedLive = localStorage.getItem('tiktok_xep_bong_live_state');
  if (savedLive) {
    liveData = { ...liveData, ...JSON.parse(savedLive) };
  }
} catch (_) {}

// Lắng nghe tín hiệu đồng bộ thời gian thực từ control.html
liveChannel.onmessage = (e) => {
  if (e.data && e.data.type === 'STATE_UPDATE') {
    const prevTotal = liveData.totalLevels;
    liveData = { ...liveData, ...e.data.payload };
    
    // Nếu có sự kiện cộng màn (Follow / Gift) -> Hiện Toast thông báo phía TRÊN kèm tên khán giả
    const detail = e.data.eventDetail;
    if (detail) {
      if (detail.type === 'FOLLOW') {
        showToast(`<i class="fa-solid fa-user-plus" style="color:#ff0050;margin-right:6px;"></i> Cảm ơn <strong>@${detail.username}</strong> đã Follow! (+1 Màn)`);
      } else if (detail.type === 'GIFT') {
        showToast(`<i class="fa-solid fa-gift" style="color:#8b5cf6;margin-right:6px;"></i> Cảm ơn <strong>@${detail.username}</strong> đã tặng ${detail.giftName}! (+${detail.addedLevels} Màn)`);
      } else if (detail.type === 'MANUAL') {
        showToast(`<i class="fa-solid fa-plus-circle" style="color:#38bdf8;margin-right:6px;"></i> Streamer đã cộng thủ công: +${detail.addedLevels} Màn!`);
      }
    } else if (liveData.totalLevels > prevTotal) {
      const added = liveData.totalLevels - prevTotal;
      showToast(`<i class="fa-solid fa-gift" style="color:#ff0050;margin-right:6px;"></i> Khán giả vừa ủng hộ: +${added} Màn thử thách!`);
    }

    renderHeader();
    renderTickerBanner();
    renderPauseBanner();
  }
};

function renderHeader() {
  applyLevelSizing();
  const levelBadge = document.getElementById('level-badge');
  if (levelBadge) levelBadge.textContent = `Màn ${G.level}`;
  const moveEl = document.getElementById('move-count');
  if (moveEl) moveEl.textContent = G.moveCount;
  const diffEl = document.getElementById('difficulty-name');
  if (diffEl) diffEl.textContent = G.config ? (DIFFICULTY_NAME[G.config.difficulty] || 'DỄ') : 'DỄ';
  const fogEl = document.getElementById('fog-badge');
  if (fogEl) fogEl.style.display = 'none';

  const defaultLogo = document.getElementById('default-game-logo');
  const liveHudBox = document.getElementById('live-hud-box');

  if (G.isLiveMode) {
    // Chế độ TikTok Live: Ẩn logo thường, hiện Live HUD đếm màn
    if (defaultLogo) defaultLogo.style.display = 'none';
    if (liveHudBox) liveHudBox.style.display = 'flex';

    const progressText = document.getElementById('live-progress-text');
    if (progressText) {
      progressText.textContent = `${G.level} / ${liveData.totalLevels}`;
    }

    // Bắn ngược Level hiện tại về Control Panel
    liveChannel.postMessage({
      type: 'GAME_LEVEL_UPDATE',
      payload: { currentLevel: G.level }
    });
  } else {
    // Chơi Thường: Hiện logo game truyền thống, ẩn toàn bộ Live HUD
    if (defaultLogo) defaultLogo.style.display = 'flex';
    if (liveHudBox) liveHudBox.style.display = 'none';
  }
}

function renderTickerBanner() {
  const container = document.getElementById('marquee-ticker');
  const content = document.getElementById('marquee-content');
  const textEl = document.getElementById('marquee-text');
  if (!container || !content || !textEl) return;

  // Chỉ hiển thị Banner Chữ Chạy khi đang ở Chế độ TikTok Live
  if (G.isLiveMode && liveData.tickerVisible && liveData.tickerText) {
    container.style.display = 'block';
    textEl.textContent = liveData.tickerText;
    content.className = `marquee-content ${liveData.tickerSpeed || 'normal'}`;
  } else {
    container.style.display = 'none';
  }
}

function renderPauseBanner() {
  const banner = document.getElementById('pause-live-banner');
  if (!banner) return;

  // Chỉ hiển thị Banner Tạm Dừng khi ở Chế độ TikTok Live
  if (G.isLiveMode && liveData.isPaused) {
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

function renderTubes() {
  const container = document.getElementById('tubes-container');
  container.innerHTML = '';

  G.tubes.forEach((tube, idx) => {
    const isSelected = G.selectedTube === idx;
    const stackSize  = isSelected ? getStackSize(idx) : 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'tube-wrapper' + (isSelected ? ' selected' : '');
    wrapper.id = `tube-wrapper-${idx}`;

    const cap = document.createElement('div');
    cap.className = 'tube-cap';

    const tubeEl = document.createElement('div');
    tubeEl.className = ['tube', isSolved(tube) ? 'tube-complete' : ''].filter(Boolean).join(' ');
    tubeEl.id = `tube-${idx}`;

    // Render balls reversed (top game-ball → first DOM element)
    // This works with flex-direction:column + justify-content:flex-end
    [...tube].reverse().forEach((ball, domIdx) => {
      const isTopBall   = isSelected && domIdx === 0;
      const isStackBall = isSelected && domIdx > 0 && domIdx < stackSize;
      tubeEl.appendChild(makeBallEl(ball, isTopBall, isStackBall));
    });

    // Tube number label (top)
    const labelTop = document.createElement('div');
    labelTop.className = 'tube-label tube-label-top';
    labelTop.textContent = idx + 1;
    wrapper.appendChild(labelTop);

    wrapper.appendChild(cap);
    wrapper.appendChild(tubeEl);

    // Tube number label (bottom)
    const label = document.createElement('div');
    label.className = 'tube-label';
    label.textContent = idx + 1;
    wrapper.appendChild(label);

    // Fast tap: bypass iOS 300ms click delay using touchend
    let _touched = false;
    wrapper.addEventListener('touchend', (e) => {
      e.preventDefault();
      _touched = true;
      onTubeClick(idx);
    }, { passive: false });
    wrapper.addEventListener('click', () => {
      if (_touched) { _touched = false; return; }
      onTubeClick(idx);
    });
    container.appendChild(wrapper);
  });
}

/**
 * Creates a single ball DOM element.
 * @param {{colorIndex, revealed}} ball
 * @param {boolean} isTopBall   – the selected tube's top ball (lifted)
 * @param {boolean} isStackBall – part of the stack but NOT the top (also lifted)
 */
function makeBallEl(ball, isTopBall = false, isStackBall = false) {
  const el = document.createElement('div');
  el.className = ['ball',
    isTopBall   ? 'ball-lifted' : '',
    isStackBall ? 'ball-stack'  : '',
  ].filter(Boolean).join(' ');

  const c = COLORS[ball.colorIndex];
  if (c) {
    el.style.background = c.bg;
    el.style.boxShadow  = `0 4px 10px ${c.shadow}, inset 0 1px 1px rgba(255, 255, 255, 0.4)`;
  }
  return el;
}

// ── Animation ──────────────────────────────────────────────────────────────────
/**
 * Animates each ball in the stack with a staggered start (STAGGER ms apart),
 * so they overlap in flight and create a smooth "flowing stream" into the tube.
 *
 * All balls are in motion simultaneously (with offset) – each follows its own
 * ⊓-arc (Rise → Slide → Drop). A shared counter triggers afterCb() once the
 * last ball has landed.
 *
 * Landing order: ball[0] (top source ball) → lowest dest slot first,
 *                last ball                 → highest slot.
 * This gives a natural "filling from the bottom" look.
 *
 * @param {number}   fromIdx
 * @param {number}   toIdx
 * @param {Function} afterCb – called once ALL balls have landed
 */
function animateAndMove(fromIdx, toIdx, afterCb) {
  G.isAnimating = true;

  const fromTubeEl    = document.getElementById(`tube-${fromIdx}`);
  const toTubeEl      = document.getElementById(`tube-${toIdx}`);
  const fromWrapperEl = document.getElementById(`tube-wrapper-${fromIdx}`);
  const toWrapperEl   = document.getElementById(`tube-wrapper-${toIdx}`);

  if (!fromTubeEl || !toTubeEl) { G.isAnimating = false; afterCb(); return; }

  const stackSize = getStackSize(fromIdx);
  const ballEls   = [...fromTubeEl.querySelectorAll('.ball')].slice(0, stackSize);
  if (!ballEls.length) { G.isAnimating = false; afterCb(); return; }

  const toRect    = toTubeEl.getBoundingClientRect();
  const N         = G.tubes[toIdx].length;
  const cap       = getTubeCapacity();
  const sampleBall = ballEls[0];
  const ballH     = sampleBall ? sampleBall.offsetHeight : BALL_SIZE;
  const STEP      = ballH + BALL_GAP;
  const srcTube   = G.tubes[fromIdx];
  // stack[0] = top ball of source, stack[last] = bottom of stack
  const stack     = srcTube.slice(srcTube.length - stackSize).reverse();

  // Cruising altitude – clear both tube caps by ≥ 28 px
  const fromCapTop = fromWrapperEl ? fromWrapperEl.getBoundingClientRect().top : 0;
  const toCapTop   = toWrapperEl   ? toWrapperEl.getBoundingClientRect().top   : 0;
  const highY  = Math.min(fromCapTop, toCapTop) - ballH - 28;
  const destX  = toRect.left + (toRect.width - ballH) / 2;

  // ── Timing ───────────────────────────────────────────────────────────────
  const T_RISE  = 55;    // ms – rise phase
  const T_SLIDE = 75;    // ms – horizontal slide
  const T_DROP  = 70;    // ms – drop into tube
  const STAGGER = 65;    // ms between starting each ball

  const flyEls  = [];
  let doneCount = 0;     // incremented each time a ball lands; triggers cleanup at stackSize
  SFX.move();

  /**
   * Kick off the ⊓-arc animation for ball at index `i`.
   * Called via staggered setTimeout so balls overlap in motion.
   */
  function startBall(i) {
    const ball     = stack[i];
    const domEl    = ballEls[i];
    const ballRect = domEl.getBoundingClientRect();

    // i=0 (top ball) → lowest dest slot (N);  i=last → highest slot (N+stackSize-1)
    const slotIdx = N + i;
    const destY   = toRect.top + TUBE_PAD_TOP + (cap - 1 - slotIdx) * STEP;

    const fly = document.createElement('div');
    const c   = COLORS[ball.colorIndex];
    fly.className = 'ball';   // inherits CSS shine via ::after
    fly.style.cssText = `
      position:fixed; z-index:${9999 - i}; pointer-events:none;
      left:${ballRect.left}px; top:${ballRect.top}px;
      width:${ballRect.width}px; height:${ballRect.height}px;
      background:${c.bg};
      box-shadow:0 3px 8px ${c.shadow}, inset 0 2px 3px rgba(255,255,255,.45), inset 0 -3px 6px rgba(0,0,0,.35);
    `;
    document.body.appendChild(fly);
    flyEls.push(fly);
    domEl.style.opacity = '0';

    // ── Phase 1 · Rise ────────────────────────────────────────────────────
    requestAnimationFrame(() => {
      fly.style.transition = `top ${T_RISE}ms ease-out`;
      fly.style.top = `${highY}px`;

      setTimeout(() => {
        // ── Phase 2 · Slide ───────────────────────────────────────────────
        fly.style.transition = `left ${T_SLIDE}ms ease-in-out`;
        fly.style.left = `${destX}px`;

        setTimeout(() => {
          // ── Phase 3 · Drop into tube mouth ────────────────────────────
          fly.style.transition = `top ${T_DROP}ms ease-in`;
          fly.style.top = `${destY}px`;

          setTimeout(() => {
            // Landing squish + intermediate land sound
            toTubeEl.classList.add('tube-bounce');
            setTimeout(() => toTubeEl.classList.remove('tube-bounce'), 300);
            if (i < stackSize - 1) SFX.land();

            // When all balls have landed, clean up and hand off
            doneCount++;
            if (doneCount === stackSize) {
              flyEls.forEach(el => el.remove());
              ballEls.forEach(el => (el.style.opacity = ''));
              G.isAnimating = false;
              afterCb();
            }
          }, T_DROP + 20);
        }, T_SLIDE + 20);
      }, T_RISE + 20);
    });
  }

  // Launch all balls with a stagger so they flow continuously rather than waiting
  for (let i = 0; i < stackSize; i++) {
    setTimeout(() => startBall(i), i * STAGGER);
  }
}

// ── Event Handlers ─────────────────────────────────────────────────────────────
function onTubeClick(idx) {
  if (G.isAnimating) return;
  clearHint();

  // ── Nothing selected ─────────────────────────────────────────────────────
  if (G.selectedTube === null) {
    const tube = G.tubes[idx];
    if (tube.length > 0 && !isSolved(tube)) {
      G.selectedTube = idx;
      SFX.select();
      render();
    }
    return;
  }

  // ── Tap same tube → deselect ──────────────────────────────────────────────
  if (G.selectedTube === idx) {
    G.selectedTube = null;
    SFX.deselect();
    render();
    return;
  }

  // ── Attempt move ──────────────────────────────────────────────────────────
  if (canMove(G.selectedTube, idx)) {
    const from     = G.selectedTube;
    G.selectedTube = null;
    render();  // remove selection highlight before animation starts

    animateAndMove(from, idx, () => {
      doMove(from, idx);
      const justCompleted = isSolved(G.tubes[idx]);
      render();

      if (checkWin()) {
        setTimeout(showWin, 480);
      } else {
        justCompleted ? SFX.complete() : SFX.land();
        // Kiểm tra xem còn nước đi nào không (bị kẹt / hết nước đi)
        if (!hasAnyValidMoves()) {
          setTimeout(showNoMoves, 600);
        }
      }
    });
  } else {
    // Invalid target – buzz and optionally switch selection
    SFX.invalid();
    const tube = G.tubes[idx];
    if (tube.length > 0 && !isSolved(tube)) {
      G.selectedTube = idx;
      SFX.select();
    } else {
      G.selectedTube = null;
      SFX.deselect();
    }
    render();
  }
}

function onHint() {
  if (G.isAnimating) return;
  clearHint();
  const hint = getHint();
  if (!hint) { showToast('<i class="fa-solid fa-triangle-exclamation" style="color:#e74c3c;margin-right:6px;"></i> Không còn nước đi hợp lệ!'); return; }
  G.hintsUsed++;
  G.selectedTube = null;
  render();
  const ft = document.getElementById(`tube-${hint.from}`);
  const tt = document.getElementById(`tube-${hint.to}`);
  if (ft) ft.classList.add('hint-from');
  if (tt) tt.classList.add('hint-to');
  G.hintTimer = setTimeout(clearHint, 3200);
}

function clearHint() {
  clearTimeout(G.hintTimer);
  document.querySelectorAll('.hint-from,.hint-to')
    .forEach(el => el.classList.remove('hint-from', 'hint-to'));
}

function onUndo() {
  if (!G.undoStack.length || G.isAnimating) return;
  hideNoMoves();
  G.tubes     = G.undoStack.pop();
  G.moveCount = Math.max(0, G.moveCount - 1);
  G.selectedTube = null;
  SFX.select();
  clearHint();
  render();
}

function onReset() {
  hideNoMoves();
  G.tubes        = cloneTubes(G.initialTubes);
  G.moveCount    = 0;
  G.undoStack    = [];
  G.selectedTube = null;
  G.hintsUsed    = 0;
  G.isAnimating  = false;
  clearHint();
  render();
}

function onNextLevel() {
  hideNoMoves();
  document.getElementById('win-overlay').classList.remove('show');
  document.getElementById('win-overlay').setAttribute('aria-hidden', 'true');
  G.level++;
  startLevel(G.level);
}

// ── No Moves Screen ────────────────────────────────────────────────────────────
function showNoMoves() {
  const overlay = document.getElementById('no-moves-overlay');
  if (!overlay) return;
  SFX.stuck();
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
}

function hideNoMoves() {
  const overlay = document.getElementById('no-moves-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

// ── Win Screen ─────────────────────────────────────────────────────────────────
function showWin() {
  document.getElementById('win-moves').textContent = `Hoàn thành trong ${G.moveCount} bước!`;

  const starsEl = document.getElementById('win-stars');
  starsEl.innerHTML = '';
  const stars = calcStars();
  for (let i = 1; i <= 3; i++) {
    const s = document.createElement('span');
    s.className   = 'win-star' + (i <= stars ? ' active' : '');
    s.innerHTML   = i <= stars ? '<i class="fa-solid fa-star" style="color: #f1c40f;"></i>' : '<i class="fa-regular fa-star" style="color: rgba(255,255,255,0.3);"></i>';
    starsEl.appendChild(s);
  }

  // Cập nhật màn chơi mở khóa tiếp theo vào LocalStorage ngay khi chiến thắng
  const nextLvl = G.level + 1;
  const currentData = loadGameData();
  const newMax = Math.max(currentData.maxLevel, nextLvl);
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    maxLevel: newMax,
    currentLevel: nextLvl
  }));

  // Tự động lưu điểm lên Firebase (G.level = Màn vừa vượt qua)
  const savedName = localStorage.getItem('captain_player_name') || 'Chưa cập nhật';
  if (window.saveScoreToFirebase) {
    window.saveScoreToFirebase(savedName, G.level, G.moveCount || 0, 'xep-bong').then(res => {
      if (res.success && res.updated) {
        showToast('<i class="fa-solid fa-trophy" style="color:#f1c40f;margin-right:6px;"></i> Kỷ lục mới đã được lưu tự động!');
      }
    });
  }

  // Kiểm tra nếu đã chơi hoàn thành màn cuối cùng của Tổng số màn thử thách
  const liveCompleteCard = document.getElementById('live-complete-card');
  const btnNext = document.getElementById('btn-next');

  if (liveCompleteCard) {
    if (G.level >= liveData.totalLevels) {
      liveCompleteCard.style.display = 'block';
      if (btnNext) btnNext.style.display = 'none';
    } else {
      liveCompleteCard.style.display = 'none';
      if (btnNext) btnNext.style.display = 'inline-flex';
    }
  }

  const overlay = document.getElementById('win-overlay');
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');

  SFX.win();
  launchConfetti();
}

function launchConfetti() {
  const palette = ['#ff6b6b','#ffeaa7','#55efc4','#a29bfe','#74b9ff','#fd79a8','#81ecec','#b8e994'];
  for (let i = 0; i < 90; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      const s = 5 + Math.random() * 9;
      p.style.cssText = `
        position:fixed; border-radius:${Math.random() > .5 ? '50%' : '3px'};
        pointer-events:none; z-index:9997;
        width:${s}px; height:${s}px;
        background:${palette[Math.floor(Math.random() * palette.length)]};
        left:${Math.random() * 100}vw; top:-12px;
        animation:confetti-fall ${1.1 + Math.random() * 1.8}s ease-out ${Math.random() * 0.6}s forwards;
      `;
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 3800);
    }, i * 22);
  }
}

// ── Toast Stack (Thông báo mới sẽ rơi xuống đè lên thông báo cũ) ──────────────
function showToast(msg, duration = 5000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.getElementById('toast');
    if (!container) return;
  }

  const toastItem = document.createElement('div');
  toastItem.className = 'toast-item';
  toastItem.innerHTML = msg;

  // Thêm thông báo mới vào ĐẦU container (hiện lên trên cùng đè lên thông báo cũ)
  container.insertBefore(toastItem, container.firstChild);

  // Giới hạn tối đa 2 thông báo hiển thị cùng lúc
  while (container.children.length > 2) {
    container.lastChild.remove();
  }

  // Tự động mờ dần và biến mất sau duration
  setTimeout(() => {
    toastItem.classList.add('hiding');
    setTimeout(() => {
      if (toastItem.parentNode) {
        toastItem.parentNode.removeChild(toastItem);
      }
    }, 350);
  }, duration);
}

// ── Level Init ─────────────────────────────────────────────────────────────────
function startLevel(level) {
  hideNoMoves();
  G.level        = level;
  const cfg      = getLevelConfig(level);
  G.config       = cfg;
  G.tubes        = generateLevel(cfg);
  G.initialTubes = cloneTubes(G.tubes);
  G.selectedTube = null;
  G.moveCount    = 0;
  G.undoStack    = [];
  G.hintsUsed    = 0;
  G.isAnimating  = false;
  clearHint();
  render();
  saveGame();
  // Re-apply sizing after overlays close so tubes-area has real dimensions
  setTimeout(() => { applyLevelSizing(); renderTubes(); }, 80);
  setTimeout(() => { applyLevelSizing(); renderTubes(); }, 300);
}

// ── Persistence ────────────────────────────────────────────────────────────────

/**
 * Đọc dữ liệu tiến trình từ localStorage.
 * Trả về { maxLevel, currentLevel }
 */
function loadGameData() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { maxLevel: 1, currentLevel: 1 };
    const d = JSON.parse(raw);
    const maxLevel = Math.max(1, typeof d.maxLevel === 'number' ? d.maxLevel : (typeof d.level === 'number' ? d.level : 1));
    const currentLevel = Math.max(1, typeof d.currentLevel === 'number' ? d.currentLevel : (typeof d.level === 'number' ? d.level : 1));
    return { maxLevel, currentLevel };
  } catch (_) {
    return { maxLevel: 1, currentLevel: 1 };
  }
}

/**
 * Lưu tiến trình:
 * - currentLevel: màn vừa chơi / vừa chọn
 * - maxLevel: màn cao nhất đạt được (không bao giờ bị giảm khi chơi lại màn cũ)
 */
function saveGame() {
  try {
    const current = loadGameData();
    const newMaxLevel = Math.max(current.maxLevel, G.level || 1);
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      maxLevel:     newMaxLevel,
      currentLevel: G.level || 1
    }));
  } catch (_) {}
}

// ── Menu Screen ────────────────────────────────────────────────────────────────
function showMenu() {
  const overlay = document.getElementById('menu-overlay');
  const { maxLevel, currentLevel } = loadGameData();
  const displayLevel = Math.max(maxLevel, currentLevel);

  const descEl = document.getElementById('menu-continue-desc');
  const statsEl = document.getElementById('menu-stats');

  if (descEl) descEl.textContent = `Màn ${displayLevel} (Tiếp tục)`;

  // Kiểm tra thứ hạng trên Firebase (chỉ hiển thị riêng thứ hạng nếu thuộc Top 1000)
  if (statsEl) {
    statsEl.style.display = 'none'; // Tạm ẩn mặc định
    if (window.getMyRank) {
      window.getMyRank('xep-bong').then(rank => {
        if (rank && rank <= 1000) {
          statsEl.innerHTML = `<i class="fa-solid fa-trophy trophy-icon" style="color:#f1c40f;"></i> <span>Thứ Hạng Của Bạn: <strong class="rank-highlight">Top ${rank}</strong></span>`;
          statsEl.style.display = 'inline-flex';
        }
      });
    }
  }

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
}

function hideMenu() {
  const overlay = document.getElementById('menu-overlay');
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
function init() {
  renderTickerBanner();
  renderPauseBanner();

  const btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.addEventListener('click', onNextLevel);

  // Home button
  const btnHome = document.getElementById('btn-home');
  if (btnHome) {
    btnHome.addEventListener('click', () => {
      SFX.select();
      showMenu();
    });
  }

  // Menu: Chơi Thường (Classic Mode - Ẩn hoàn toàn tính năng TikTok Live)
  const btnClassic = document.getElementById('btn-menu-classic');
  if (btnClassic) {
    btnClassic.addEventListener('click', () => {
      SFX.select();
      hideMenu();
      G.isLiveMode = false;
      const { maxLevel, currentLevel } = loadGameData();
      const playLevel = Math.max(maxLevel, currentLevel);
      startLevel(playLevel);
      renderHeader();
      renderTickerBanner();
      renderPauseBanner();
      setTimeout(() => showToast(`<i class="fa-solid fa-gamepad" style="margin-right:6px;"></i> Bắt đầu Chơi Thường - Màn ${playLevel}`), 300);
    });
  }

  // Menu: Chơi TikTok Live (Interactive Mode)
  const btnTikTok = document.getElementById('btn-menu-tiktok');
  if (btnTikTok) {
    btnTikTok.addEventListener('click', () => {
      SFX.select();
      hideMenu();
      G.isLiveMode = true;
      startLevel(1);
      renderHeader();
      renderTickerBanner();
      renderPauseBanner();
      setTimeout(() => showToast(`<i class="fa-brands fa-tiktok" style="color:#ff0050;margin-right:6px;"></i> Bắt đầu Chế Độ TikTok Live!`), 300);
    });
  }



  // Menu: Nút Đăng Nhập / Đăng Xuất Google
  const btnAuth = document.getElementById('btn-menu-auth');
  const authTitle = document.getElementById('auth-btn-title');
  const authSub = document.getElementById('auth-btn-sub');
  const authIcon = document.getElementById('auth-btn-icon');

  window.onUserAuthChanged = async (user) => {
    if (user) {
      if (authTitle) authTitle.textContent = user.displayName || 'Đã đăng nhập';
      if (authSub) authSub.textContent = 'Đăng xuất tài khoản';
      if (authIcon) {
        if (user.photoURL) {
          authIcon.innerHTML = `<img src="${user.photoURL}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" />`;
        } else {
          authIcon.innerHTML = `<i class="fa-solid fa-user-check"></i>`;
        }
      }
      // Tự động đồng bộ tiến trình (2 chiều Cloud <-> Local)
      // Lưu ý: level trên Cloud đại diện cho "Màn đã vượt qua" (Passed Level)
      let { maxLevel, currentLevel } = loadGameData();
      let localMax = Math.max(maxLevel, currentLevel);

      if (window.getUserScoreFromFirebase) {
        const cloudData = await window.getUserScoreFromFirebase('xep-bong');
        const cloudPassedLevel = cloudData ? Number(cloudData.level) || 0 : 0;
        // Nếu đã vượt qua màn X trên cloud -> Màn hiện tại cần chơi sẽ là X + 1
        const cloudNextLevel = cloudPassedLevel > 0 ? cloudPassedLevel + 1 : 1;

        if (cloudNextLevel > localMax) {
          // Cloud có tiến trình cao hơn -> Cập nhật local màn chơi hiện tại là cloudNextLevel
          localStorage.setItem(SAVE_KEY, JSON.stringify({
            maxLevel: cloudNextLevel,
            currentLevel: cloudNextLevel
          }));
          startLevel(cloudNextLevel);
          showToast(`<i class="fa-solid fa-cloud-arrow-down" style="margin-right:6px;"></i> Đã khôi phục tiến trình Màn ${cloudNextLevel} từ tài khoản!`);
        } else {
          // Local có tiến trình bằng hoặc cao hơn -> Đẩy màn đã vượt qua (localMax - 1) lên Cloud
          localStorage.setItem(SAVE_KEY, JSON.stringify({
            maxLevel: localMax,
            currentLevel: localMax
          }));
          const passedLevelToSave = Math.max(1, localMax - 1);
          if (window.saveScoreToFirebase && passedLevelToSave >= 1) {
            await window.saveScoreToFirebase(user.displayName, passedLevelToSave, 0, 'xep-bong');
          }
        }
      }
    } else {
      if (authTitle) authTitle.textContent = 'Đăng nhập Google';
      if (authSub) authSub.textContent = 'Đồng bộ tên & avatar';
      if (authIcon) authIcon.innerHTML = `<i class="fa-brands fa-google"></i>`;
    }
    // Cập nhật lại UI menu nếu đang mở
    showMenu();
  };

  if (btnAuth) {
    btnAuth.addEventListener('click', async () => {
      SFX.select();
      if (authTitle && authTitle.textContent.includes('Đăng nhập')) {
        if (window.loginWithGoogle) {
          showToast('<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> Đang mở trang đăng nhập Google...');
          const res = await window.loginWithGoogle();
          if (res.success) {
            showToast(`<i class="fa-solid fa-hand" style="margin-right:6px;"></i> Xin chào, ${res.user.displayName}!`);
          }
        }
      } else {
        // Hiển thị dialog xác nhận trước khi đăng xuất
        const confirmOverlay = document.getElementById('confirm-overlay');
        if (confirmOverlay) {
          confirmOverlay.classList.add('show');
          confirmOverlay.removeAttribute('aria-hidden');
        }
      }
    });
  }

  // Confirm dialog: Hủy
  const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener('click', () => {
      SFX.select();
      const confirmOverlay = document.getElementById('confirm-overlay');
      if (confirmOverlay) {
        confirmOverlay.classList.remove('show');
        confirmOverlay.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // Confirm dialog: Xác nhận đăng xuất
  const btnConfirmOk = document.getElementById('btn-confirm-ok');
  if (btnConfirmOk) {
    btnConfirmOk.addEventListener('click', async () => {
      SFX.select();
      const confirmOverlay = document.getElementById('confirm-overlay');
      if (confirmOverlay) {
        confirmOverlay.classList.remove('show');
        confirmOverlay.setAttribute('aria-hidden', 'true');
      }
      if (window.logoutGoogle) {
        await window.logoutGoogle();
        localStorage.removeItem(SAVE_KEY); // Reset tiến trình local về Màn 1 khi đăng xuất
        startLevel(1);
        showMenu();
        showToast('<i class="fa-solid fa-right-from-bracket" style="margin-right:6px;"></i> Đã đăng xuất! Tiến trình đã đặt lại Màn 1');
      }
    });
  }


  // Menu: Nút Bảng Xếp Hạng
  const btnLeaderboard = document.getElementById('btn-menu-leaderboard');
  if (btnLeaderboard) {
    btnLeaderboard.addEventListener('click', () => {
      SFX.select();
      showLeaderboardOverlay();
    });
  }

  // Leaderboard: Nút quay lại Menu
  const btnLeaderboardBack = document.getElementById('btn-leaderboard-back');
  if (btnLeaderboardBack) {
    btnLeaderboardBack.addEventListener('click', () => {
      SFX.select();
      hideLeaderboardOverlay();
    });
  }

  // Level select: Nút quay lại Menu
  const btnLevelsBack = document.getElementById('btn-levels-back');
  if (btnLevelsBack) {
    btnLevelsBack.addEventListener('click', () => {
      SFX.select();
      hideLevelsOverlay();
    });
  }

  // No-moves (Hết nước đi) modal buttons
  const btnNoMoveUndo = document.getElementById('btn-nomove-undo');
  if (btnNoMoveUndo) {
    btnNoMoveUndo.addEventListener('click', () => {
      if (G.undoStack.length) {
        onUndo();
      } else {
        onReset();
      }
    });
  }

  const btnNoMoveReset = document.getElementById('btn-nomove-reset');
  if (btnNoMoveReset) {
    btnNoMoveReset.addEventListener('click', onReset);
  }

  // Sound control UI & popover
  const btnSound = document.getElementById('btn-sound');
  const soundPopover = document.getElementById('sound-popover');
  const soundSlider = document.getElementById('sound-slider');
  const soundVolumeVal = document.getElementById('sound-volume-val');
  const soundIcon = document.getElementById('sound-icon');
  const btnMuteToggle = document.getElementById('btn-mute-toggle');

  function updateSoundUI() {
    const volPercent = Math.round(soundVolume * 100);
    if (soundSlider) soundSlider.value = volPercent;
    if (soundVolumeVal) soundVolumeVal.textContent = isSoundMuted ? 'Tắt' : `${volPercent}%`;

    if (btnSound) {
      if (isSoundMuted || soundVolume === 0) {
        btnSound.classList.add('muted');
        if (soundIcon) soundIcon.className = 'fa-solid fa-volume-xmark';
      } else if (soundVolume < 0.5) {
        btnSound.classList.remove('muted');
        if (soundIcon) soundIcon.className = 'fa-solid fa-volume-low';
      } else {
        btnSound.classList.remove('muted');
        if (soundIcon) soundIcon.className = 'fa-solid fa-volume-high';
      }
    }

    if (btnMuteToggle) {
      btnMuteToggle.innerHTML = isSoundMuted 
        ? '<i class="fa-solid fa-volume-xmark" style="color:#ff7675;"></i>'
        : '<i class="fa-solid fa-volume-high"></i>';
    }
  }

  updateSoundUI();

  if (btnSound && soundPopover) {
    btnSound.addEventListener('click', (e) => {
      e.stopPropagation();
      soundPopover.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!soundPopover.contains(e.target) && e.target !== btnSound && !btnSound.contains(e.target)) {
        soundPopover.classList.remove('show');
      }
    });
  }

  if (soundSlider) {
    soundSlider.addEventListener('input', (e) => {
      const val = Number(e.target.value);
      soundVolume = val / 100;
      if (soundVolume > 0 && isSoundMuted) {
        isSoundMuted = false;
      }
      saveSoundSettings();
      updateSoundUI();
    });

    soundSlider.addEventListener('change', () => {
      SFX.select();
    });
  }

  if (btnMuteToggle) {
    btnMuteToggle.addEventListener('click', () => {
      isSoundMuted = !isSoundMuted;
      saveSoundSettings();
      updateSoundUI();
      if (!isSoundMuted) SFX.select();
    });
  }

  // Khởi tạo hiệu ứng con trỏ chuột tùy chỉnh và vệt lấp lánh
  setupCustomCursor();

  // Hiển thị màn hình chính lúc ban đầu
  showMenu();
}

/** ── Mouse Bubbles & Sparkle Particles (Around default cursor) ─── */
function setupCustomCursor() {
  if (window.matchMedia('(hover: none)').matches) return; // Bỏ qua trên màn cảm ứng điện thoại

  let lastParticleTime = 0;
  // Bảng màu viền và ánh sáng cho bong bóng trong suốt
  const colors = [
    { border: 'rgba(124, 111, 238, 0.75)', glow: 'rgba(124, 111, 238, 0.45)', bg: 'rgba(124, 111, 238, 0.08)' },
    { border: 'rgba(116, 185, 255, 0.75)', glow: 'rgba(116, 185, 255, 0.45)', bg: 'rgba(116, 185, 255, 0.08)' },
    { border: 'rgba(85, 239, 196, 0.75)',  glow: 'rgba(85, 239, 196, 0.45)',  bg: 'rgba(85, 239, 196, 0.08)' },
    { border: 'rgba(255, 234, 167, 0.75)', glow: 'rgba(255, 234, 167, 0.45)', bg: 'rgba(255, 234, 167, 0.08)' },
    { border: 'rgba(253, 121, 168, 0.75)', glow: 'rgba(253, 121, 168, 0.45)', bg: 'rgba(253, 121, 168, 0.08)' },
    { border: 'rgba(255, 159, 243, 0.75)', glow: 'rgba(255, 159, 243, 0.45)', bg: 'rgba(255, 159, 243, 0.08)' },
    { border: 'rgba(129, 236, 236, 0.75)', glow: 'rgba(129, 236, 236, 0.45)', bg: 'rgba(129, 236, 236, 0.08)' },
  ];

  function createBubble(x, y) {
    const p = document.createElement('div');
    p.className = 'cursor-particle';

    const isBubble = Math.random() > 0.35; // Ưu tiên phần lớn là bong bóng trong suốt
    const size = isBubble ? (Math.floor(Math.random() * 9) + 7) : (Math.floor(Math.random() * 3) + 2);
    const colorObj = colors[Math.floor(Math.random() * colors.length)];
    
    // Tỏa nhẹ quanh vị trí chuột
    const angle = Math.random() * Math.PI * 2;
    const distance = Math.random() * 18 + 4;
    const offsetX = Math.cos(angle) * distance;
    const offsetY = Math.sin(angle) * distance;

    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.left = `${x + offsetX}px`;
    p.style.top = `${y + offsetY}px`;

    if (isBubble) {
      // Bong bóng thủy tinh siêu trong suốt: chỉ rõ đường viền mỏng và đốm sáng phản quang nhỏ
      p.style.background = `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.45) 0%, ${colorObj.bg} 40%, rgba(255,255,255,0.02) 80%)`;
      p.style.border = `1px solid ${colorObj.border}`;
      p.style.boxShadow = `0 0 6px ${colorObj.glow}, inset 0 0 4px rgba(255,255,255,0.35)`;
      p.style.backdropFilter = 'blur(0.5px)';
    } else {
      // Hạt bụi sáng nhỏ li ti
      p.style.backgroundColor = colorObj.border;
      p.style.boxShadow = `0 0 6px ${colorObj.glow}`;
      p.style.opacity = '0.7';
    }

    document.body.appendChild(p);
    setTimeout(() => p.remove(), 750);
  }

  window.addEventListener('mousemove', (e) => {
    const now = performance.now();
    // Tạo bong bóng và hạt bụi bay nhẹ quanh chuột khi di chuyển
    if (now - lastParticleTime > 26) {
      createBubble(e.clientX, e.clientY);
      lastParticleTime = now;
    }
  }, { passive: true });
}

/** Hiển thị Leaderboard Overlay */
async function showLeaderboardOverlay() {
  const overlay = document.getElementById('leaderboard-overlay');
  const listEl = document.getElementById('leaderboard-list');
  if (!overlay || !listEl) return;

  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
  listEl.innerHTML = '<li class="lb-loading">Đang tải dữ liệu từ Firebase...</li>';

  if (window.getTopScoresFromFirebase) {
    const scores = await window.getTopScoresFromFirebase('xep-bong');
    if (!scores || scores.length === 0) {
      listEl.innerHTML = '<li class="lb-loading">Chưa có điểm số nào. Hãy là người đầu tiên!</li>';
      return;
    }

    listEl.innerHTML = scores.map((item, idx) => {
      const rank = idx + 1;
      const rankClass = rank <= 3 ? `lb-rank-${rank}` : '';
      const avatarHtml = item.avatar ? `<img src="${item.avatar}" class="lb-avatar" alt="${escapeHtml(item.name)}" />` : '';
      // Hiển thị ngày đạt được level (từ timestamp Firestore)
      let dateStr = '';
      if (item.timestamp) {
        const ms = item.timestamp.toMillis ? item.timestamp.toMillis() : Number(item.timestamp);
        if (!isNaN(ms)) {
          const d = new Date(ms);
          dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()}`;
        }
      }
      const metaHtml = dateStr ? `<span class="lb-meta">Đạt được: ${dateStr}</span>` : '';
      return `
        <li class="lb-item">
          <div class="lb-rank ${rankClass}">${rank}</div>
          ${avatarHtml}
          <div class="lb-info">
            <span class="lb-name">${escapeHtml(item.name || 'Chưa cập nhật')}</span>
            ${metaHtml}
          </div>
          <div class="lb-badge">Màn ${item.level}</div>
        </li>
      `;
    }).join('');
  } else {
    listEl.innerHTML = '<li class="lb-loading">Lỗi kết nối SDK Firebase!</li>';
  }
}

/** Ẩn Leaderboard Overlay */
function hideLeaderboardOverlay() {
  const overlay = document.getElementById('leaderboard-overlay');
  if (overlay) {
    overlay.classList.remove('show');
    overlay.setAttribute('aria-hidden', 'true');
  }
}

/** Helper escape HTML tránh XSS */
function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

window.addEventListener('resize', () => {
  if (G.config) { applyLevelSizing(); renderTubes(); }
});

document.addEventListener('DOMContentLoaded', init);

