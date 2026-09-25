'use strict';

/* ═══════════════════════════════════════════════════════════════
   Xếp Số – game.js  (Number Sliding Puzzle / N-Puzzle)
   ═══════════════════════════════════════════════════════════════ */

// ── Constants ──────────────────────────────────────────────────
const SAVE_KEY = 'xepso_v1';
const GAME_ID_PREFIX = 'xep-so-'; // e.g. xep-so-3, xep-so-4, xep-so-5

const DIFFICULTY = {
  3: 'DỄ',
  4: 'TRUNG BÌNH',
  5: 'KHÓ',
  6: 'THÁCH THỨC',
  7: 'SIÊU CẤP',
  8: 'CHUYÊN GIA',
  9: 'HUYỀN THOẠI',
  10: 'THẦN THOẠI'
};
const SHUFFLE_MOVES = {
  3: 60, 4: 150, 5: 300, 6: 500, 7: 700, 8: 900, 9: 1200, 10: 1500
};

// ── Sound System ────────────────────────────────────────────────
let _ctx = null;
function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}
function snd(fn) { try { fn(getCtx()); } catch (_) {} }

const SFX = {
  slide() {
    snd(ctx => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(360, t + 0.08);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
      osc.start(t); osc.stop(t + 0.12);
    });
  },
  win() {
    snd(ctx => {
      [523, 659, 784, 1047].forEach((freq, i) => {
        const t = ctx.currentTime + i * 0.12;
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.type = 'triangle'; osc.frequency.value = freq;
        g.gain.setValueAtTime(0.18, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.35);
      });
    });
  },
  select() {
    snd(ctx => {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.connect(g); g.connect(ctx.destination);
      osc.type = 'sine'; osc.frequency.value = 660;
      g.gain.setValueAtTime(0.1, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.start(t); osc.stop(t + 0.1);
    });
  }
};

// ── Game State ──────────────────────────────────────────────────
const G = {
  size: 3,
  tiles: [],      // 1D array, 0 = empty
  emptyIdx: 0,
  moves: 0,
  won: false,
  timerSecs: 0,
  timerInterval: null,
  running: false
};

// ── Helpers ─────────────────────────────────────────────────────

/** Create the solved state: [1,2,...,n*n-1, 0] */
function solvedState(size) {
  const arr = [];
  for (let i = 1; i < size * size; i++) arr.push(i);
  arr.push(0);
  return arr;
}

/** Check if puzzle is solvable (standard N-puzzle solvability) */
function isSolvable(arr, size) {
  let inv = 0;
  const flat = arr.filter(x => x !== 0);
  for (let i = 0; i < flat.length; i++)
    for (let j = i + 1; j < flat.length; j++)
      if (flat[i] > flat[j]) inv++;
  if (size % 2 === 1) return inv % 2 === 0;
  const emptyRow = Math.floor(arr.indexOf(0) / size);
  const emptyFromBottom = size - emptyRow;
  return (emptyFromBottom % 2 === 0) ? (inv % 2 === 1) : (inv % 2 === 0);
}

/** Get valid slide targets for empty cell */
function getNeighbors(emptyIdx, size) {
  const row = Math.floor(emptyIdx / size);
  const col = emptyIdx % size;
  const nb = [];
  if (row > 0) nb.push(emptyIdx - size);
  if (row < size - 1) nb.push(emptyIdx + size);
  if (col > 0) nb.push(emptyIdx - 1);
  if (col < size - 1) nb.push(emptyIdx + 1);
  return nb;
}

/** Shuffle by making random valid moves (guarantees solvability) */
function shuffleTiles(size) {
  const arr = solvedState(size);
  let emptyIdx = arr.length - 1;
  let lastMove = -1;
  const moves = SHUFFLE_MOVES[size];
  for (let i = 0; i < moves; i++) {
    const nb = getNeighbors(emptyIdx, size).filter(n => n !== lastMove);
    const target = nb[Math.floor(Math.random() * nb.length)];
    [arr[emptyIdx], arr[target]] = [arr[target], arr[emptyIdx]];
    lastMove = emptyIdx;
    emptyIdx = target;
  }
  return { tiles: arr, emptyIdx };
}

