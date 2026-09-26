/**
 * control.js - Logic dành cho Bảng Điều Khiển Streamer
 * Quản lý trạng thái Live, lưu localStorage, lọc spam Follow và đồng bộ BroadcastChannel với Màn hình Game.
 */

// 1. CẤU HÌNH & TRẠNG THÁI (STATE)
const CHANNEL_NAME = 'tiktok_xep_bong_channel';
const STORAGE_KEY_STATE = 'tiktok_xep_bong_live_state';
const STORAGE_KEY_ID_HISTORY = 'tiktok_xep_bong_id_history';

// BroadcastChannel kết nối 2 tab
const broadcastChannel = new BroadcastChannel(CHANNEL_NAME);

let liveState = {
  tiktokId: '',
  currentLevel: 1,
  totalLevels: 50,
  isPaused: false, // Trạng thái tạm dừng nhận thử thách
  followedUsers: [], // Set/Array danh sách username đã follow (Chống spam unfollow/follow lại)
  logs: []
};

let idHistory = [];

// 2. KHỞI TẠO RENDER TRANG
document.addEventListener('DOMContentLoaded', () => {
  loadStateFromStorage();
  initEventListeners();
  renderAll();
  broadcastStateToGame();
});

// 3. NẠP VÀ LƯU DỮ LIỆU LOCALSTORAGE
function loadStateFromStorage() {
  const savedState = localStorage.getItem(STORAGE_KEY_STATE);
  if (savedState) {
    try {
      const parsed = JSON.parse(savedState);
      liveState = { ...liveState, ...parsed };
      // Đảm bảo followedUsers luôn là mảng
      if (!Array.isArray(liveState.followedUsers)) {
        liveState.followedUsers = [];
      }
    } catch (e) {
      console.error("Lỗi parse liveState storage:", e);
    }
  }

  const savedHistory = localStorage.getItem(STORAGE_KEY_ID_HISTORY);
  if (savedHistory) {
    try {
      idHistory = JSON.parse(savedHistory);
    } catch (e) {
      idHistory = [];
    }
  }
}

function saveStateToStorage() {
  localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(liveState));
  localStorage.setItem(STORAGE_KEY_ID_HISTORY, JSON.stringify(idHistory));
}

// 4. ĐỒNG BỘ BROADCAST CHANNEL SANG MÀN HÌNH GAME
function broadcastStateToGame() {
  saveStateToStorage();
  broadcastChannel.postMessage({
    type: 'STATE_UPDATE',
    payload: liveState
  });
}

// 5. CÁC THAO TÁC XỬ LÝ LOGIC

// 5.1. Kết nối TikTok ID
function connectTikTokId(rawId) {
  const cleanId = rawId.trim().replace(/^@/, '');
  if (!cleanId) return;

  liveState.tiktokId = cleanId;

  // Lưu lịch sử ID
  if (!idHistory.includes(cleanId)) {
    idHistory.unshift(cleanId);
    if (idHistory.length > 5) idHistory.pop();
  }

  addLog(`Kết nối TikTok Live ID: @${cleanId}`, 'info');
  renderAll();
  broadcastStateToGame();
}

// 5.2. Toggle Tạm dừng / Tiếp tục nhận thử thách
function togglePauseChallenge() {
  liveState.isPaused = !liveState.isPaused;
  const statusMsg = liveState.isPaused 
    ? 'Đã TẠM DỪNG nhận thử thách từ TikTok' 
    : 'Đã TIẾP TỤC nhận thử thách từ TikTok';
  
  addLog(statusMsg, 'warn');
  renderAll();
  broadcastStateToGame();
}

// 5.3. Cộng số màn thủ công
function addLevelsManual(count) {
  liveState.totalLevels += count;
  addLog(`Cộng thủ công +${count} màn thử thách`, 'info');
  renderAll();
  broadcastStateToGame();
}

// 5.4. Đặt lại thử thách
function resetChallenge() {
  if (confirm('Bạn có chắc muốn đặt lại Thử thách về Màn 1 / Mặc định 50 màn?')) {
    liveState.currentLevel = 1;
    liveState.totalLevels = 50;
    liveState.isPaused = false;
    liveState.followedUsers = [];
    addLog('Đặt lại Thử thách về Màn 1 / 50 Màn', 'warn');
    renderAll();
    broadcastStateToGame();
  }
}

// 5.5. Xử lý sự kiện Follow (CHỐNG UNFOLLOW SPAM)
function handleUserFollow(username) {
  const user = username.trim().toLowerCase();
  if (!user) return;

  if (liveState.isPaused) {
    addLog(`Bỏ qua Follow từ @${user} (Do đang tạm dừng nhận)`, 'warn');
    return;
  }

  // KIỂM TRA UNFOLLOW / RE-FOLLOW: Nếu đã follow rồi thì KHÔNG CỘNG MÀN
  if (liveState.followedUsers.includes(user)) {
    addLog(`Bỏ qua @${user} (Tài khoản này đã follow trước đó!)`, 'warn');
    renderLogList();
    return;
  }

  // Đánh dấu người dùng đã follow & cộng +1 màn
  liveState.followedUsers.push(user);
  liveState.totalLevels += 1;
  addLog(`@${user} đã Follow -> +1 Màn thử thách!`, 'follow');

  renderAll();
  broadcastStateToGame();
}

