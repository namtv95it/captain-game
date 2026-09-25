// ── Web Audio API Sound Generator ──
class SoundManager {
  constructor() {
    this.ctx = null;
    this.volume = parseFloat(localStorage.getItem('tim_so_volume') ?? '0.8');
    this.muted = localStorage.getItem('tim_so_muted') === 'true';
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playPop() {
    if (this.muted || this.volume <= 0) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);

    gain.gain.setValueAtTime(this.volume * 0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.08);
  }

  playWrong() {
    if (this.muted || this.volume <= 0) return;
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.linearRampToValueAtTime(120, now + 0.15);

    gain.gain.setValueAtTime(this.volume * 0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.15);
  }

  playHint() {
    if (this.muted || this.volume <= 0) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(this.volume * 0.3, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.06 + 0.15);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.15);
    });
  }

  playWin() {
    if (this.muted || this.volume <= 0) return;
    this.init();
    if (!this.ctx) return;

    const notes = [523.25, 659.25, 783.99, 1046.50];
    const now = this.ctx.currentTime;
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);
      gain.gain.setValueAtTime(this.volume * 0.4, now + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.3);
    });
  }
}

const sound = new SoundManager();

// ── Game State Variables ──
let currentLevel = parseInt(localStorage.getItem('tim_so_level') || '1');
let currentTargetNum = 1;
let maxNumber = 30;
let hintCount = 3;
let timerSeconds = 0;
let timerInterval = null;
let isGameActive = false;

// Zoom & Pan State
let scale = 1.0;
let initialFitScale = 1.0;
let panX = 0;
let panY = 0;
let isDragging = false;
let startX = 0;
let startY = 0;

// Board Dimensions
let boardWidth = 1200;
let boardHeight = 800;

