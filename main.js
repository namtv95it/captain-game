// Danh sách các game trong hệ thống
// Khi có thêm game mới ở thư mục con, chỉ cần khai báo thêm vào mảng này
const GAMES_DATA = [
  {
    id: 'xep-hinh',
    title: 'Xếp bóng',
    category: 'puzzle',
    categoryName: 'Trí Tuệ',
    description: 'Thử thách sắp xếp các quả bóng cùng màu vào từng ống nghiệm. Game giải đố rèn luyện trí não cực lôi cuốn!',
    path: './xep-hinh/index.html',
    thumbnail: './xep-hinh/xep-hinh.png',
    tags: ['Xếp bóng', 'Logic', 'Thư giãn'],
    status: 'Sẵn sàng',
    isReady: true
  },
  {
    id: 'snake-retro',
    title: 'Retro Snake Master',
    category: 'arcade',
    categoryName: 'Arcade',
    description: 'Trò chơi rắn săn mồi cổ điển với đồ họa neon hiện đại và nhiều loại chướng ngại vật hấp dẫn.',
    path: '#',
    thumbnail: 'captain.png',
    tags: ['Rắn săn mồi', 'Retro', 'Neon'],
    status: 'Sắp ra mắt',
    isReady: false
  },
  {
    id: 'space-invader',
    title: 'Galaxy Defender',
    category: 'action',
    categoryName: 'Hành Động',
    description: 'Bắn tàu vũ trụ vượt qua các làn đạn không gian và bảo vệ trạm chỉ huy của bạn khỏi người ngoài hành tinh.',
    path: '#',
    thumbnail: 'captain.png',
    tags: ['Bắn phi thuyền', 'Bắn súng'],
    status: 'Sắp ra mắt',
    isReady: false
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

    return `
      <article class="game-card">
        <div class="game-thumb-wrapper">
          <img src="${game.thumbnail}" alt="${game.title}" class="game-thumb" onerror="this.src='captain.png'">
          <span class="game-badge-category">${game.categoryName}</span>
          ${statusBadge}
        </div>
        <div class="game-details">
          <h3 class="game-title">${game.title}</h3>
          <p class="game-desc">${game.description}</p>
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
});