// 5.6. Xử lý sự kiện Tặng Quà (Gift)
function handleUserGift(username, giftName, coinValue) {
  const user = username.trim() || 'Người xem';
  if (!coinValue || coinValue <= 0) return;

  if (liveState.isPaused) {
    addLog(`Bỏ qua Quà (${giftName}) từ @${user} (Do đang tạm dừng)`, 'warn');
    return;
  }

  const addedLevels = coinValue; // 1 xu = 1 màn (hoặc tùy biến)
  liveState.totalLevels += addedLevels;
  addLog(`@${user} tặng ${giftName} (${coinValue} xu) -> +${addedLevels} Màn!`, 'gift');

  renderAll();
  broadcastStateToGame();
}

// 5.7. Thêm Nhật ký Event
function addLog(message, type = 'info') {
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  liveState.logs.unshift({ time, message, type });
  if (liveState.logs.length > 30) liveState.logs.pop();
  renderLogList();
}

// 6. GIAO DIỆN (RENDER)
function renderAll() {
  // TikTok ID & History
  document.getElementById('tiktok-id-input').value = liveState.tiktokId;
  renderHistoryTags();

  // Stats HUD
  document.getElementById('stat-current-level').textContent = liveState.currentLevel;
  document.getElementById('stat-total-levels').textContent = liveState.totalLevels;
  
  const remaining = Math.max(0, liveState.totalLevels - liveState.currentLevel + 1);
  document.getElementById('stat-remaining-levels').textContent = remaining;

  // Toggle Pause Button
  const btnPause = document.getElementById('btn-toggle-pause');
  const txtPause = document.getElementById('pause-status-text');
  const descPause = document.getElementById('pause-status-desc');
  const btnPauseTxt = document.getElementById('pause-btn-text');
  const iconPause = document.getElementById('pause-icon');

  if (liveState.isPaused) {
    btnPause.classList.add('is-paused');
    txtPause.textContent = 'ĐÃ TẠM DỪNG nhận thử thách';
    txtPause.style.color = 'var(--warning)';
    descPause.textContent = 'Đang hoàn thành nốt các màn hiện tại để xuống live';
    btnPauseTxt.textContent = '▶ Tiếp tục nhận thử thách';
    iconPause.className = 'fa-solid fa-play';
  } else {
    btnPause.classList.remove('is-paused');
    txtPause.textContent = 'Đang nhận thử thách từ TikTok';
    txtPause.style.color = 'var(--success)';
    descPause.textContent = 'Người xem follow/tặng quà sẽ tự động cộng màn';
    btnPauseTxt.textContent = 'Tạm dừng nhận thử thách';
    iconPause.className = 'fa-solid fa-pause';
  }

  renderLogList();
}

function renderHistoryTags() {
  const container = document.getElementById('history-tags');
  if (idHistory.length === 0) {
    container.innerHTML = `<span class="history-empty">Chưa có lịch sử</span>`;
    return;
  }

  container.innerHTML = idHistory.map(id => `
    <span class="history-tag" onclick="selectHistoryId('${id}')">@${id}</span>
  `).join('');
}

window.selectHistoryId = function(id) {
  document.getElementById('tiktok-id-input').value = id;
  connectTikTokId(id);
};

function renderLogList() {
  const container = document.getElementById('log-list');
  if (liveState.logs.length === 0) {
    container.innerHTML = `<div class="log-empty">Chưa có sự kiện nào...</div>`;
    return;
  }

  container.innerHTML = liveState.logs.map(log => `
    <div class="log-item ${log.type}">
      <span>${log.message}</span>
      <small style="color: var(--text-muted);">${log.time}</small>
    </div>
  `).join('');
}

// 7. SỰ KIỆN NÚT VÀ FORM (EVENT LISTENERS)
function initEventListeners() {
  // Connect TikTok ID
  document.getElementById('btn-connect-tiktok').addEventListener('click', () => {
    const val = document.getElementById('tiktok-id-input').value;
    connectTikTokId(val);
  });

  // Toggle Pause
  document.getElementById('btn-toggle-pause').addEventListener('click', togglePauseChallenge);

  // Manual Add Levels
  document.querySelectorAll('[data-add]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const add = parseInt(e.target.dataset.add, 10);
      addLevelsManual(add);
    });
  });

  // Reset
  document.getElementById('btn-reset-challenge').addEventListener('click', resetChallenge);

  // Simulation: Test Follow
  document.getElementById('btn-sim-follow').addEventListener('click', () => {
    const username = document.getElementById('sim-username').value;
    handleUserFollow(username);
  });

  // Simulation: Test Gift
  document.querySelectorAll('[data-gift]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const username = document.getElementById('sim-username').value;
      const gift = e.currentTarget.dataset.gift;
      const coins = parseInt(e.currentTarget.dataset.coins, 10);
      handleUserGift(username, gift, coins);
    });
  });

  // Clear Log
  document.getElementById('btn-clear-log').addEventListener('click', () => {
    liveState.logs = [];
    renderLogList();
    saveStateToStorage();
  });

  // Lắng nghe xem nếu màn hình Game gửi cập nhật Level hiện tại về Control Panel
  broadcastChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'GAME_LEVEL_UPDATE') {
      liveState.currentLevel = event.data.payload.currentLevel;
      renderAll();
      saveStateToStorage();
    }
  };
}