// Colors Palette for numbers
const NEON_COLORS = [
  { bg: 'linear-gradient(135deg, #ff007f, #7f00ff)', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #00f2fe, #4facfe)', text: '#0b0f19' },
  { bg: 'linear-gradient(135deg, #ffb703, #ff0055)', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #00e676, #00b0ff)', text: '#0b0f19' },
  { bg: 'linear-gradient(135deg, #e100ff, #7f00ff)', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #ff9100, #ff3d00)', text: '#ffffff' },
  { bg: 'linear-gradient(135deg, #00e5ff, #1de9b6)', text: '#0b0f19' }
];

// DOM Elements
const boardViewport = document.getElementById('board-viewport');
const boardContent = document.getElementById('board-content');
const sideDigitsLeftEl = document.getElementById('side-digits-left');
const sideDigitsRightEl = document.getElementById('side-digits-right');
const levelBadgeEl = document.getElementById('level-badge');
const rangeInfoEl = document.getElementById('range-info');
const timerDisplayEl = document.getElementById('timer-display');
const hintBtn = document.getElementById('btn-hint');
const hintCountEl = document.getElementById('hint-count');

function updateTargetNumberDisplay() {
  const digitHTML = `<span class="side-digit pop-anim">${currentTargetNum}</span>`;
  
  [sideDigitsLeftEl, sideDigitsRightEl].forEach(container => {
    if (container) {
      container.innerHTML = digitHTML;
    }
  });
}

// Overlays
const menuOverlay = document.getElementById('menu-overlay');
const winOverlay = document.getElementById('win-overlay');
const leaderboardOverlay = document.getElementById('leaderboard-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const toastEl = document.getElementById('toast');

// Buttons
const btnHome = document.getElementById('btn-home');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnPauseRestart = document.getElementById('btn-pause-restart');
const btnPauseHome = document.getElementById('btn-pause-home');
const btnMenuStart = document.getElementById('btn-menu-start');
const btnMenuLeaderboard = document.getElementById('btn-menu-leaderboard');
const btnMenuAuth = document.getElementById('btn-menu-auth');
const btnLeaderboardBack = document.getElementById('btn-leaderboard-back');
const btnNext = document.getElementById('btn-next');
const btnSound = document.getElementById('btn-sound');
const soundPopover = document.getElementById('sound-popover');
const soundSlider = document.getElementById('sound-slider');
const soundVolumeVal = document.getElementById('sound-volume-val');
const btnMuteToggle = document.getElementById('btn-mute-toggle');
const soundIcon = document.getElementById('sound-icon');

// Zoom Toolbar Elements
const btnZoomIn = document.getElementById('btn-zoom-in');
const btnZoomOut = document.getElementById('btn-zoom-out');
const btnZoomReset = document.getElementById('btn-zoom-reset');
const zoomLevelText = document.getElementById('zoom-level-text');

// ── Initialize Game Setup ──
function init() {
  updateSoundUI();
  setupEventListeners();
  setupPanAndZoom();
  updateMenuState();
}

function updateMenuState() {
  const desc = document.getElementById('menu-continue-desc');
  if (desc) {
    const maxForLvl = Math.min(100, 30 + (currentLevel - 1) * 10);
    desc.textContent = `Màn ${currentLevel} (1 đến ${maxForLvl})`;
  }
}

// ── Level Start & Generation ──
function startLevel(lvl = currentLevel) {
  currentLevel = lvl;
  localStorage.setItem('tim_so_level', currentLevel);
  currentTargetNum = 1;
  maxNumber = Math.min(100, 30 + (currentLevel - 1) * 10);

  // Adjust board canvas size based on number density
  const areaPerNum = 28000;
  const totalArea = maxNumber * areaPerNum;
  boardWidth = Math.max(1200, Math.round(Math.sqrt(totalArea * 1.4)));
  boardHeight = Math.max(800, Math.round(boardWidth / 1.4));

  boardContent.style.width = `${boardWidth}px`;
  boardContent.style.height = `${boardHeight}px`;

  // UI updates
  levelBadgeEl.textContent = `Màn ${currentLevel}`;
  rangeInfoEl.textContent = `1 - ${maxNumber}`;
  updateTargetNumberDisplay();

  // Reset viewport zoom/pan to fit screen centered
  resetViewportTransform();

  // Generate numbers
  generateNumberBoard();

  // Start timer
  startTimer();

  // Hide overlays
  menuOverlay.setAttribute('aria-hidden', 'true');
  winOverlay.setAttribute('aria-hidden', 'true');
  leaderboardOverlay.setAttribute('aria-hidden', 'true');
  if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'true');
  isGameActive = true;
}

// Reset view transform to fit screen centered
function resetViewportTransform() {
  const vpWidth = boardViewport.clientWidth || window.innerWidth;
  const vpHeight = boardViewport.clientHeight || (window.innerHeight - 70);

  const scaleX = (vpWidth - 40) / boardWidth;
  const scaleY = (vpHeight - 40) / boardHeight;

  scale = Math.min(3.0, Math.max(0.3, Math.min(scaleX, scaleY)));
  initialFitScale = scale;
  panX = (vpWidth - boardWidth * scale) / 2;
  panY = (vpHeight - boardHeight * scale) / 2;
  applyTransform();
}

function applyTransform() {
  boardContent.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  const percent = Math.round((scale / (initialFitScale || scale)) * 100);
  zoomLevelText.textContent = `${percent}%`;
}

// ── Scatter Numbers Algorithm ──
function generateNumberBoard() {
  boardContent.innerHTML = '';

  // Render Chessboard Grid Overlay
  const gridOverlay = document.createElement('div');
  gridOverlay.className = 'board-grid-overlay';

  const cols = 8;
  const rows = 6;
  const rowNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const cellWidth = boardWidth / cols;
  const cellHeight = boardHeight / rows;

  // Top Column Headers (1, 2, 3, 4, 5, 6, 7, 8)
  for (let c = 0; c < cols; c++) {
    const colHeader = document.createElement('div');
    colHeader.className = 'grid-col-header';
    colHeader.style.left = `${c * cellWidth + cellWidth / 2}px`;
    colHeader.style.top = `-32px`;
    colHeader.textContent = c + 1;
    gridOverlay.appendChild(colHeader);
  }

  // Left Row Headers (A, B, C, D, E, F)
  for (let r = 0; r < rows; r++) {
    const rowHeader = document.createElement('div');
    rowHeader.className = 'grid-row-header';
    rowHeader.style.left = `-32px`;
    rowHeader.style.top = `${r * cellHeight + cellHeight / 2}px`;
    rowHeader.textContent = rowNames[r] || (r + 1);
    gridOverlay.appendChild(rowHeader);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement('div');
      cell.className = `grid-cell ${(r + c) % 2 === 0 ? 'cell-even' : 'cell-odd'}`;
      cell.style.left = `${c * cellWidth}px`;
      cell.style.top = `${r * cellHeight}px`;
      cell.style.width = `${cellWidth}px`;
      cell.style.height = `${cellHeight}px`;

      const label = document.createElement('span');
      label.className = 'grid-cell-label';
      label.textContent = `${rowNames[r] || (r + 1)}${c + 1}`;
      cell.appendChild(label);

      gridOverlay.appendChild(cell);
    }
  }
  boardContent.appendChild(gridOverlay);

  const placedRects = [];
  const padding = 15;

  for (let num = 1; num <= maxNumber; num++) {
    // Determine larger random size for each number bubble (60px to 86px)
    const size = Math.floor(Math.random() * 26) + 60;
    let x = 0, y = 0, attempts = 0;
    let overlaps = true;

    // Try finding non-overlapping position
    while (overlaps && attempts < 200) {
      x = Math.floor(Math.random() * (boardWidth - size - padding * 2)) + padding;
      y = Math.floor(Math.random() * (boardHeight - size - padding * 2)) + padding;

      overlaps = placedRects.some(r => {
        const dx = (x + size / 2) - (r.x + r.size / 2);
        const dy = (y + size / 2) - (r.y + r.size / 2);
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist < (size / 2 + r.size / 2 + 10);
      });
      attempts++;
    }

    placedRects.push({ x, y, size });

    // Pick random color palette & slight rotation
    const colorStyle = NEON_COLORS[(num + attempts) % NEON_COLORS.length];
    const rotation = (Math.random() * 30 - 15).toFixed(1);

    const card = document.createElement('div');
    card.className = 'num-card';
    card.dataset.number = num;
    card.id = `num-card-${num}`;
    card.style.left = `${x}px`;
    card.style.top = `${y}px`;
    card.style.width = `${size}px`;
    card.style.height = `${size}px`;
    card.style.fontSize = `${Math.floor(size * 0.46)}px`;
    card.style.background = colorStyle.bg;
    card.style.color = colorStyle.text;
    card.style.transform = `rotate(${rotation}deg)`;
    card.textContent = num;

    card.addEventListener('pointerdown', (e) => {
      // Prevent drag initiation when tapping number
      e.stopPropagation();
      handleNumberTap(num, card);
    });

    boardContent.appendChild(card);
  }
}

// ── Number Tap Handling ──
function handleNumberTap(num, cardEl) {
  if (!isGameActive) return;
  sound.init();

  if (num === currentTargetNum) {
    // CORRECT NUMBER!
    sound.playPop();
    cardEl.classList.add('correct-pop', 'found');

    if (currentTargetNum === maxNumber) {
      // WIN LEVEL!
      sound.playWin();
      onLevelCompleted();
    } else {
      currentTargetNum++;
      updateTargetNumberDisplay();
    }
  } else {
    // WRONG NUMBER!
    sound.playWrong();
    cardEl.classList.remove('wrong-shake');
    void cardEl.offsetWidth; // trigger reflow
    cardEl.classList.add('wrong-shake');
    showToast(`Hãy tìm số ${currentTargetNum}!`);
  }
}

// ── Hint Feature (Unlimited) ──
function triggerHint() {
  const targetEl = document.getElementById(`num-card-${currentTargetNum}`);
  if (!targetEl) return;

  sound.playHint();

  // Scroll / Pan viewport to center target number
  const numX = parseFloat(targetEl.style.left) + targetEl.offsetWidth / 2;
  const numY = parseFloat(targetEl.style.top) + targetEl.offsetHeight / 2;
  const vpWidth = boardViewport.clientWidth || window.innerWidth;
  const vpHeight = boardViewport.clientHeight || (window.innerHeight - 70);

  // Smooth animate pan position
  panX = vpWidth / 2 - numX * scale;
  panY = vpHeight / 2 - numY * scale;
  applyTransform();

  // Show Toast with grid coordinate (e.g., [C3])
  const cols = 8;
  const rows = 6;
  const rowNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
  const cellWidth = boardWidth / cols;
  const cellHeight = boardHeight / rows;
  const cIdx = Math.min(cols - 1, Math.max(0, Math.floor(parseFloat(targetEl.style.left) / cellWidth)));
  const rIdx = Math.min(rows - 1, Math.max(0, Math.floor(parseFloat(targetEl.style.top) / cellHeight)));
  const coord = `${rowNames[rIdx] || (rIdx + 1)}${cIdx + 1}`;

  showToast(`Gợi ý: Số ${currentTargetNum} ở ô [${coord}]!`);

  // Add rapid blinking neon glow & scaling effect
  targetEl.classList.remove('hint-glow');
  void targetEl.offsetWidth; // trigger reflow
  targetEl.classList.add('hint-glow');
  setTimeout(() => {
    targetEl.classList.remove('hint-glow');
  }, 3500);
}

// ── Level Completion ──
async function onLevelCompleted() {
  isGameActive = false;
  stopTimer();

  const timeStr = timerDisplayEl.textContent;
  const winTimeEl = document.getElementById('win-time');
  if (winTimeEl) winTimeEl.textContent = `Hoàn thành Màn ${currentLevel} trong ${timeStr}!`;

  const statTime = document.getElementById('win-stat-time');
  const statLevel = document.getElementById('win-stat-level');
  if (statTime) statTime.textContent = timeStr;
  if (statLevel) statLevel.textContent = `Màn ${currentLevel}`;

  // Render stars
  const winStarsEl = document.getElementById('win-stars');
  if (winStarsEl) {
    winStarsEl.innerHTML = `
      <i class="fa-solid fa-star star-active"></i>
      <i class="fa-solid fa-star star-active"></i>
      <i class="fa-solid fa-star star-active"></i>
    `;
  }

  winOverlay.setAttribute('aria-hidden', 'false');

  // Save score to Firebase
  if (window.saveScoreToFirebase) {
    const playerName = localStorage.getItem('captain_player_name') || 'Gamer';
    window.saveScoreToFirebase(playerName, currentLevel, 0, 'tim-so');
  }
}

// ── Pan and Zoom Handling ──
function setupPanAndZoom() {
  // Mouse drag & Touch pan
  boardViewport.addEventListener('pointerdown', (e) => {
    isDragging = true;
    startX = e.clientX - panX;
    startY = e.clientY - panY;
    boardViewport.setPointerCapture(e.pointerId);
  });

  boardViewport.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    panX = e.clientX - startX;
    panY = e.clientY - startY;
    applyTransform();
  });

  const stopDrag = (e) => {
    if (isDragging) {
      isDragging = false;
      try { boardViewport.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  };

  boardViewport.addEventListener('pointerup', stopDrag);
  boardViewport.addEventListener('pointercancel', stopDrag);

  // Wheel zoom centered on cursor
  boardViewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    zoomAtPoint(e.clientX, e.clientY, zoomFactor);
  }, { passive: false });

  // Zoom toolbar buttons
  btnZoomIn.addEventListener('click', () => {
    const vpWidth = boardViewport.clientWidth / 2;
    const vpHeight = boardViewport.clientHeight / 2;
    zoomAtPoint(vpWidth, vpHeight, 1.25);
  });

  btnZoomOut.addEventListener('click', () => {
    const vpWidth = boardViewport.clientWidth / 2;
    const vpHeight = boardViewport.clientHeight / 2;
    zoomAtPoint(vpWidth, vpHeight, 0.8);
  });

  btnZoomReset.addEventListener('click', () => {
    resetViewportTransform();
  });
}

