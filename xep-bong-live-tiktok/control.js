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
  connectionState: 'disconnected', // 'disconnected' | 'connecting' | 'connected' | 'failed'
  connectionError: '',
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
      if (!Array.isArray(liveState.followedUsers)) {
        liveState.followedUsers = [];
      }
      // Khôi phục trạng thái kết nối dựa trên tiktokId có sẵn
      if (liveState.tiktokId) {
        liveState.connectionState = 'connected';
      } else {
        liveState.connectionState = 'disconnected';
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

// ── Node.js Bridge Server SSE ──────────────────────────────────────────────
const BRIDGE_SERVER = 'http://localhost:3456';
let sseSource = null;

/**
 * Kiểm tra server Node.js có đang chạy không
 */
async function checkServerRunning() {
  try {
    const res = await fetch(`${BRIDGE_SERVER}/status`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Bắt đầu lắng nghe SSE từ Node.js bridge server
 */
function startSSEListener() {
  if (sseSource) { sseSource.close(); sseSource = null; }

  sseSource = new EventSource(`${BRIDGE_SERVER}/events`);

  // ── Trạng thái kết nối ──────────────────────────────────────────────────
  sseSource.addEventListener('status', (e) => {
    const data = JSON.parse(e.data);
    if (data.state === 'connected') {
      liveState.connectionState = 'connected';
      liveState.connectionError = '';
      const u = data.username || liveState.tiktokId;
      if (!idHistory.includes(u)) {
        idHistory.unshift(u); if (idHistory.length > 5) idHistory.pop();
        localStorage.setItem(STORAGE_KEY_ID_HISTORY, JSON.stringify(idHistory));
      }
      addLog(`✅ Đã kết nối thành công tới Live của @${u}${data.roomId ? ' (Room: ' + data.roomId + ')' : ''}`, 'info');
    } else if (data.state === 'connecting') {
      liveState.connectionState = 'connecting';
      addLog(`🔄 Đang kết nối tới @${data.username}...`, 'info');
    } else if (data.state === 'failed') {
      liveState.connectionState = 'failed';
      liveState.connectionError = data.error || 'Kết nối thất bại';
      addLog(`❌ Kết nối thất bại: ${data.error || 'Không rõ lỗi'}`, 'error');
    } else if (data.state === 'disconnected') {
      liveState.connectionState = 'disconnected';
      addLog(`⚫ Đã ngắt kết nối TikTok Live`, 'warn');
    }
    renderAll();
    broadcastStateToGame();
  });

  // ── Follow ───────────────────────────────────────────────────────────────
  sseSource.addEventListener('follow', (e) => {
    const data = JSON.parse(e.data);
    handleUserFollow(data.uniqueId);
  });

  // ── Gift ─────────────────────────────────────────────────────────────────
  sseSource.addEventListener('gift', (e) => {
    const data = JSON.parse(e.data);
    handleUserGift(data.uniqueId, data.giftName, data.totalCoins || data.diamondCount || 1);
  });

  // ── Share ────────────────────────────────────────────────────────────────
  sseSource.addEventListener('share', (e) => {
    const data = JSON.parse(e.data);
    handleUserShare(data.uniqueId);
  });

  // ── Comment ──────────────────────────────────────────────────────────────
  sseSource.addEventListener('comment', (e) => {
    const data = JSON.parse(e.data);
    handleUserComment(data.uniqueId, data.comment);
  });

  // ── Like ─────────────────────────────────────────────────────────────────
  sseSource.addEventListener('like', (e) => {
    const data = JSON.parse(e.data);
    handleUserLike(data.uniqueId, data.likeCount);
  });

  sseSource.onerror = () => {
    // SSE tự reconnect, không cần xử lý thêm
  };
}

// 5.1. Kết nối TikTok ID - gọi qua Node.js bridge server
async function connectTikTokId(rawId) {
  const inputEl = document.getElementById('tiktok-id-input');
  const targetId = (rawId !== undefined ? rawId : (inputEl ? inputEl.value : '')).trim().replace(/^@/, '');

  if (!targetId) {
    liveState.connectionState = 'failed';
    liveState.connectionError = 'Vui lòng nhập TikTok Unique ID!';
    addLog('Kết nối thất bại: Chưa nhập TikTok ID', 'error');
    renderAll(); broadcastStateToGame(); return;
  }

  if (!/^[a-zA-Z0-9._]{2,30}$/.test(targetId)) {
    liveState.connectionState = 'failed';
    liveState.connectionError = 'TikTok ID chứa ký tự không hợp lệ.';
    addLog(`Kết nối thất bại: ID @${targetId} không đúng định dạng TikTok`, 'error');
    renderAll(); broadcastStateToGame(); return;
  }

  // Kiểm tra server đang chạy không
  const serverOk = await checkServerRunning();
  if (!serverOk) {
    liveState.connectionState = 'failed';
    liveState.connectionError = 'Server chưa chạy! Hãy mở terminal và chạy: node server.js';
    addLog('❌ Server Node.js chưa chạy! Mở terminal trong thư mục game và chạy: node server.js', 'error');
    renderAll(); broadcastStateToGame(); return;
  }

  liveState.tiktokId = targetId;
  liveState.connectionState = 'connecting';
  liveState.connectionError = '';
  addLog(`🔄 Đang kết nối tới TikTok Live ID: @${targetId} qua Node.js Bridge...`, 'info');
  renderAll();

  // Bắt đầu lắng nghe SSE trước
  startSSEListener();

  // Rồi mới gửi lệnh kết nối
  try {
    const res = await fetch(`${BRIDGE_SERVER}/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: targetId }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    liveState.connectionState = 'failed';
    liveState.connectionError = 'Không thể gọi server: ' + err.message;
    addLog('❌ Lỗi gọi server bridge: ' + err.message, 'error');
    renderAll(); broadcastStateToGame();
  }
}

function disconnectTikTokId() {
  const oldId = liveState.tiktokId;

  // Gọi server để ngắt kết nối
  fetch(`${BRIDGE_SERVER}/disconnect`, { method: 'POST' }).catch(() => {});

  // Đóng SSE
  if (sseSource) { sseSource.close(); sseSource = null; }

  liveState.tiktokId = '';
  liveState.connectionState = 'disconnected';
  liveState.connectionError = '';
  addLog(`⚫ Đã ngắt kết nối TikTok Live ID: @${oldId}`, 'warn');
  renderAll();
  broadcastStateToGame();
}

window.connectTikTokId = connectTikTokId;
window.disconnectTikTokId = disconnectTikTokId;

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
  if (confirm('Bạn có chắc muốn ĐẶT LẠI TOÀN BỘ PHÊN LIVE này?\n• Xóa toàn bộ dữ liệu phiên live trong localStorage\n• Đặt về Màn 1 / Mặc định 100 màn\n• Xóa danh sách Follower đã lưu')) {
    // Xóa toàn bộ dữ liệu phiên live trong localStorage (cả state control và state game live)
    localStorage.removeItem(STORAGE_KEY_STATE);
    localStorage.removeItem('tiktok_xep_bong_live_state');

    // Reset lại liveState về mặc định
    liveState.currentLevel = 1;
    liveState.totalLevels = 100;
    liveState.isPaused = false;
    liveState.followedUsers = [];
    liveState.logs = [];
    addLog('Đã ĐẶT LẠI phiên live: Xóa dữ liệu localStorage + về Màn 1 / 100 Màn', 'warn');
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

// 5.5. Xử lý sự kiện Follow (CHỐNG UNFOLLOW SPAM + ĐỒNG BỘ TỨC THÌ LÊN GAME)
function handleUserFollow(inputString) {
  if (!inputString || typeof inputString !== 'string' || !inputString.trim()) return;

  // Tách danh sách người xem theo dấu phẩy ","
  const userList = inputString.split(',').map(u => u.trim()).filter(Boolean);
  if (userList.length === 0) return;

  userList.forEach(user => {
    const cleanUser = user.trim().replace(/^@/, '').toLowerCase();
    if (!cleanUser) return;

    if (liveState.isPaused) {
      addLog(`Bỏ qua Follow từ @${cleanUser} (Do đang tạm dừng nhận)`, 'warn');
      return;
    }

    // KIỂM TRA UNFOLLOW / RE-FOLLOW: Nếu đã follow rồi thì KHÔNG CỘNG MÀN
    if (liveState.followedUsers.includes(cleanUser)) {
      addLog(`Bỏ qua @${cleanUser} (Tài khoản này đã follow trước đó!)`, 'warn');
      return;
    }

    // Đánh dấu người dùng đã follow & cộng +1 màn
    liveState.followedUsers.push(cleanUser);
    liveState.totalLevels += 1;
    addLog(`@${cleanUser} đã Follow -> +1 Màn thử thách!`, 'follow');

    renderAll();
    // Đồng bộ tức thì sang màn hình Game + hiện Toast thông báo
    broadcastStateToGame({ type: 'FOLLOW', username: cleanUser, addedLevels: 1 });
  });
}

// 5.6. Xử lý sự kiện Tặng Quà (Gift)
function handleUserGift(inputString, giftName, coinValue) {
  if (!inputString || !coinValue || coinValue <= 0) return;

  const rawString = typeof inputString === 'string' ? inputString : String(inputString);
  const userList = rawString.split(',').map(u => u.trim()).filter(Boolean);
  if (userList.length === 0) return;

  userList.forEach(user => {
    const cleanUser = user.trim().replace(/^@/, '').toLowerCase();
    if (!cleanUser) return;

    if (liveState.isPaused) {
      addLog(`Bỏ qua Quà (${giftName}) từ @${cleanUser} (Do đang tạm dừng)`, 'warn');
      return;
    }

    const addedLevels = parseInt(coinValue, 10) || 1; // 1 xu = 1 màn
    liveState.totalLevels += addedLevels;
    addLog(`@${cleanUser} tặng ${giftName || 'Quà'} (${addedLevels} xu) -> +${addedLevels} Màn!`, 'gift');

    renderAll();
    // Đồng bộ tức thì sang màn hình Game + hiện Toast thông báo
    broadcastStateToGame({ type: 'GIFT', username: cleanUser, giftName: giftName || 'Quà', addedLevels: addedLevels });
  });
}

// Global Exports & Listener cho TikTok Connectors (Extension / Bookmarklet / Node Connector)
window.handleUserFollow = handleUserFollow;
window.handleUserGift = handleUserGift;
window.onTikTokFollow = handleUserFollow;
window.onTikTokGift = handleUserGift;

// 5.8. Xử lý sự kiện Share
function handleUserShare(username) {
  if (!username) return;
  const cleanUser = String(username).trim().replace(/^@/, '').toLowerCase();
  if (!cleanUser) return;
  if (liveState.isPaused) {
    addLog(`Bỏ qua Share từ @${cleanUser} (Do đang tạm dừng)`, 'warn');
    return;
  }
  liveState.totalLevels += 1;
  addLog(`@${cleanUser} đã Chia sẻ Live -> +1 Màn thử thách!`, 'share');
  renderAll();
  broadcastStateToGame({ type: 'SHARE', username: cleanUser, addedLevels: 1 });
}

// 5.9. Xử lý sự kiện Comment (hiển thị log, không cộng màn)
function handleUserComment(username, comment) {
  if (!username || !comment) return;
  const cleanUser = String(username).trim().replace(/^@/, '');
  addLog(`💬 @${cleanUser}: ${comment}`, 'comment');
}

// 5.10. Xử lý sự kiện Like (chỉ hiển thị log, không cộng màn để tránh spam)
function handleUserLike(username, count) {
  if (!username) return;
  const cleanUser = String(username).trim().replace(/^@/, '');
  if (!cleanUser) return;
  addLog(`❤️ @${cleanUser} đã thích x${count || 1}`, 'like');
}

window.addEventListener('message', (event) => {
  if (!event || !event.data) return;
  const d = event.data;
  if (d.type === 'TIKTOK_FOLLOW' || d.type === 'follow' || d.event === 'follow' || d.type === 'member') {
    const user = d.username || d.uniqueId || d.nickname || d.userId;
    if (user) handleUserFollow(user);
  } else if (d.type === 'TIKTOK_GIFT' || d.type === 'gift' || d.event === 'gift') {
    const user = d.username || d.uniqueId || d.nickname || d.userId;
    const giftName = d.giftName || d.name || 'Quà';
    const coins = d.diamondCount || d.coins || d.coinValue || d.repeatCount || 1;
    if (user) handleUserGift(user, giftName, coins);
  } else if (d.type === 'TIKTOK_SHARE' || d.type === 'share' || d.event === 'share') {
    const user = d.username || d.uniqueId || d.nickname;
    if (user) handleUserShare(user);
  }
});

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

  // Render thẻ trạng thái kết nối TikTok ID (4 trạng thái: disconnected, connecting, connected, failed)
  renderConnectStatusBox();

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

function renderConnectStatusBox() {
  const box = document.getElementById('connect-status-box');
  const input = document.getElementById('tiktok-id-input');
  const btnConnect = document.getElementById('btn-connect-tiktok');
  if (!box) return;

  const state = liveState.connectionState || (liveState.tiktokId ? 'connected' : 'disconnected');

  if (state === 'connecting') {
    if (btnConnect) {
      btnConnect.disabled = true;
      btnConnect.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Đang kết nối...`;
    }
    box.innerHTML = `
      <div class="status-badge connecting">
        <div class="status-badge-text">
          <i class="fa-solid fa-circle-notch fa-spin"></i>
          <span>Đang kết nối tới phiên Live của <strong>@${liveState.tiktokId}</strong>...</span>
        </div>
      </div>
    `;
  } else if (state === 'connected') {
    if (btnConnect) {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<i class="fa-solid fa-plug"></i> Kết nối lại`;
    }
    box.innerHTML = `
      <div class="status-badge connected">
        <div class="status-badge-text">
          <i class="fa-solid fa-circle-check"></i>
          <span>Đã kết nối: <strong>@${liveState.tiktokId}</strong></span>
        </div>
        <button type="button" class="btn-disconnect-id" onclick="disconnectTikTokId()" title="Ngắt kết nối phiên này">
          <i class="fa-solid fa-power-off"></i> Ngắt kết nối
        </button>
      </div>
    `;
  } else if (state === 'failed') {
    if (btnConnect) {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<i class="fa-solid fa-plug"></i> Kết nối`;
    }
    box.innerHTML = `
      <div class="status-badge failed">
        <div class="status-badge-text">
          <i class="fa-solid fa-circle-exclamation"></i>
          <span>Kết nối thất bại: ${liveState.connectionError || 'Không thể kết nối.'}</span>
        </div>
        <button type="button" class="btn-retry-id" onclick="connectTikTokId('${liveState.tiktokId || (input ? input.value : '')}')" title="Thử kết nối lại">
          <i class="fa-solid fa-rotate-right"></i> Thử lại
        </button>
      </div>
    `;
  } else {
    // disconnected
    if (btnConnect) {
      btnConnect.disabled = false;
      btnConnect.innerHTML = `<i class="fa-solid fa-plug"></i> Kết nối`;
    }
    box.innerHTML = `
      <div class="status-badge disconnected">
        <div class="status-badge-text">
          <i class="fa-solid fa-circle-xmark"></i>
          <span>Chưa kết nối TikTok ID</span>
        </div>
      </div>
    `;
  }
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

window.selectHistoryId = function (id) {
  document.getElementById('tiktok-id-input').value = id;
  connectTikTokId(id);
};

window.removeHistoryId = function (event, idToRemove) {
  event.stopPropagation(); // Tránh kích hoạt chọn ID khi nhấn nút xóa
  idHistory = idHistory.filter(id => id !== idToRemove);
  localStorage.setItem(STORAGE_KEY_ID_HISTORY, JSON.stringify(idHistory));
  renderHistoryTags();
};

window.clearAllHistoryId = function () {
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
    let username = (document.getElementById('sim-username').value || '').trim();
    if (!username) {
      username = `khangia_${Math.floor(Math.random() * 900 + 100)}`;
    }
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

// Simulation: Test Comment
const btnSimComment = document.getElementById('btn-sim-comment');
if (btnSimComment) {
  btnSimComment.addEventListener('click', () => {
    let username = (document.getElementById('sim-username').value || '').trim();
    let commentText = (document.getElementById('sim-comment-text').value || '').trim();
    if (!username) username = `viewer_${Math.floor(Math.random() * 900 + 100)}`;
    if (!commentText) commentText = 'Thử thách hay quá!';
    handleUserComment(username, commentText);
  });
}

// Simulation: Test Gift
document.querySelectorAll('[data-gift]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    let username = (document.getElementById('sim-username').value || '').trim();
    if (!username) username = `viewer_${Math.floor(Math.random() * 900 + 100)}`;
    const gift = e.currentTarget.dataset.gift;
    const coins = parseInt(e.currentTarget.dataset.coins, 10);
    handleUserGift(username, gift, coins);
  });
});

// Simulation: Test Share
const btnSimShare = document.getElementById('btn-sim-share');
if (btnSimShare) {
  btnSimShare.addEventListener('click', () => {
    let username = (document.getElementById('sim-username').value || '').trim();
    if (!username) username = `viewer_${Math.floor(Math.random() * 900 + 100)}`;
    handleUserShare(username);
  });
}

// Simulation: Test Like
const btnSimLike = document.getElementById('btn-sim-like');
if (btnSimLike) {
  btnSimLike.addEventListener('click', () => {
    let username = (document.getElementById('sim-username').value || '').trim();
    if (!username) username = `viewer_${Math.floor(Math.random() * 900 + 100)}`;
    handleUserLike(username, Math.floor(Math.random() * 20 + 5));
  });
}

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
