// Danh sách các game trong hệ thống
// Khi có thêm game mới ở thư mục con, chỉ cần khai báo thêm vào mảng này
const GAMES_DATA = [
  {
    id: 'xep-bong',
    title: 'Xếp bóng',
    category: 'puzzle',
    categoryName: 'Trí Tuệ',
    description: 'Thử thách sắp xếp các quả bóng cùng màu vào từng ống nghiệm. Game giải đố rèn luyện trí não cực lôi cuốn!',
    path: './xep-bong/index.html',
    thumbnail: './xep-bong/xep-bong.png',
    tags: ['Xếp bóng', 'Logic', 'Thư giãn'],
    status: 'Sẵn sàng',
    isReady: true
  },
  {
    id: 'xep-so',
    title: 'Xếp Số',
    category: 'puzzle',
    categoryName: 'Trí Tuệ',
    description: 'Trò chơi xếp số kinh điển! Trượt các ô số về đúng thứ tự từ 1 đến N với ít bước nhất. 3 độ khó: 3×3, 4×4, 5×5.',
    path: './xep-so/index.html',
    thumbnail: './xep-so/xep-so.jpg',
    tags: ['Xếp số', 'Sliding Puzzle', 'Logic', 'Trí Tuệ'],
    status: 'Sẵn sàng',
    isReady: true
  },
  {
    id: 'tim-so',
    title: 'Tìm Số',
    category: 'puzzle',
    categoryName: 'Trí Tuệ',
    description: 'Thử thách tinh mắt! Tìm các con số từ 1 đến đích trên bản đồ. Hỗ trợ phóng to/thu nhỏ, kéo bản đồ và gợi ý.',
    path: './tim-so/index.html',
    thumbnail: './tim-so/tim-so.jpg',
    tags: ['Tìm số', 'Tinh mắt', 'Thử thách', 'Trí Tuệ'],
    status: 'Sẵn sàng',
    isReady: true
  }
];

// State
let currentCategory = 'all';
let currentSearch = '';

// DOM Elements
const gamesGrid = document.getElementById('gamesGrid');
const gameCountEl = document.getElementById('gameCount');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearch');
const categoryTabs = document.querySelectorAll('.tab-btn');
const emptyState = document.getElementById('emptyState');
const resetFilterBtn = document.getElementById('resetFilterBtn');

// Render games list
function renderGames() {
  const filtered = GAMES_DATA.filter(game => {
    const matchesCategory = (currentCategory === 'all') || (game.category === currentCategory);
    const matchesSearch = game.title.toLowerCase().includes(currentSearch.toLowerCase()) ||
                          game.description.toLowerCase().includes(currentSearch.toLowerCase()) ||
                          game.tags.some(t => t.toLowerCase().includes(currentSearch.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  gameCountEl.textContent = GAMES_DATA.filter(g => g.isReady).length;

  if (filtered.length === 0) {
    gamesGrid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }

  emptyState.style.display = 'none';

  gamesGrid.innerHTML = filtered.map(game => {
    const statusBadge = game.isReady 
      ? `<span class="game-badge-status"><i class="fa-solid fa-circle-check"></i> Có sẵn</span>`
      : `<span class="game-badge-status game-badge-soon"><i class="fa-regular fa-clock"></i> Sắp ra mắt</span>`;

    const playButton = game.isReady 
      ? `<a href="${game.path}" class="play-btn"><i class="fa-solid fa-play"></i> Chơi Ngay</a>`
      : `<span class="play-btn disabled"><i class="fa-solid fa-lock"></i> Sớm thôi</span>`;

    const myRankInfo = game.userRank ? `<div class="user-top-rank-badge"><i class="fa-solid fa-trophy"></i> Hạng của bạn: Top ${game.userRank.rank} (Lvl ${game.userRank.level})</div>` : '';

    const thumbElement = game.isReady
      ? `<a href="${game.path}" class="game-thumb-link" aria-label="Chơi ngay ${game.title}">
          <img src="${game.thumbnail}" alt="${game.title}" class="game-thumb" onerror="this.src='captain.png'">
          <div class="game-thumb-overlay">
            <span class="play-circle-icon"><i class="fa-solid fa-play"></i></span>
          </div>
        </a>`
      : `<div class="game-thumb-link disabled">
          <img src="${game.thumbnail}" alt="${game.title}" class="game-thumb" onerror="this.src='captain.png'">
        </div>`;

    return `
      <article class="game-card">
        <div class="game-thumb-wrapper">
          ${thumbElement}
          <span class="game-badge-category">${game.categoryName}</span>
          ${statusBadge}
        </div>
        <div class="game-details">
          <h3 class="game-title"><a href="${game.isReady ? game.path : '#'}" class="game-title-link">${game.title}</a></h3>
          <p class="game-desc">${game.description}</p>
          ${myRankInfo}
          <div class="game-meta">
            <div class="game-tags">
              ${game.tags.map(tag => `<span class="tag-pill">#${tag}</span>`).join('')}
            </div>
            ${playButton}
          </div>
        </div>
      </article>
    `;
  }).join('');
}

// Kiểm tra thứ hạng người chơi từ Firebase cho từng game
async function checkUserRanks() {
  if (window.getMyLeaderboardRank) {
    for (const game of GAMES_DATA) {
      if (game.isReady) {
        const rankInfo = await window.getMyLeaderboardRank(game.id);
        if (rankInfo) {
          game.userRank = rankInfo;
        }
      }
    }
    renderGames();
  }
}

// Event Listeners
searchInput.addEventListener('input', (e) => {
  currentSearch = e.target.value.trim();
  clearSearchBtn.style.display = currentSearch ? 'block' : 'none';
  renderGames();
});

clearSearchBtn.addEventListener('click', () => {
  searchInput.value = '';
  currentSearch = '';
  clearSearchBtn.style.display = 'none';
  renderGames();
  searchInput.focus();
});

categoryTabs.forEach(btn => {
  btn.addEventListener('click', () => {
    categoryTabs.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCategory = btn.dataset.category;
    renderGames();
  });
});

resetFilterBtn.addEventListener('click', () => {
  currentCategory = 'all';
  currentSearch = '';
  searchInput.value = '';
  clearSearchBtn.style.display = 'none';
  categoryTabs.forEach(b => b.classList.remove('active'));
  document.querySelector('.tab-btn[data-category="all"]').classList.add('active');
  renderGames();
});

// Initial Render
document.addEventListener('DOMContentLoaded', () => {
  renderGames();
  setTimeout(checkUserRanks, 500);
});