function zoomAtPoint(clientX, clientY, factor) {
  const newScale = Math.min(3.0, Math.max(0.4, scale * factor));
  const rect = boardViewport.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  panX = mouseX - (mouseX - panX) * (newScale / scale);
  panY = mouseY - (mouseY - panY) * (newScale / scale);
  scale = newScale;

  applyTransform();
}

// ── Timer & Pause Logic ──
function startTimer() {
  stopTimer();
  timerSeconds = 0;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function resumeTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    timerSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function pauseGame() {
  if (!isGameActive) return;
  isGameActive = false;
  stopTimer();
  if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'false');
}

function resumeGame() {
  if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'true');
  isGameActive = true;
  resumeTimer();
}

function updateTimerDisplay() {
  const mins = Math.floor(timerSeconds / 60);
  const secs = timerSeconds % 60;
  timerDisplayEl.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ── Toast System ──
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2200);
}

// ── Sound Settings UI ──
function updateSoundUI() {
  soundSlider.value = Math.round(sound.volume * 100);
  soundVolumeVal.textContent = `${soundSlider.value}%`;
  soundIcon.className = sound.muted ? 'fa-solid fa-volume-xmark' : (sound.volume > 0 ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark');
}

// ── Event Listeners ──
function setupEventListeners() {
  // Sound controls
  btnSound.addEventListener('click', (e) => {
    e.stopPropagation();
    soundPopover.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!soundPopover.contains(e.target) && e.target !== btnSound) {
      soundPopover.classList.remove('active');
    }
  });

  soundSlider.addEventListener('input', (e) => {
    sound.volume = parseFloat(e.target.value) / 100;
    sound.muted = sound.volume === 0;
    localStorage.setItem('tim_so_volume', sound.volume.toString());
    localStorage.setItem('tim_so_muted', sound.muted.toString());
    updateSoundUI();
  });

  btnMuteToggle.addEventListener('click', () => {
    sound.muted = !sound.muted;
    localStorage.setItem('tim_so_muted', sound.muted.toString());
    updateSoundUI();
  });

  // Navigation & Pause
  if (btnPause) btnPause.addEventListener('click', pauseGame);
  if (btnResume) btnResume.addEventListener('click', resumeGame);
  if (btnPauseRestart) btnPauseRestart.addEventListener('click', () => {
    if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'true');
    startLevel(currentLevel);
  });
  if (btnPauseHome) btnPauseHome.addEventListener('click', () => {
    if (pauseOverlay) pauseOverlay.setAttribute('aria-hidden', 'true');
    stopTimer();
    updateMenuState();
    menuOverlay.setAttribute('aria-hidden', 'false');
  });

  btnHome.addEventListener('click', () => {
    stopTimer();
    updateMenuState();
    menuOverlay.setAttribute('aria-hidden', 'false');
  });

  btnMenuStart.addEventListener('click', () => {
    startLevel(currentLevel);
  });

  btnNext.addEventListener('click', () => {
    startLevel(currentLevel + 1);
  });

  const btnWinReplay = document.getElementById('btn-win-replay');
  if (btnWinReplay) {
    btnWinReplay.addEventListener('click', () => {
      winOverlay.setAttribute('aria-hidden', 'true');
      startLevel(currentLevel);
    });
  }

  hintBtn.addEventListener('click', triggerHint);

  // Leaderboard
  btnMenuLeaderboard.addEventListener('click', loadLeaderboard);
  btnLeaderboardBack.addEventListener('click', () => {
    leaderboardOverlay.setAttribute('aria-hidden', 'true');
  });

  // Google Auth
  btnMenuAuth.addEventListener('click', async () => {
    if (currentAuthUser) {
      // Đã đăng nhập -> Hiển thị hộp thoại xác nhận đăng xuất
      const confirmOverlay = document.getElementById('confirm-overlay');
      if (confirmOverlay) {
        confirmOverlay.classList.add('show');
        confirmOverlay.removeAttribute('aria-hidden');
      }
    } else {
      // Chưa đăng nhập -> Thực hiện đăng nhập Google
      if (window.loginWithGoogle) {
        showToast('Đang mở trang đăng nhập Google...');
        const res = await window.loginWithGoogle();
        if (res.success) {
          showToast(`Xin chào ${res.user.displayName}!`);
          updateAuthBtnState(res.user);
          syncCloudProgress(res.user);
        }
      }
    }
  });

  // Confirm dialog: Hủy đăng xuất
  const confirmOverlay = document.getElementById('confirm-overlay');
  const btnConfirmCancel = document.getElementById('btn-confirm-cancel');
  const btnConfirmOk = document.getElementById('btn-confirm-ok');

  if (btnConfirmCancel) {
    btnConfirmCancel.addEventListener('click', () => {
      if (confirmOverlay) {
        confirmOverlay.classList.remove('show');
        confirmOverlay.setAttribute('aria-hidden', 'true');
      }
    });
  }

  // Confirm dialog: Đồng ý đăng xuất
  if (btnConfirmOk) {
    btnConfirmOk.addEventListener('click', async () => {
      if (confirmOverlay) {
        confirmOverlay.classList.remove('show');
        confirmOverlay.setAttribute('aria-hidden', 'true');
      }
      if (window.logoutGoogle) {
        await window.logoutGoogle();
        updateAuthBtnState(null);
        currentLevel = 1;
        localStorage.setItem('tim_so_level', '1');
        updateMenuState();
        showToast('Đã đăng xuất tài khoản!');
      }
    });
  }

  window.onUserAuthChanged = (user) => {
    updateAuthBtnState(user);
    if (user) {
      syncCloudProgress(user);
    }
  };
}

