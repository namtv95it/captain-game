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
  totalLevels: 100,   // Mặc định 100 màn thử thách
  isPaused: false, // Trạng thái tạm dừng nhận thử thách
  tickerText: 'Hãy Follow và Tặng quà để cộng thêm màn thử thách cho Streamer nhé!',
  tickerSpeed: 'normal', // fast, normal, slow
  tickerVisible: true,
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
function broadcastStateToGame(eventDetail = null) {
  saveStateToStorage();
  broadcastChannel.postMessage({
    type: 'STATE_UPDATE',
    payload: liveState,
    eventDetail: eventDetail
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
  broadcastStateToGame({ type: 'MANUAL', username: 'Streamer', addedLevels: count });
}

// 5.4. Đặt lại thử thách phiên live
function resetChallenge() {
  if (confirm('Bạn có chắc muốn ĐẶT LẠI TOÀN BỘ PHÊN LIVE này?\n\u2022 Xóa toàn bộ dữ liệu phiên live trong localStorage\n\u2022 Đặt về Màn 1 / Mặc định 100 màn\n\u2022 Xóa danh sách Follower đã lưu')) {
    // Xóa toàn bộ dữ liệu phiên live trong localStorage
    localStorage.removeItem(STORAGE_KEY_STATE);

    // Reset lại liveState về mặc định
    liveState.currentLevel = 1;
    liveState.totalLevels = 100;
    liveState.isPaused = false;
    liveState.followedUsers = [];
    liveState.logs = [];
    addLog('\u0110ã ĐẶT LẠI phiên live: Xóa dữ liệu localStorage + về Màn 1 / 100 Màn', 'warn');
    renderAll();
    broadcastStateToGame();
  }
}

// Xóa riêng danh sách Follower chống spam của phiên live này
function clearFollowersList() {
  if (confirm('Bạn có chắc muốn xóa danh sách người dùng đã Follow của phiên live này? (Cho phép họ follow lại để cộng màn)')) {
    liveState.followedUsers = [];
    addLog('Đã xóa danh sách Follower của phiên live này', 'info');
    renderAll();
    saveStateToStorage();
  }
}

// 5.5. Xử lý sự kiện Follow (CHỐNG UNFOLLOW SPAM + PHÁT TỪNG THÔNG BÁO RIÊNG BỆNH)
function handleUserFollow(inputString) {
  if (!inputString || !inputString.trim()) return;

  // Tách danh sách người xem theo dấu phẩy ","
  const userList = inputString.split(',').map(u => u.trim()).filter(Boolean);
  if (userList.length === 0) return;

  let delay = 0;

  userList.forEach(user => {
    const cleanUser = user.toLowerCase();

    if (liveState.isPaused) {
      addLog(`Bỏ qua Follow từ @${user} (Do đang tạm dừng nhận)`, 'warn');
      return;
    }

    // KIỂM TRA UNFOLLOW / RE-FOLLOW: Nếu đã follow rồi thì KHÔNG CỘNG MÀN
    if (liveState.followedUsers.includes(cleanUser)) {
      addLog(`Bỏ qua @${user} (Tài khoản này đã follow trước đó!)`, 'warn');
      return;
    }

    // Đánh dấu người dùng đã follow & cộng +1 màn
    liveState.followedUsers.push(cleanUser);
    liveState.totalLevels += 1;
    addLog(`@${user} đã Follow -> +1 Màn thử thách!`, 'follow');

    renderAll();

    // Phát lần lượt từng thông báo riêng cho từng người kèm khoảng trễ nhẹ (ví dụ 600ms)
    setTimeout(() => {
      broadcastStateToGame({ type: 'FOLLOW', username: user, addedLevels: 1 });
    }, delay);

    delay += 600;
  });
}

// 5.6. Xử lý sự kiện Tặng Quà (Gift)
function handleUserGift(inputString, giftName, coinValue) {
  if (!inputString || !inputString.trim() || !coinValue || coinValue <= 0) return;

  // Tách danh sách người tặng quà theo dấu phẩy ","
  const userList = inputString.split(',').map(u => u.trim()).filter(Boolean);
  if (userList.length === 0) return;

  let delay = 0;

  userList.forEach(user => {
    if (liveState.isPaused) {
      addLog(`Bỏ qua Quà (${giftName}) từ @${user} (Do đang tạm dừng)`, 'warn');
      return;
    }

    const addedLevels = coinValue; // 1 xu = 1 màn
    liveState.totalLevels += addedLevels;
    addLog(`@${user} tặng ${giftName} (${coinValue} xu) -> +${addedLevels} Màn!`, 'gift');

    renderAll();

    // Bắn lần lượt từng thông báo tặng quà riêng biệt cho từng người
    setTimeout(() => {
      broadcastStateToGame({ type: 'GIFT', username: user, giftName: giftName, addedLevels: addedLevels });
    }, delay);

    delay += 600;
  });
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

  // Render thẻ trạng thái kết nối TikTok ID
  const connectBadge = document.getElementById('connect-badge');
  if (connectBadge) {
    if (liveState.tiktokId) {
      connectBadge.className = 'status-badge connected';
      connectBadge.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đã kết nối với TikTok Live ID: <strong>@${liveState.tiktokId}</strong>`;
    } else {
      connectBadge.className = 'status-badge disconnected';
      connectBadge.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> Chưa nhập TikTok Unique ID`;
    }
  }

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

  // Render Ticker Controls
  const inputTickerText = document.getElementById('ticker-text-input');
  if (inputTickerText && !inputTickerText.matches(':focus')) {
    inputTickerText.value = liveState.tickerText || '';
  }
  const selectTickerSpeed = document.getElementById('ticker-speed-select');
  if (selectTickerSpeed) {
    selectTickerSpeed.value = liveState.tickerSpeed || 'normal';
  }
  const btnToggleTicker = document.getElementById('btn-toggle-ticker');
  if (btnToggleTicker) {
    if (liveState.tickerVisible) {
      btnToggleTicker.classList.add('is-active');
      btnToggleTicker.innerHTML = `<i class="fa-solid fa-eye"></i> <span>Đang HIỂN THỊ Banner</span>`;
    } else {
      btnToggleTicker.classList.remove('is-active');
      btnToggleTicker.innerHTML = `<i class="fa-solid fa-eye-slash"></i> <span>Đang ẨN Banner</span>`;
    }
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
    <span class="history-tag" onclick="selectHistoryId('${id}')">
      <span>@${id}</span>
      <i class="fa-solid fa-xmark btn-remove-history" onclick="removeHistoryId(event, '${id}')" title="Xóa ID này"></i>
    </span>
  `).join('');
}

window.selectHistoryId = function(id) {
  document.getElementById('tiktok-id-input').value = id;
  connectTikTokId(id);
};

window.removeHistoryId = function(event, idToRemove) {
  event.stopPropagation(); // Tránh kích hoạt chọn ID khi nhấn nút xóa
  idHistory = idHistory.filter(id => id !== idToRemove);
  localStorage.setItem(STORAGE_KEY_ID_HISTORY, JSON.stringify(idHistory));
  renderHistoryTags();
};

window.clearAllHistoryId = function() {
  idHistory = [];
  localStorage.setItem(STORAGE_KEY_ID_HISTORY, JSON.stringify(idHistory));
  renderHistoryTags();
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

  // Reset phiên live
  document.getElementById('btn-reset-challenge').addEventListener('click', resetChallenge);

  // Xóa danh sách Follower của phiên live
  const btnClearFollowers = document.getElementById('btn-clear-followers');
  if (btnClearFollowers) {
    btnClearFollowers.addEventListener('click', clearFollowersList);
  }

  // Ticker Controls
  document.getElementById('btn-update-ticker').addEventListener('click', () => {
    const text = document.getElementById('ticker-text-input').value;
    const speed = document.getElementById('ticker-speed-select').value;
    liveState.tickerText = text;
    liveState.tickerSpeed = speed;
    addLog('Cập nhật nội dung Chữ Chạy thông báo lên Game', 'info');
    renderAll();
    broadcastStateToGame();
  });

  document.getElementById('btn-toggle-ticker').addEventListener('click', () => {
    liveState.tickerVisible = !liveState.tickerVisible;
    const msg = liveState.tickerVisible ? 'Đã BẬT Banner chữ chạy' : 'Đã ẨN Banner chữ chạy';
    addLog(msg, 'info');
    renderAll();
    broadcastStateToGame();
  });

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
    if (!event.data) return;

    if (event.data.type === 'GAME_LEVEL_UPDATE') {
      liveState.currentLevel = event.data.payload.currentLevel;
      renderAll();
      saveStateToStorage();
    } else if (event.data.type === 'RESET_ALL') {
      // Xóa dữ liệu phiên live trong localStorage trước
      localStorage.removeItem(STORAGE_KEY_STATE);
      liveState = {
        tiktokId: '',
        currentLevel: 1,
        totalLevels: 100,   // Mặc định 100 màn
        isPaused: false,
        tickerText: 'Hãy Follow và Tặng quà để cộng thêm màn thử thách cho Streamer nhé!',
        tickerSpeed: 'normal',
        tickerVisible: true,
        followedUsers: [],
        logs: []
      };
      idHistory = [];
      addLog('Đã làm mới toàn bộ Bảng điều khiển từ Game', 'warn');
      renderAll();
      saveStateToStorage();
    }
  };
}