/** Check if current state is solved */
function isSolved(tiles, size) {
  const goal = solvedState(size);
  return tiles.every((v, i) => v === goal[i]);
}

// ── Persistence ─────────────────────────────────────────────────
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      size: G.size, tiles: G.tiles, emptyIdx: G.emptyIdx,
      moves: G.moves, timerSecs: G.timerSecs
    }));
  } catch (_) {}
}

function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

// ── Timer ────────────────────────────────────────────────────────
function startTimer() {
  if (G.timerInterval) clearInterval(G.timerInterval);
  G.timerInterval = setInterval(() => {
    G.timerSecs++;
    updateTimerDisplay();
  }, 1000);
}
function stopTimer() {
  if (G.timerInterval) clearInterval(G.timerInterval);
  G.timerInterval = null;
}
function resetTimer() { stopTimer(); G.timerSecs = 0; updateTimerDisplay(); }
function updateTimerDisplay() {
  const m = Math.floor(G.timerSecs / 60);
  const s = G.timerSecs % 60;
  const el = document.getElementById('timer-display');
  if (el) el.textContent = `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Render ────────────────────────────────────────────────────────
function applyBoardSizing() {
  const root = document.documentElement;
  const size = G.size || 3;
  const board = document.getElementById('puzzle-board');
  const boardArea = document.querySelector('.board-area');
  const pauseBtn = document.getElementById('btn-pause');

  if (!boardArea) return;

  // Use clientWidth/clientHeight for reliable measurement even before layout
  const areaW = boardArea.clientWidth || boardArea.offsetWidth || window.innerWidth;
  const areaH = boardArea.clientHeight || boardArea.offsetHeight || (window.innerHeight - 60);
  const pauseH = pauseBtn ? (pauseBtn.offsetHeight || 32) + 8 : 0;

  // Available space: full area minus pause button height and small padding
  const availW = Math.max(60, areaW - 8);
  const availH = Math.max(60, areaH - pauseH - 8);

  const gap = size >= 9 ? 2 : size >= 7 ? 3 : size >= 5 ? 4 : size >= 4 ? 5 : 7;

  const maxTileW = Math.floor((availW - (size - 1) * gap) / size);
  const maxTileH = Math.floor((availH - (size - 1) * gap) / size);

  let tileSize = Math.min(maxTileW, maxTileH);
  tileSize = Math.max(20, tileSize);

  const fontRatio = size >= 9 ? 0.38 : size >= 7 ? 0.42 : 0.48;
  const fontSize = Math.max(11, Math.floor(tileSize * fontRatio));
  const radius = Math.max(4, Math.floor(tileSize * 0.14));

  root.style.setProperty('--tile-size', `${tileSize}px`);
  root.style.setProperty('--tile-gap', `${gap}px`);
  root.style.setProperty('--tile-radius', `${radius}px`);

  if (board) board.style.fontSize = `${fontSize}px`;
}

function renderBoard() {
  const board = document.getElementById('puzzle-board');
  if (!board) return;

  board.className = 'puzzle-board';
  board.style.gridTemplateColumns = `repeat(${G.size}, var(--tile-size))`;

  board.innerHTML = '';
  G.tiles.forEach((val, idx) => {
    if (val === 0) {
      const empty = document.createElement('div');
      empty.className = 'tile-empty';
      empty.dataset.idx = idx;
      board.appendChild(empty);
    } else {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.val = val;
      tile.dataset.idx = idx;
      tile.dataset.row = Math.floor((val - 1) / G.size) % 8;
      tile.textContent = val;
      tile.setAttribute('role', 'gridcell');
      tile.setAttribute('aria-label', `Ô số ${val}`);

      tile.addEventListener('click', () => onTileClick(idx));
      board.appendChild(tile);
    }
  });

  // Apply sizing after DOM is in place so measurements are accurate
  requestAnimationFrame(() => applyBoardSizing());

  updateMoveCount();
}

function updateMoveCount() {
  const el = document.getElementById('move-count');
  if (el) el.textContent = G.moves;
}

function updateHeader() {
  const badge = document.getElementById('level-badge');
  const diffEl = document.getElementById('difficulty-name');
  if (badge) badge.textContent = `${G.size}×${G.size}`;
  if (diffEl) diffEl.textContent = DIFFICULTY[G.size] || '';
}

// ── Tile Interaction ──────────────────────────────────────────────
function onTileClick(tileIdx) {
  if (G.won || !G.running) return;

  const nb = getNeighbors(G.emptyIdx, G.size);
  if (!nb.includes(tileIdx)) return; // not adjacent to empty

  // Slide the tile
  G.tiles[G.emptyIdx] = G.tiles[tileIdx];
  G.tiles[tileIdx] = 0;
  G.emptyIdx = tileIdx;
  G.moves++;

  SFX.slide();
  renderBoard();
  saveGame();

  if (isSolved(G.tiles, G.size)) {
    onWin();
  }
}

// ── Win ───────────────────────────────────────────────────────────
function onWin() {
  G.won = true;
  G.running = false;
  stopTimer();

  SFX.win();
  spawnConfetti();

  const stars = calcStars();
  showWinOverlay(stars);

  // Save to Firebase
  const name = localStorage.getItem('captain_player_name') || 'Chưa cập nhật';
  const gameId = `${GAME_ID_PREFIX}${G.size}`;
  if (window.saveScoreToFirebase) {
    window.saveScoreToFirebase(name, G.moves, G.timerSecs, gameId).then(res => {
      if (res && res.success && res.updated) {
        showToast('<i class="fa-solid fa-trophy" style="color:#f1c40f;margin-right:6px;"></i> Kỷ lục mới được lưu!');
      }
    });
  }
}

function calcStars() {
  // Thresholds based on time (in seconds)
  const thresholds = {
    3: [30, 90],
    4: [90, 240],
    5: [180, 450],
    6: [300, 720],
    7: [450, 1080],
    8: [600, 1440],
    9: [900, 2160],
    10: [1200, 2880]
  };
  const [t3, t2] = thresholds[G.size] || [60, 180];
  if (G.timerSecs <= t3) return 3;
  if (G.timerSecs <= t2) return 2;
  return 1;
}

function showWinOverlay(stars) {
  const overlay = document.getElementById('win-overlay');
  const infoEl = document.getElementById('win-info');
  const starsEl = document.getElementById('win-stars');
  const harderBtn = document.getElementById('btn-harder');

  if (infoEl) infoEl.textContent = `Hoàn thành trong ${G.moves} bước – ${formatTime(G.timerSecs)}!`;

  if (starsEl) {
    starsEl.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
      const s = document.createElement('span');
      s.className = 'win-star';
      s.innerHTML = i <= stars
        ? '<i class="fa-solid fa-star" style="color:#fbbf24;filter:drop-shadow(0 0 8px #fbbf24);"></i>'
        : '<i class="fa-regular fa-star" style="color:rgba(255,255,255,0.2);"></i>';
      starsEl.appendChild(s);
    }
  }

  // Hide "Khó hơn" if already on 10×10
  if (harderBtn) harderBtn.style.display = G.size >= 10 ? 'none' : '';

  if (overlay) {
    overlay.classList.add('show');
    overlay.removeAttribute('aria-hidden');
  }
}

function hideWinOverlay() {
  const overlay = document.getElementById('win-overlay');
  if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
}

function formatTime(secs) {
  const m = Math.floor(secs / 60), s = secs % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Start New Game ────────────────────────────────────────────────
function startNewGame(size) {
  G.size = size;
  G.won = false;
  G.moves = 0;
  G.running = true;

  const { tiles, emptyIdx } = shuffleTiles(size);
  G.tiles = tiles;
  G.emptyIdx = emptyIdx;

  resetTimer();
  startTimer();
  renderBoard();
  updateHeader();
  saveGame();

  // Re-apply sizing after a short delay so overlays have closed and board-area
  // has its real dimensions available
  setTimeout(() => applyBoardSizing(), 50);
  setTimeout(() => applyBoardSizing(), 200);

  // Update menu desc
  updateMenuContinueDesc();
}

function updateMenuContinueDesc() {
  const el = document.getElementById('menu-continue-desc');
  if (el) el.textContent = `Chơi mới – ${G.size}×${G.size}`;
}

// ── Menu ──────────────────────────────────────────────────────────
function showMenu() {
  const overlay = document.getElementById('menu-overlay');
  if (overlay) overlay.classList.add('show');
  stopTimer();
  updateMenuContinueDesc();
  refreshMenuStats();
}

function hideMenu() {
  const overlay = document.getElementById('menu-overlay');
  if (overlay) overlay.classList.remove('show');
  if (!G.won && G.running) startTimer();
}

async function refreshMenuStats() {
  const statsEl = document.getElementById('menu-stats');
  if (!statsEl) return;
  statsEl.style.display = 'none';
  if (window.getMyRank) {
    const gameId = `${GAME_ID_PREFIX}${G.size}`;
    window.getMyRank(gameId).then(rank => {
      if (rank && rank <= 1000) {
        statsEl.innerHTML = `<i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> <span>Thứ hạng: <strong>Top ${rank}</strong> (${G.size}×${G.size})</span>`;
        statsEl.style.display = 'inline-flex';
      }
    });
  }
}

// ── Leaderboard ───────────────────────────────────────────────────
let currentLbSize = 3;

function showLeaderboardOverlay() {
  const overlay = document.getElementById('leaderboard-overlay');
  if (overlay) { overlay.classList.add('show'); overlay.removeAttribute('aria-hidden'); }
  currentLbSize = G.size;
  updateLbTabs();
  loadLeaderboard(currentLbSize);
}

function hideLeaderboardOverlay() {
  const overlay = document.getElementById('leaderboard-overlay');
  if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
}

function updateLbTabs() {
  document.querySelectorAll('.lb-tab').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.size) === currentLbSize);
  });
}

async function loadLeaderboard(size) {
  const listEl = document.getElementById('leaderboard-list');
  if (!listEl) return;
  listEl.innerHTML = '<li class="lb-loading"><i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i>Đang tải dữ liệu...</li>';

  const gameId = `${GAME_ID_PREFIX}${size}`;
  if (!window.getTopScoresFromFirebase) {
    listEl.innerHTML = '<li class="lb-loading">Chưa kết nối Firebase.</li>';
    return;
  }

  try {
    const scores = await window.getTopScoresFromFirebase(gameId);
    if (!scores || scores.length === 0) {
      listEl.innerHTML = '<li class="lb-loading">Chưa có điểm số nào. Hãy là người đầu tiên!</li>';
      return;
    }

    listEl.innerHTML = scores.map((s, i) => {
      const rank = i + 1;
      const rankClass = rank === 1 ? 'lb-rank-1' : rank === 2 ? 'lb-rank-2' : rank === 3 ? 'lb-rank-3' : '';
      const avatar = s.avatar
        ? `<img src="${s.avatar}" class="lb-avatar" alt="${s.name}" onerror="this.style.display='none'">`
        : `<div class="lb-avatar" style="background:linear-gradient(135deg,#6c5ce7,#a855f7);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;">${(s.name||'?')[0].toUpperCase()}</div>`;
      return `
        <li class="lb-item">
          <div class="lb-rank ${rankClass}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</div>
          ${avatar}
          <div class="lb-info">
            <span class="lb-name">${s.name || 'Ẩn danh'}</span>
            <span class="lb-meta">${s.moves || 0} bước</span>
          </div>
          <div class="lb-badge"><i class="fa-solid fa-clock" style="margin-right:4px;font-size:10px;"></i>${formatTime(s.level || 0)}</div>
        </li>`;
    }).join('');
  } catch (e) {
    listEl.innerHTML = '<li class="lb-loading">Lỗi tải dữ liệu.</li>';
  }
}

// ── Toast ──────────────────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = msg;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── Confetti ───────────────────────────────────────────────────────
function spawnConfetti() {
  const colors = ['#6c5ce7','#a855f7','#fbbf24','#00b894','#fd79a8','#74b9ff','#55efc4'];
  for (let i = 0; i < 60; i++) {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `
        left: ${Math.random() * 100}vw;
        top: -20px;
        background: ${colors[Math.floor(Math.random() * colors.length)]};
        width: ${6 + Math.random() * 8}px;
        height: ${6 + Math.random() * 8}px;
        border-radius: ${Math.random() > 0.5 ? '50%' : '3px'};
        animation-duration: ${1.5 + Math.random() * 2}s;
        animation-delay: 0s;
      `;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 3500);
    }, Math.random() * 600);
  }
}

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Load saved game or show menu
  const saved = loadGame();
  if (saved && saved.tiles && saved.tiles.length > 0) {
    G.size = saved.size || 3;
    G.tiles = saved.tiles;
    G.emptyIdx = saved.emptyIdx;
    G.moves = saved.moves || 0;
    G.timerSecs = saved.timerSecs || 0;
    G.won = false;
    G.running = true;
    renderBoard();
    updateHeader();
    updateTimerDisplay();
    startTimer();
    // Sync difficulty picker
    document.querySelectorAll('.diff-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.size) === G.size);
    });
    updateMenuContinueDesc();
  } else {
    G.size = 3;
    showMenu();
  }

  // ── Home button → show menu ──
  document.getElementById('btn-home')?.addEventListener('click', () => {
    SFX.select();
    showMenu();
  });

  // ── Pause Overlay logic ──
  function showPauseOverlay() {
    stopTimer();
    G.running = false;
    const overlay = document.getElementById('pause-overlay');
    if (overlay) { overlay.classList.add('show'); overlay.removeAttribute('aria-hidden'); }
  }

  function hidePauseOverlay() {
    const overlay = document.getElementById('pause-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
    if (!G.won) {
      G.running = true;
      startTimer();
    }
  }

  function togglePause() {
    const menuOverlay = document.getElementById('menu-overlay');
    const winOverlay = document.getElementById('win-overlay');
    const pauseOverlay = document.getElementById('pause-overlay');

    if (menuOverlay?.classList.contains('show') || winOverlay?.classList.contains('show')) {
      return;
    }

    if (pauseOverlay?.classList.contains('show')) {
      SFX.select();
      hidePauseOverlay();
    } else if (G.running) {
      SFX.select();
      showPauseOverlay();
    }
  }

  document.getElementById('btn-pause')?.addEventListener('click', () => {
    SFX.select();
    showPauseOverlay();
  });

  document.getElementById('btn-resume')?.addEventListener('click', () => {
    SFX.select();
    hidePauseOverlay();
  });

  document.getElementById('btn-pause-restart')?.addEventListener('click', () => {
    SFX.select();
    hidePauseOverlay();
    startNewGame(G.size);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      togglePause();
    }
  });

  // ── Difficulty Selection Overlay logic ──
  function showDiffModal() {
    const overlay = document.getElementById('diff-modal-overlay');
    if (overlay) { overlay.classList.add('show'); overlay.removeAttribute('aria-hidden'); }
  }

  function hideDiffModal() {
    const overlay = document.getElementById('diff-modal-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
  }

  document.getElementById('btn-diff-back')?.addEventListener('click', () => {
    SFX.select();
    hideDiffModal();
  });

  // ── Difficulty picker buttons (inside modal) ──
  document.querySelectorAll('.diff-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.select();
      document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      G.size = Number(btn.dataset.size);
      hideDiffModal();
      hideMenu();
      hideWinOverlay();
      startNewGame(G.size);
    });
  });

  // ── Menu: Chơi Ngay button → opens Difficulty Modal ──
  document.getElementById('btn-menu-start')?.addEventListener('click', () => {
    SFX.select();
    showDiffModal();
  });

  // ── Win: Play again ──
  document.getElementById('btn-play-again')?.addEventListener('click', () => {
    SFX.select();
    hideWinOverlay();
    startNewGame(G.size);
  });

  // ── Win: Harder ──
  document.getElementById('btn-harder')?.addEventListener('click', () => {
    SFX.select();
    hideWinOverlay();
    const next = Math.min(10, G.size + 1);
    G.size = next;
    // Update picker
    document.querySelectorAll('.diff-btn').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.size) === next);
    });
    startNewGame(next);
  });

  // ── Win: Home ──
  document.getElementById('btn-win-home')?.addEventListener('click', () => {
    SFX.select();
    hideWinOverlay();
    showMenu();
  });

  // ── Menu: Leaderboard ──
  document.getElementById('btn-menu-leaderboard')?.addEventListener('click', () => {
    SFX.select();
    showLeaderboardOverlay();
  });

  // ── Leaderboard: Back ──
  document.getElementById('btn-leaderboard-back')?.addEventListener('click', () => {
    SFX.select();
    hideLeaderboardOverlay();
  });

  // ── Leaderboard: Size tabs ──
  document.querySelectorAll('.lb-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.select();
      currentLbSize = Number(btn.dataset.size);
      updateLbTabs();
      loadLeaderboard(currentLbSize);
    });
  });

  // ── Auth button ──
  const btnAuth = document.getElementById('btn-menu-auth');
  const authTitle = document.getElementById('auth-btn-title');
  const authSub = document.getElementById('auth-btn-sub');
  const authIcon = document.getElementById('auth-btn-icon');

  window.onUserAuthChanged = async (user) => {
    if (user) {
      if (authTitle) authTitle.textContent = user.displayName || 'Đã đăng nhập';
      if (authSub) authSub.textContent = 'Đăng xuất tài khoản';
      if (authIcon) {
        authIcon.innerHTML = user.photoURL
          ? `<img src="${user.photoURL}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;">`
          : `<i class="fa-solid fa-user-check"></i>`;
      }
    } else {
      if (authTitle) authTitle.textContent = 'Đăng nhập Google';
      if (authSub) authSub.textContent = 'Đồng bộ tên & avatar';
      if (authIcon) authIcon.innerHTML = `<i class="fa-brands fa-google"></i>`;
    }
    refreshMenuStats();
  };

  if (btnAuth) {
    btnAuth.addEventListener('click', async () => {
      SFX.select();
      if (authTitle && authTitle.textContent.includes('Đăng nhập')) {
        if (window.loginWithGoogle) {
          showToast('<i class="fa-solid fa-spinner fa-spin" style="margin-right:6px;"></i> Đang mở đăng nhập Google...');
          const res = await window.loginWithGoogle();
          if (res.success) showToast(`<i class="fa-solid fa-hand" style="margin-right:6px;"></i> Xin chào, ${res.user.displayName}!`);
        }
      } else {
        const confirmOverlay = document.getElementById('confirm-overlay');
        if (confirmOverlay) { confirmOverlay.classList.add('show'); confirmOverlay.removeAttribute('aria-hidden'); }
      }
    });
  }

  // ── Confirm logout dialog ──
  document.getElementById('btn-confirm-cancel')?.addEventListener('click', () => {
    SFX.select();
    const overlay = document.getElementById('confirm-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
  });

  document.getElementById('btn-confirm-ok')?.addEventListener('click', async () => {
    SFX.select();
    const overlay = document.getElementById('confirm-overlay');
    if (overlay) { overlay.classList.remove('show'); overlay.setAttribute('aria-hidden', 'true'); }
    if (window.logoutGoogle) {
      await window.logoutGoogle();
      showToast('<i class="fa-solid fa-right-from-bracket" style="margin-right:6px;"></i> Đã đăng xuất!');
    }
  });

  window.addEventListener('resize', () => {
    applyBoardSizing();
  });

});