let currentAuthUser = null;

async function syncCloudProgress(user) {
  if (!user || !window.getUserScoreFromFirebase) return;

  try {
    const cloudData = await window.getUserScoreFromFirebase('tim-so');
    const cloudPassedLevel = cloudData ? (Number(cloudData.level) || 0) : 0;
    const cloudNextLevel = cloudPassedLevel > 0 ? cloudPassedLevel + 1 : 1;
    const localLevel = parseInt(localStorage.getItem('tim_so_level') || '1');

    if (cloudNextLevel > localLevel) {
      currentLevel = cloudNextLevel;
      localStorage.setItem('tim_so_level', currentLevel);
      updateMenuState();
      showToast(`Đã tải tiến trình Màn ${currentLevel} từ tài khoản Google!`);
    } else if (localLevel > 1) {
      const levelToSave = Math.max(1, localLevel - 1);
      if (window.saveScoreToFirebase) {
        await window.saveScoreToFirebase(user.displayName || 'Gamer', levelToSave, 0, 'tim-so');
      }
    }
  } catch (err) {
    console.error('Lỗi đồng bộ tiến trình đám mây:', err);
  }
}

function updateAuthBtnState(user) {
  currentAuthUser = user;
  const title = document.getElementById('auth-btn-title');
  const sub = document.getElementById('auth-btn-sub');
  const icon = document.getElementById('auth-btn-icon');

  if (user) {
    if (title) title.textContent = user.displayName || 'Gamer';
    if (sub) sub.textContent = 'Đã đăng nhập Google (Bấm để đăng xuất)';
    if (icon) {
      if (user.photoURL) {
        icon.innerHTML = `<img src="${user.photoURL}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;">`;
      } else {
        icon.innerHTML = `<i class="fa-solid fa-user-check"></i>`;
      }
    }
  } else {
    if (title) title.textContent = 'Đăng nhập Google';
    if (sub) sub.textContent = 'Đồng bộ tên & avatar';
    if (icon) icon.innerHTML = `<i class="fa-brands fa-google"></i>`;
  }
}

async function loadLeaderboard() {
  leaderboardOverlay.setAttribute('aria-hidden', 'false');
  const listEl = document.getElementById('leaderboard-list');
  listEl.innerHTML = '<li class="lb-loading">Đang tải bảng xếp hạng...</li>';

  if (window.getTopScoresFromFirebase) {
    const scores = await window.getTopScoresFromFirebase('tim-so');
    if (!scores || scores.length === 0) {
      listEl.innerHTML = '<li class="lb-loading">Chưa có ai trong bảng xếp hạng. Hãy là người đầu tiên!</li>';
      return;
    }

    listEl.innerHTML = scores.map((s, idx) => {
      const rank = idx + 1;
      const avatar = s.avatar ? `<img src="${s.avatar}" class="lb-avatar">` : `<i class="fa-solid fa-user-circle" style="font-size: 1.8rem; color: var(--text-sub);"></i>`;
      return `
        <li class="lb-item">
          <span class="lb-rank lb-rank-${rank}">${rank}</span>
          <div class="lb-user-info">
            ${avatar}
            <span class="lb-name">${s.name || 'Gamer'}</span>
          </div>
          <span class="lb-score">Màn ${s.level}</span>
        </li>
      `;
    }).join('');
  }
}

// ── DOM Content Loaded ──
document.addEventListener('DOMContentLoaded', init);
