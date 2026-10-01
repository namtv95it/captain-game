/**
 * MarbleBlend v4 – Multi-Step Sequential Blend
 *
 * FLOW:
 *   User sets: Character + N steps (each step: emoji + result image)
 *   On Blend:
 *     Step 1: Character + Emoji1 → blend animation → show Result1 → pause 2-3s
 *     Step 2: Result1 + Emoji2  → blend animation → show Result2 → pause 2-3s
 *     ...
 *     Done when all steps completed.
 */

'use strict';

/* ─────────────────────── STATE ─────────────────────── */
let activeTab = 'blend';

const S = {
  charImg: null,          // Ảnh nhân vật gốc
  steps: [],            // Array of { emojiImg, resultImg } (up to 4)
  stepCount: 1,             // Current number of blend steps rendered
  style: 'swirl',
  animId: null,
  running: false,
  time: 0,
  chainIdx: 0,             // current step index being blended
  chainPrev: null,          // Image used as "character" in current chain step
  lastResultImg: null,      // Last completed result image object
  headerTimer: null,        // Timer for delayed mobile header reveal
  _escHandler: null,        // Keydown handler for ESC to exit recording mode
};

/* ─────────────────────── DOM ─────────────────────── */
const canvas = document.getElementById('blend-canvas');
const ctx = canvas.getContext('2d');
const theater = document.getElementById('theater');
const fly1 = document.getElementById('fly-1');
const fly2 = document.getElementById('fly-2');
const flyImg1 = document.getElementById('fly-img-1');
const flyImg2 = document.getElementById('fly-img-2');
const resultWrap = document.getElementById('result-reveal');
const resultImg = document.getElementById('result-img');
const bgCharWrap = document.getElementById('bg-char-wrap');
const bgCharImg = document.getElementById('bg-char-img');
const toastEl = document.getElementById('toast');
const stepLabelOv = document.getElementById('step-label-overlay');
const emojiHeaderEl = document.getElementById('emoji-header-inner');
const emojiPlaceholder = document.getElementById('emoji-header-placeholder');
const phaseBar = document.getElementById('phase-bar');

/* ─────────────────────── CANVAS SIZE HELPER ─────────────────────── */
// Always use offsetWidth/offsetHeight (pre-CSS-transform DOM size)
// getBoundingClientRect() returns post-transform size which is wrong in recording mode
function syncCanvasSize() {
  const w = theater.offsetWidth;
  const h = theater.offsetHeight;
  if (w > 0 && h > 0) {
    canvas.width = w;
    canvas.height = h;
  }
}

/* ─────────────────────── CHARACTER UPLOAD ─────────────────────── */
function pickFile(n) {
  document.getElementById(`file-${n}`).click();
}

const charInput = document.getElementById('file-1');
const charCard = document.getElementById('card-1');

charInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadCharSlot(f);
});

charCard.addEventListener('dragover', e => { e.preventDefault(); charCard.classList.add('drag-over'); });
charCard.addEventListener('dragleave', () => charCard.classList.remove('drag-over'));
charCard.addEventListener('drop', e => {
  e.preventDefault();
  charCard.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.type.startsWith('image/')) loadCharSlot(f);
});

function loadCharSlot(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      S.charImg = img;
      document.getElementById('body-1').style.display = 'none';
      const pv = document.getElementById('prev-1');
      pv.style.display = 'flex';
      document.getElementById('pimg-1').src = ev.target.result;
      // Show in theater background immediately
      bgCharImg.src = ev.target.result;
      bgCharWrap.classList.add('show');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearSlot(n) {
  if (n === 1) {
    S.charImg = null;
    document.getElementById('body-1').style.display = 'flex';
    document.getElementById('prev-1').style.display = 'none';
    document.getElementById('file-1').value = '';
    bgCharWrap.classList.remove('show');
    bgCharImg.src = '';
    resetAll();
  }
}

/* ─────────────────────── BLEND TABLE SYSTEM ─────────────────────── */

// G: gallery state
const G = {
  emojiImages:  [],     // Image objects in order
  resultImages: [],     // Image objects in order
  dragCol:    null,     // 'emoji' | 'result' — which column is being dragged
  dragColIdx: null,     // index within that column
};

const MAX_STEPS = 4;

// G_effects: per-step style/reveal cache
const G_effects = [
  { style: 'fusion', revealStyle: 'none' },
  { style: 'fusion', revealStyle: 'none' },
  { style: 'fusion', revealStyle: 'none' },
  { style: 'fusion', revealStyle: 'none' },
];

/* ── Sync G arrays → S.steps ── */
function syncStepsFromGallery() {
  const count = Math.max(G.emojiImages.length, G.resultImages.length);
  S.steps = [];
  S.stepCount = count;
  for (let i = 0; i < count; i++) {
    S.steps.push({
      emojiImg:    G.emojiImages[i]  || null,
      resultImg:   G.resultImages[i] || null,
      style:       G_effects[i]?.style       || 'fusion',
      revealStyle: G_effects[i]?.revealStyle || 'none',
    });
  }
  refreshEmojiHeader();
}

/* ── Helper: attach per-column drag events to an image wrap ── */
function attachColDrag(wrap, col, idx, cell, arr, renderCb = null) {
  wrap.draggable = true;

  wrap.addEventListener('dragstart', e => {
    e.stopPropagation();
    G.dragCol    = col;
    G.dragColIdx = idx;
    wrap.classList.add('bt-col-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(new Image(), 0, 0);
  });

  wrap.addEventListener('dragend', e => {
    e.stopPropagation();
    wrap.classList.remove('bt-col-dragging');
    document.querySelectorAll('.bt-cell-over').forEach(c => c.classList.remove('bt-cell-over'));
    G.dragCol    = null;
    G.dragColIdx = null;
  });

  // Accept drops on the parent cell
  cell.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('Files')) return;
    if (G.dragCol !== col || G.dragColIdx === idx) return;
    e.preventDefault();
    e.stopPropagation();
    // Clear other highlights then highlight this cell
    document.querySelectorAll('.bt-cell-over, .drag-over').forEach(c => c.classList.remove('bt-cell-over', 'drag-over'));
    cell.classList.add('bt-cell-over');
    wrap.classList.add('drag-over');
  });

  cell.addEventListener('dragleave', e => {
    if (!cell.contains(e.relatedTarget)) {
      cell.classList.remove('bt-cell-over');
      wrap.classList.remove('drag-over');
    }
  });

  cell.addEventListener('drop', e => {
    if (e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    cell.classList.remove('bt-cell-over');
    const from = G.dragColIdx;
    if (G.dragCol !== col || from === null || from === idx) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(idx, 0, moved);
    G.dragCol    = null;
    G.dragColIdx = null;
    if (typeof renderCb === 'function') {
      renderCb();
    } else {
      renderBlendTable();
      syncStepsFromGallery();
    }
  });
}

function attachCellDropTarget(cell, col, idx, arr, renderCb = null) {
  cell.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('Files')) return;
    if (G.dragCol !== col || G.dragColIdx === idx) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.bt-cell-over').forEach(c => c.classList.remove('bt-cell-over'));
    cell.classList.add('bt-cell-over');
  });

  cell.addEventListener('dragleave', e => {
    if (!cell.contains(e.relatedTarget)) cell.classList.remove('bt-cell-over');
  });

  cell.addEventListener('drop', e => {
    if (e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    cell.classList.remove('bt-cell-over');
    const from = G.dragColIdx;
    if (G.dragCol !== col || from === null || from === idx) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(idx, 0, moved);
    G.dragCol    = null;
    G.dragColIdx = null;
    if (typeof renderCb === 'function') {
      renderCb();
    } else {
      renderBlendTable();
      syncStepsFromGallery();
    }
  });
}

/* ── Main render: 3-column table ── */
function renderBlendTable() {
  const tbody        = document.getElementById('blend-table-body');
  const countEl      = document.getElementById('steps-count');
  const addRow       = document.getElementById('bt-add-row');
  const addEmojiBtn  = document.getElementById('bt-add-emoji');
  const addResultBtn = document.getElementById('bt-add-result');
  const emptyHint    = document.getElementById('bt-empty-hint');
  if (!tbody) return;

  const count = Math.max(G.emojiImages.length, G.resultImages.length);
  if (countEl) countEl.textContent = count > 0 ? `${count}/${MAX_STEPS}` : '';

  tbody.innerHTML = '';

  if (emptyHint) emptyHint.style.display = count === 0 ? 'flex' : 'none';

  // Always show bottom add row and both (+) add buttons unconditionally
  if (addRow)       addRow.style.display       = 'flex';
  if (addEmojiBtn)  addEmojiBtn.style.visibility  = 'visible';
  if (addResultBtn) addResultBtn.style.visibility = 'visible';

  for (let i = 0; i < count; i++) {
    const eff      = G_effects[i] || { style: 'fusion', revealStyle: 'none' };
    const emojiImg = G.emojiImages[i];
    const resImg   = G.resultImages[i];

    const row = document.createElement('div');
    row.className = 'bt-row';
    // NOT draggable at row level — each column handles its own drag

    // ── Col 1: Emoji (1:1) ──
    const emojiCell = document.createElement('div');
    emojiCell.className = 'bt-cell bt-cell-emoji';

    if (emojiImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bt-img-wrap bt-emoji-wrap';
      wrap.title = 'Kéo để đổi thứ tự';
      const img = document.createElement('img');
      img.src = emojiImg.src;
      img.draggable = false;
      const badge = document.createElement('span');
      badge.className = 'bt-img-badge';
      badge.textContent = i + 1;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.type = 'button';
      del.title = 'Xóa ảnh này';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.addEventListener('mousedown', e => e.stopPropagation());
      del.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        G.emojiImages.splice(i, 1);
        renderBlendTable();
      });
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      emojiCell.appendChild(wrap);
      // Attach independent column drag
      attachColDrag(wrap, 'emoji', i, emojiCell, G.emojiImages);
    }

    // ── Col 2: Hiệu ứng ──
    const fxCell = document.createElement('div');
    fxCell.className = 'bt-cell bt-cell-fx';

    const blendSel = document.createElement('select');
    blendSel.className = 'bt-select';
    blendSel.id = `gstep-style-${i}`;
    blendSel.title = 'Kiểu blend';
    blendSel.innerHTML = `
      <option value="fusion"${eff.style==='fusion'?' selected':''}>✨ Fusion</option>
      <option value="ripple"${eff.style==='ripple'?' selected':''}>🌊 Ripple</option>
      <option value="swirl"${eff.style==='swirl'?' selected':''}>🌀 Swirl</option>
      <option value="marble"${eff.style==='marble'?' selected':''}>🔮 Marble</option>`;
    blendSel.addEventListener('change', e => {
      G_effects[i] = G_effects[i] || { style: 'fusion', revealStyle: 'none' };
      G_effects[i].style = e.target.value;
      if (S.steps[i]) S.steps[i].style = e.target.value;
      saveSettings();
    });

    const revealSel = document.createElement('select');
    revealSel.className = 'bt-select';
    revealSel.id = `gstep-reveal-${i}`;
    revealSel.title = 'Hiệu ứng kết quả';
    revealSel.innerHTML = `
      <option value="none"${eff.revealStyle==='none'?' selected':''}>🚫 Không</option>
      <option value="eraser-stroke-up"${eff.revealStyle==='eraser-stroke-up'?' selected':''}>🪄 Tẩy ngang</option>
      <option value="eraser-up"${eff.revealStyle==='eraser-up'?' selected':''}>⬆️ Tẩy thẳng</option>
      <option value="vortex-spiral"${eff.revealStyle==='vortex-spiral'?' selected':''}>🌀 Xoáy ốc</option>
      <option value="diamond-grid"${eff.revealStyle==='diamond-grid'?' selected':''}>🧱 Mảnh ghép</option>
      <option value="split-curtain"${eff.revealStyle==='split-curtain'?' selected':''}>🚪 Bóc rèm</option>
      <option value="classic"${eff.revealStyle==='classic'?' selected':''}>✨ Classic</option>`;
    revealSel.addEventListener('change', e => {
      G_effects[i] = G_effects[i] || { style: 'fusion', revealStyle: 'none' };
      G_effects[i].revealStyle = e.target.value;
      if (S.steps[i]) S.steps[i].revealStyle = e.target.value;
      saveSettings();
    });

    fxCell.appendChild(blendSel);
    fxCell.appendChild(revealSel);

    // ── Col 3: Kết quả (9:16) ──
    const resCell = document.createElement('div');
    resCell.className = 'bt-cell bt-cell-result';

    if (resImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bt-img-wrap bt-result-wrap';
      wrap.title = 'Kéo để đổi thứ tự';
      const img = document.createElement('img');
      img.src = resImg.src;
      img.draggable = false;
      const badge = document.createElement('span');
      badge.className = 'bt-img-badge';
      badge.textContent = i + 1;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.type = 'button';
      del.title = 'Xóa ảnh này';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.addEventListener('mousedown', e => e.stopPropagation());
      del.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        G.resultImages.splice(i, 1);
        renderBlendTable();
      });
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      resCell.appendChild(wrap);
      // Attach independent column drag
      attachColDrag(wrap, 'result', i, resCell, G.resultImages);
    }

    row.appendChild(emojiCell);
    row.appendChild(fxCell);
    row.appendChild(resCell);
    tbody.appendChild(row);
  }

  syncStepsFromGallery();
}

/* ── Load files into G array then re-render ── */
function loadFilesIntoGallery(type, files) {
  const arr    = type === 'emoji' ? G.emojiImages : G.resultImages;
  const remain = MAX_STEPS - arr.length;
  if (remain <= 0) { toast(`Tối đa ${MAX_STEPS} ảnh! 🎯`); return; }

  const toLoad = Array.from(files).filter(f => f.type.startsWith('image/')).slice(0, remain);
  if (toLoad.length === 0) return;

  let loaded = 0;
  toLoad.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        arr.push(img);
        loaded++;
        if (loaded === toLoad.length) renderBlendTable();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── Init file inputs & drop targets ── */
(function initBlendTable() {
  ['emoji', 'result'].forEach(type => {
    const input = document.getElementById(`${type}-multi-input`);
    if (input) {
      input.addEventListener('change', e => {
        loadFilesIntoGallery(type, e.target.files);
        e.target.value = '';
      });
    }
  });

  const addEmoji  = document.getElementById('bt-add-emoji');
  const addResult = document.getElementById('bt-add-result');
  if (addEmoji)  addEmoji.addEventListener('click',  () => document.getElementById('emoji-multi-input').click());
  if (addResult) addResult.addEventListener('click', () => document.getElementById('result-multi-input').click());

  // File drag-drop onto the whole table area
  const wrapEl = document.querySelector('.bt-wrap');
  if (wrapEl) {
    wrapEl.addEventListener('dragover', e => {
      if (e.dataTransfer.types.includes('Files')) e.preventDefault();
    });
    wrapEl.addEventListener('drop', e => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      const type = G.emojiImages.length <= G.resultImages.length ? 'emoji' : 'result';
      loadFilesIntoGallery(type, e.dataTransfer.files);
    });
  }

  renderBlendTable();
})();

/* ── Compatibility stubs ── */
function updateStepStyle(idx, v)  { G_effects[idx]=G_effects[idx]||{}; G_effects[idx].style=v; if(S.steps[idx]) S.steps[idx].style=v; saveSettings(); }
function updateStepReveal(idx, v) { G_effects[idx]=G_effects[idx]||{}; G_effects[idx].revealStyle=v; if(S.steps[idx]) S.steps[idx].revealStyle=v; saveSettings(); }
function pickStepFile() {}
function addStep()    {}
function removeStep() {}
function clearStepSlot(ev, idx, type) {
  if (ev) ev.stopPropagation();
  if (type === 'emoji')  G.emojiImages.splice(idx, 1);
  else                   G.resultImages.splice(idx, 1);
  renderBlendTable();
  syncStepsFromGallery();
}
function renderGallery()          {}
function syncDropzoneVisibility() {}

/* ─────────────────────── QUESTION CHIPS ─────────────────────── */


/* ─────────────────────── QUESTION CHIPS ─────────────────────── */
function applyQuestion(btn) {
  const input = document.getElementById('final-question-input');
  if (!input) return;
  input.value = btn.textContent.trim().toUpperCase();
  // Highlight active chip
  document.querySelectorAll('.q-chip').forEach(c => c.classList.remove('q-chip-active'));
  btn.classList.add('q-chip-active');
  saveSettings();
}

function pickStepFile(idx, type) {
  document.getElementById(`${type}-file-${idx}`).click();
}

function loadStepSlot(idx, type, file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      if (!S.steps[idx]) S.steps[idx] = { emojiImg: null, resultImg: null };
      if (type === 'emoji') {
        S.steps[idx].emojiImg = img;
        document.getElementById(`emoji-body-${idx}`).style.display = 'none';
        const pv = document.getElementById(`emoji-prev-${idx}`);
        pv.style.display = 'flex';
        document.getElementById(`emoji-img-${idx}`).src = ev.target.result;
        refreshEmojiHeader();
      } else {
        S.steps[idx].resultImg = img;
        document.getElementById(`result-body-${idx}`).style.display = 'none';
        const pv = document.getElementById(`result-prev-${idx}`);
        pv.style.display = 'flex';
        document.getElementById(`result-img-${idx}`).src = ev.target.result;
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearStepSlot(event, idx, type) {
  event.stopPropagation();
  if (!S.steps[idx]) return;
  if (type === 'emoji') {
    S.steps[idx].emojiImg = null;
    document.getElementById(`emoji-body-${idx}`).style.display = 'flex';
    document.getElementById(`emoji-prev-${idx}`).style.display = 'none';
    const fi = document.getElementById(`emoji-file-${idx}`);
    if (fi) fi.value = '';
    refreshEmojiHeader();
  } else {
    S.steps[idx].resultImg = null;
    document.getElementById(`result-body-${idx}`).style.display = 'flex';
    document.getElementById(`result-prev-${idx}`).style.display = 'none';
    const fi = document.getElementById(`result-file-${idx}`);
    if (fi) fi.value = '';
  }
}

/* ─────────────────────── EMOJI HEADER BAR ─────────────────────── */
function getHeaderBadgeHTML(idx) {
  let badgeType = 'actions';
  if (activeTab === 'pokemon') {
    const pokeBadgeSelect = document.getElementById('poke-badge-type-select');
    badgeType = pokeBadgeSelect?.value || 'numbers';
  } else {
    const badgeTypeSelect = document.getElementById('badge-type-select');
    badgeType = badgeTypeSelect?.value || 'actions';
  }

  if (badgeType === 'actions') {
    const icons = [
      '<i class="fa-solid fa-heart"></i>',
      '<i class="fa-solid fa-comment"></i>',
      '<i class="fa-solid fa-share"></i>',
      '<i class="fa-solid fa-bell"></i>'
    ];
    return icons[idx % icons.length];
  } else if (badgeType === 'hearts') {
    const hearts = [
      '<i class="fa-solid fa-heart"></i>',
      '<i class="fa-solid fa-heart-pulse"></i>',
      '<i class="fa-solid fa-heart-circle-bolt"></i>',
      '<i class="fa-solid fa-heart-circle-check"></i>'
    ];
    return hearts[idx % hearts.length];
  } else {
    return idx + 1;
  }
}

function getResultBadgeHTML(idx, isPokeMode = false) {
  let badgeType = 'actions';
  if (isPokeMode) {
    const pokeBadgeSelect = document.getElementById('poke-badge-type-select');
    badgeType = pokeBadgeSelect?.value || 'numbers';
  } else {
    const badgeTypeSelect = document.getElementById('badge-type-select');
    badgeType = badgeTypeSelect?.value || 'actions';
  }

  if (badgeType === 'actions') {
    const actions = [
      { icon: '<i class="fa-solid fa-heart"></i>', label: 'LIKE' },
      { icon: '<i class="fa-solid fa-comment"></i>', label: 'COMMENT' },
      { icon: '<i class="fa-solid fa-share"></i>', label: 'SHARE' },
      { icon: '<i class="fa-solid fa-bell"></i>', label: 'SUBSCRIBE' }
    ];
    const act = actions[idx % actions.length];
    return `${act.icon} <span>${act.label}</span>`;
  } else if (badgeType === 'hearts') {
    const hearts = [
      '<i class="fa-solid fa-heart"></i>',
      '<i class="fa-solid fa-heart-pulse"></i>',
      '<i class="fa-solid fa-heart-circle-bolt"></i>',
      '<i class="fa-solid fa-heart-circle-check"></i>'
    ];
    return `${hearts[idx % hearts.length]} <span>#${idx + 1}</span>`;
  } else {
    return `<i class="fa-solid fa-star"></i> <span>${idx + 1}</span>`;
  }
}

function refreshEmojiHeader() {
  if (!emojiHeaderEl) return;

  let uploaded = [];
  if (activeTab === 'pokemon') {
    uploaded = P.monsterImages.map((img, i) => ({ idx: i, img }));
  } else {
    uploaded = S.steps
      .map((s, i) => ({ idx: i, img: s.emojiImg }))
      .filter(s => s.img !== null);
  }

  if (uploaded.length === 0) {
    emojiHeaderEl.innerHTML = '';
    const ph = document.createElement('span');
    ph.className = 'emoji-header-placeholder';
    ph.id = 'emoji-header-placeholder';
    ph.textContent = activeTab === 'pokemon' ? 'Pokemon sẽ hiển thị ở đây sau khi tải lên ✨' : 'Emoji sẽ hiển thị ở đây sau khi tải lên ✨';
    emojiHeaderEl.appendChild(ph);
    return;
  }

  emojiHeaderEl.innerHTML = '';
  uploaded.forEach(({ idx, img }) => {
    const item = document.createElement('div');
    item.className = 'emoji-header-item';
    item.id = `emoji-header-item-${idx}`;

    const badge = document.createElement('span');
    badge.className = 'step-num-badge';
    badge.innerHTML = getHeaderBadgeHTML(idx);

    const imgEl = document.createElement('img');
    imgEl.src = img.src;
    imgEl.alt = `Emoji bước ${idx + 1}`;

    item.appendChild(imgEl);
    item.appendChild(badge);
    emojiHeaderEl.appendChild(item);
  });
}

function updateEmojiHeaderState(activeIdx) {
  document.querySelectorAll('.emoji-header-item').forEach(el => {
    const idx = parseInt(el.id.replace('emoji-header-item-', ''));
    const wasActive = el.classList.contains('active-step');
    el.classList.remove('active-step', 'done-step');

    if (idx < activeIdx) {
      el.classList.add('done-step');
    } else if (idx === activeIdx) {
      // Force reflow to retrigger CSS animation each time
      void el.offsetWidth;
      el.classList.add('active-step');
    }
  });
}

/* ─────────────────────── CONTROLS ─────────────────────── */
function syncVal(key) {
  document.getElementById(`val-${key}`).textContent =
    document.getElementById(`sl-${key}`).value;
  saveSettings();
}

/* ─────────────────────── LOCALSTORAGE SETTINGS ─────────────────────── */
const LS_KEY = 'blend_settings_v1';

function saveSettings() {
  const stepsData = S.steps.map(s => ({
    style: s.style || 'fusion',
    revealStyle: s.revealStyle || 'eraser-stroke-up',
  }));

  const data = {
    steps: stepsData,
    question: document.getElementById('final-question-input')?.value || 'VOTE FOR YOUR FAVORITE VERSION!',
    badgeType: document.getElementById('badge-type-select')?.value || 'actions',
    swirl: document.getElementById('sl-swirl')?.value || '100',
    speed: document.getElementById('sl-speed')?.value || '7',
  };

  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { }
}

function loadSettings() {
  let data;
  try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { }
  if (!data) return;

  // Restore per-step style & reveal selects
  if (Array.isArray(data.steps)) {
    data.steps.forEach((sd, i) => {
      if (!S.steps[i]) return;
      if (sd.style) {
        S.steps[i].style = sd.style;
        const sel = document.getElementById(`step-style-${i}`);
        if (sel) sel.value = sd.style;
      }
      if (sd.revealStyle) {
        S.steps[i].revealStyle = sd.revealStyle;
        const sel = document.getElementById(`step-reveal-${i}`);
        if (sel) sel.value = sd.revealStyle;
      }
    });
  }

  // Restore final question
  if (data.question !== undefined) {
    const q = document.getElementById('final-question-input');
    if (q) q.value = data.question;
  }

  // Restore badge type
  if (data.badgeType) {
    const b = document.getElementById('badge-type-select');
    if (b) { b.value = data.badgeType; refreshEmojiHeader(); }
  }

  // Restore sliders
  if (data.swirl) {
    const sl = document.getElementById('sl-swirl');
    if (sl) { sl.value = data.swirl; syncVal('swirl'); }
  }
  if (data.speed) {
    const sl = document.getElementById('sl-speed');
    if (sl) { sl.value = data.speed; syncVal('speed'); }
  }
}

// Auto-save when question or badge type changes — script runs after DOM so safe to hook directly
(function initSettings() {
  loadSettings();

  const q = document.getElementById('final-question-input');
  if (q) q.addEventListener('input', saveSettings);

  const b = document.getElementById('badge-type-select');
  if (b) b.addEventListener('change', saveSettings);
})();

function setStyle(s) {
  S.style = s;
  document.querySelectorAll('.pill').forEach(p =>
    p.classList.toggle('active', p.dataset.style === s)
  );
}

/* ─────────────────────── PHASE BAR (dynamic) ─────────────────────── */
function buildPhaseBar(totalSteps) {
  phaseBar.innerHTML = '';
  // Phases per step: Char, Emoji, Blend, Result + pauses between steps
  // Simplified: one dot per step + final
  const labels = [];
  for (let i = 0; i < totalSteps; i++) labels.push(`Bước ${i + 1}`);
  labels.push('Hoàn tất');

  labels.forEach((lbl, i) => {
    const step = document.createElement('div');
    step.className = 'phase-step';
    step.id = `ph-${i}`;
    step.innerHTML = `<div class="ph-dot"></div><span>${lbl}</span>`;
    phaseBar.appendChild(step);
    if (i < labels.length - 1) {
      const line = document.createElement('div');
      line.className = 'ph-line';
      line.id = `ph-line-${i}`;
      phaseBar.appendChild(line);
    }
  });
}

function setPhase(p, total) {
  const count = total + 1; // steps + finish
  for (let i = 0; i < count; i++) {
    const step = document.getElementById(`ph-${i}`);
    if (!step) continue;
    step.classList.remove('active', 'done');
    if (i < p) step.classList.add('done');
    else if (i === p) step.classList.add('active');
  }
  for (let i = 0; i < count - 1; i++) {
    const line = document.getElementById(`ph-line-${i}`);
    if (line) line.classList.toggle('fill', i < p);
  }
}

/* ─────────────────────── RESET ─────────────────────── */
function resetAll() {
  if (S.animId) cancelAnimationFrame(S.animId);
  S.running = false; S.time = 0;
  S.chainIdx = 0; S.chainPrev = null; S.lastResultImg = null;

  setFlyStyle(fly1, { top: '-60%', opacity: '0', bottom: 'auto' });
  setFlyStyle(fly2, { bottom: '-60%', opacity: '0', top: 'auto' });

  // Clean up desktop countdown overlay if present
  const existingCountdown = document.getElementById('desktop-countdown');
  if (existingCountdown) existingCountdown.remove();

  canvas.classList.remove('visible');
  canvas.style.opacity = '';
  canvas.style.transition = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resultWrap.classList.remove('show');
  const resBadge = document.getElementById('result-badge');
  if (resBadge) resBadge.classList.remove('show');

  bgCharWrap.classList.remove('show');
  const currentCharImg = (activeTab === 'pokemon' ? P.charImg : S.charImg);
  if (currentCharImg) {
    bgCharImg.src = currentCharImg.src;
    bgCharWrap.classList.add('show');
  }

  // stepLabelOv hidden

  const finalGridWrap = document.getElementById('final-grid-wrap');
  if (finalGridWrap) finalGridWrap.classList.remove('show');

  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) {
    if (activeTab === 'pokemon') emojiHeaderBar.classList.add('hidden');
    else emojiHeaderBar.classList.remove('hidden');
  }

  const btnBlend = document.getElementById('btn-blend');
  if (btnBlend) btnBlend.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Bắt đầu Blend';
  const btnDl = document.getElementById('btn-dl');
  if (btnDl) btnDl.style.display = 'none';

  // Reset step highlight states
  document.querySelectorAll('.blend-step').forEach(el => {
    el.classList.remove('active-blend', 'done-blend');
  });
  updateEmojiHeaderState(-1);
  if (phaseBar) phaseBar.innerHTML = '';

  // Reset Pokemon card overlay & fan screen
  const pokeOverlay = document.getElementById('poke-card-overlay');
  const questionDisp = document.getElementById('poke-card-question-display');
  const pokeFanOverlay = document.getElementById('poke-fan-screen-overlay');
  const pokeFanQuestion = document.getElementById('poke-fan-question-display');

  if (pokeOverlay) pokeOverlay.classList.remove('show');
  if (questionDisp) questionDisp.classList.remove('show');
  if (pokeFanOverlay) pokeFanOverlay.classList.remove('show');
  if (pokeFanQuestion) pokeFanQuestion.classList.remove('show');

  // Reset Battle Solo states & overlay
  const battleOverlay = document.getElementById('battle-theater-overlay');
  const victoryOverlay = document.getElementById('battle-victory-overlay');
  if (battleOverlay) battleOverlay.classList.remove('show');
  if (victoryOverlay) victoryOverlay.classList.remove('show');
  if (B.timer) {
    clearTimeout(B.timer);
    B.timer = null;
  }
  B.running = false;

  if (P.pokeTimer) {
    clearTimeout(P.pokeTimer);
    P.pokeTimer = null;
  }
  P.running = false;

  if (S.headerTimer) {
    clearTimeout(S.headerTimer);
    S.headerTimer = null;
  }

  // Close mobile theater and move right-panel back if open
  const mobileOverlay = document.getElementById('mobile-theater-overlay');
  if (mobileOverlay) {
    mobileOverlay.classList.remove('hide-bar');
    if (mobileOverlay.classList.contains('show')) {
      mobileOverlay.classList.remove('show');
      const splitLayout = document.querySelector('.split-layout');
      const rightPanel = document.getElementById('right-panel');
      if (rightPanel && splitLayout) {
        const rightSidebar = document.querySelector('.right-sidebar');
        if (rightSidebar) {
          splitLayout.insertBefore(rightPanel, rightSidebar);
        } else {
          splitLayout.appendChild(rightPanel);
        }
      }
    }
  }

  // Exit desktop recording mode
  exitRecordingMode();
}

/* ── Clear all uploaded images (Character, Emojis, Results) ── */
function clearAllUploadedImages() {
  // 1. Clear character
  S.charImg = null;
  const body1 = document.getElementById('body-1');
  const prev1 = document.getElementById('prev-1');
  const file1 = document.getElementById('file-1');
  if (body1) body1.style.display = 'flex';
  if (prev1) prev1.style.display = 'none';
  if (file1) file1.value = '';
  if (bgCharWrap) bgCharWrap.classList.remove('show');
  if (bgCharImg) bgCharImg.src = '';

  // 2. Clear gallery blend steps (emojis & results)
  G.emojiImages = [];
  G.resultImages = [];
  renderBlendTable();

  // 3. Reset animation & runtime state
  resetAll();
}

/* ─────────────────────── RUN BLEND ─────────────────────── */
function runBlend() {
  if (S.running) { resetAll(); return; }

  // Validate
  if (!S.charImg) {
    toast('Vui lòng chọn ảnh nhân vật gốc! 🦸');
    return;
  }
  // Check at least 1 complete step
  const validSteps = S.steps.filter(s => s.emojiImg && s.resultImg);
  if (validSteps.length === 0) {
    toast('Cần ít nhất 1 bước có đủ emoji + kết quả! 🎨');
    return;
  }
  // Check for incomplete steps (warn but proceed with valid ones)
  const total = S.steps.filter(s => s.emojiImg && s.resultImg).length;
  // Only process steps that are fully filled
  // Build effective step list
  const effectiveSteps = S.steps.filter(s => s.emojiImg && s.resultImg);

  S.running = true;
  S.chainIdx = 0;
  S.chainPrev = S.charImg;
  S.lastResultImg = null;

  const finalGridWrap = document.getElementById('final-grid-wrap');
  if (finalGridWrap) finalGridWrap.classList.remove('show');

  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) emojiHeaderBar.classList.remove('hidden');

  document.getElementById('btn-blend').innerHTML = '<i class="fa-solid fa-square"></i> Dừng';
  document.getElementById('btn-dl').style.display = 'none';

  buildPhaseBar(effectiveSteps.length);

  // Mobile: open fullscreen theater then show character 6s before blend
  if (window.innerWidth < 1024) {
    openMobileTheater();
    showMobileCharPreview(6, () => {
      if (S.running) runChainStep(effectiveSteps, 0);
    });
  } else {
    enterRecordingMode();
    // Wait 6s silently before first emoji appears (desktop only, one-time to let Fullscreen banner vanish)
    setTimeout(() => {
      if (S.running) runChainStep(effectiveSteps, 0);
    }, 6000);
  }
}

function openMobileTheater() {
  const overlay = document.getElementById('mobile-theater-overlay');
  const content = document.getElementById('mobile-theater-content');
  const rightPanel = document.getElementById('right-panel');
  if (overlay && content && rightPanel) {
    content.appendChild(rightPanel);
    overlay.classList.add('show', 'hide-bar');
    // Recalculate canvas size after move
    const resizeCanvas = () => syncCanvasSize();
    resizeCanvas();
    setTimeout(resizeCanvas, 100);
    setTimeout(resizeCanvas, 350);
  }
}

function closeMobileTheater() {
  if (S.headerTimer) {
    clearTimeout(S.headerTimer);
    S.headerTimer = null;
  }
  const overlay = document.getElementById('mobile-theater-overlay');
  const splitLayout = document.querySelector('.split-layout');
  const rightPanel = document.getElementById('right-panel');
  if (overlay) overlay.classList.remove('show', 'hide-bar');
  if (rightPanel && splitLayout) {
    const rightSidebar = document.querySelector('.right-sidebar');
    if (rightSidebar) {
      splitLayout.insertBefore(rightPanel, rightSidebar);
    } else {
      splitLayout.appendChild(rightPanel);
    }
  }
  if (S.running) resetAll();
}

/* ─────────────────────── RECORDING MODE (Desktop) ─────────────────────── */
function enterRecordingMode() {
  // Request browser full-screen mode (F11)
  const elem = document.documentElement;
  if (elem.requestFullscreen) {
    elem.requestFullscreen().catch(() => {});
  } else if (elem.webkitRequestFullscreen) {
    elem.webkitRequestFullscreen();
  } else if (elem.msRequestFullscreen) {
    elem.msRequestFullscreen();
  }

  const updateRecordingLayout = () => {
    if (!document.body.classList.contains('recording-mode')) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Theater natural height fills viewport, width = height * 9/16
    const theaterH = vh;
    const theaterW = theaterH * 9 / 16;

    // After rotating -90deg: visual width = theaterH, visual height = theaterW
    // Scale so visual width fits the full viewport width
    const scale = vw / theaterH;

    theater.style.transform = `rotate(-90deg) scale(${scale})`;
    theater.style.transformOrigin = 'center center';

    // Recalculate canvas dimensions after layout settles
    requestAnimationFrame(() => syncCanvasSize());
  };

  document.body.classList.add('recording-mode');
  updateRecordingLayout();

  // Listen for resize/fullscreen changes to keep layout pixel-perfect
  S._resizeRecordingHandler = () => updateRecordingLayout();
  window.addEventListener('resize', S._resizeRecordingHandler);
  document.addEventListener('fullscreenchange', S._resizeRecordingHandler);

  // ESC key exits recording mode
  S._escHandler = (e) => {
    if (e.key === 'Escape') {
      resetAll();
    }
  };
  document.addEventListener('keydown', S._escHandler);
}

function exitRecordingMode() {
  document.body.classList.remove('recording-mode');
  theater.style.transform = '';
  theater.style.transformOrigin = '';

  if (S._resizeRecordingHandler) {
    window.removeEventListener('resize', S._resizeRecordingHandler);
    document.removeEventListener('fullscreenchange', S._resizeRecordingHandler);
    S._resizeRecordingHandler = null;
  }

  // Remove ESC listener
  if (S._escHandler) {
    document.removeEventListener('keydown', S._escHandler);
    S._escHandler = null;
  }

  // Exit full-screen mode if active
  if (document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }

  // Restore canvas dimensions
  requestAnimationFrame(() => syncCanvasSize());
}

function showMobileCharPreview(seconds, onComplete) {
  let remaining = seconds;

  // Show character image on canvas while waiting
  const drawChar = () => {
    syncCanvasSize();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (S.charImg) {
      // object-fit: contain — draw full image without cropping
      const img = S.charImg;
      const ar = img.width / img.height;
      const W = canvas.width, H = canvas.height;
      let sw, sh, sx, sy;
      if (ar > W / H) { sw = W; sh = W / ar; sx = 0; sy = (H - sh) / 2; }
      else { sh = H; sw = H * ar; sx = (W - sw) / 2; sy = 0; }
      ctx.drawImage(img, sx, sy, sw, sh);
    }
    canvas.classList.add('visible');
    canvas.style.opacity = '1';
  };

  // Show bg character
  if (S.charImg) {
    bgCharImg.src = S.charImg.src;
    bgCharWrap.classList.add('show');
  }

  setTimeout(drawChar, 150);

  const tick = () => {
    if (!S.running) return;
    remaining--;
    if (remaining < 0) {
      canvas.classList.remove('visible');
      canvas.style.opacity = '';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      onComplete();
    } else {
      setTimeout(tick, 1000);
    }
  };

  setTimeout(tick, 1000);
}

function showDesktopCharPreview(seconds, onComplete) {
  let remaining = seconds;

  // Display the current charImg (or the chain's current prev) on bgCharWrap
  const previewImg = S.chainPrev || S.charImg;
  if (previewImg) {
    bgCharImg.src = previewImg.src;
    bgCharWrap.classList.add('show');
  }

  // Create countdown overlay
  const countdownEl = document.createElement('div');
  countdownEl.id = 'desktop-countdown';
  countdownEl.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:30',
    'display:flex', 'align-items:center', 'justify-content:center',
    'pointer-events:none',
    'background:rgba(0,0,0,0.35)',
  ].join(';');

  // Inner wrapper – counter-rotated 90deg so text is readable in landscape recording mode
  const innerEl = document.createElement('div');
  innerEl.style.cssText = [
    'transform:rotate(90deg)',
    'display:flex', 'flex-direction:column',
    'align-items:center', 'justify-content:center',
    'gap:14px',
  ].join(';');

  const numEl = document.createElement('div');
  numEl.style.cssText = [
    'font-size:6rem', 'font-weight:900', 'color:#fff',
    'text-shadow:0 0 40px rgba(124,58,237,.9), 0 2px 16px rgba(0,0,0,.6)',
    'animation:countdownPop .35s ease',
    'line-height:1',
  ].join(';');
  numEl.textContent = remaining;

  const labelEl = document.createElement('div');
  labelEl.style.cssText = [
    'font-size:1.1rem', 'font-weight:700', 'color:rgba(255,255,255,.85)',
    'letter-spacing:.1em', 'text-transform:uppercase',
    'text-shadow:0 1px 10px rgba(0,0,0,.5)',
  ].join(';');
  labelEl.textContent = 'Chuẩn bị...';

  if (!document.getElementById('countdown-kf')) {
    const st = document.createElement('style');
    st.id = 'countdown-kf';
    st.textContent = '@keyframes countdownPop{0%{transform:scale(1.5);opacity:0}100%{transform:scale(1);opacity:1}}';
    document.head.appendChild(st);
  }

  innerEl.appendChild(numEl);
  innerEl.appendChild(labelEl);
  countdownEl.appendChild(innerEl);
  theater.appendChild(countdownEl);

  const tick = () => {
    if (!S.running) {
      countdownEl.remove();
      return;
    }
    remaining--;
    if (remaining <= 0) {
      countdownEl.remove();
      bgCharWrap.classList.remove('show');
      onComplete();
    } else {
      numEl.style.animation = 'none';
      numEl.textContent = remaining;
      requestAnimationFrame(() => {
        numEl.style.animation = 'countdownPop .35s ease';
      });
      setTimeout(tick, 1000);
    }
  };

  setTimeout(tick, 1000);
}

function runChainStep(steps, idx) {
  if (!S.running) return;
  if (idx >= steps.length) {
    // All done!
    finishAllSteps();
    return;
  }

  const step = steps[idx];
  S.chainIdx = idx;
  S._currentStepStyle = step.style || 'swirl';

  // Highlight current step in left panel
  document.querySelectorAll('.blend-step').forEach((el, i) => {
    el.classList.remove('active-blend', 'done-blend');
    const realIdx = parseInt(el.dataset.index);
    // Find original index in S.steps for this step object
    if (S.steps[realIdx] === step) el.classList.add('active-blend');
    else if (S.steps[realIdx] && steps.indexOf(S.steps[realIdx]) >= 0 && steps.indexOf(S.steps[realIdx]) < idx)
      el.classList.add('done-blend');
  });
  updateEmojiHeaderState(S.steps.indexOf(step));
  setPhase(idx, steps.length);

  // Step label hidden (removed by request)

  syncCanvasSize();

  resultWrap.classList.remove('show');
  canvas.classList.remove('visible');
  canvas.style.opacity = '';

  // charImg for this step = previous result (or original char on step 0)
  const charImgForStep = S.chainPrev;
  const emojiImgForStep = step.emojiImg;

  // Display character in bg
  bgCharImg.src = charImgForStep.src;
  bgCharWrap.classList.add('show');

  flyImg1.src = charImgForStep.src;
  flyImg2.src = emojiImgForStep.src;

  setFlyStyle(fly1, { top: '-60%', left: '50%', transform: 'translateX(-50%)', opacity: '0', bottom: 'auto', right: 'auto' });
  setFlyStyle(fly2, { bottom: '-60%', left: '50%', transform: 'translateX(-50%)', opacity: '0', top: 'auto', right: 'auto' });

  // Store refs for render
  S._currentCharImg = charImgForStep;
  S._currentEmojiImg = emojiImgForStep;
  S._currentResultImg = step.resultImg;
  S._pendingSteps = steps;
  S._pendingIdx = idx;

  setTimeout(() => phase1(), 200);
}

function finishAllSteps() {
  S.running = false;
  // stepLabelOv hidden
  document.getElementById('btn-blend').textContent = '🌀 Blend lại';
  document.getElementById('btn-dl').style.display = S.lastResultImg ? 'inline-flex' : 'none';

  // Mark all steps done
  document.querySelectorAll('.blend-step').forEach(el => {
    el.classList.remove('active-blend');
    el.classList.add('done-blend');
  });
  updateEmojiHeaderState(-1);
  setPhase(S._pendingSteps ? S._pendingSteps.length : S.stepCount, S._pendingSteps ? S._pendingSteps.length : S.stepCount);

  // Toast message disabled per request

  setTimeout(() => {
    showFinalGridScreen();
  }, 1200);
}

function showFinalGridScreen() {
  const finalGridWrap = document.getElementById('final-grid-wrap');
  const finalQuestionBox = document.getElementById('final-question-box');
  const finalGridTop = document.getElementById('final-grid-top');
  const finalGridBottom = document.getElementById('final-grid-bottom');
  const questionInput = document.getElementById('final-question-input');
  const badgeTypeSelect = document.getElementById('badge-type-select');

  if (!finalGridWrap || !finalGridTop || !finalGridBottom) return;

  // Question text
  const questionText = (questionInput?.value.trim() || 'WHICH VERSION DO YOU LIKE MOST?').toUpperCase();
  finalQuestionBox.textContent = questionText;

  // Badges setup
  const badgeType = badgeTypeSelect?.value || 'actions';
  let badgeLabels = [];
  if (badgeType === 'actions') {
    badgeLabels = [
      '<i class="fa-solid fa-heart"></i> Like',
      '<i class="fa-solid fa-comment"></i> Comment',
      '<i class="fa-solid fa-share"></i> Share',
      '<i class="fa-solid fa-bell"></i> Subscribe'
    ];
  } else if (badgeType === 'hearts') {
    badgeLabels = [
      '<i class="fa-solid fa-heart"></i> #1',
      '<i class="fa-solid fa-heart-pulse"></i> #2',
      '<i class="fa-solid fa-heart-circle-bolt"></i> #3',
      '<i class="fa-solid fa-heart-circle-check"></i> #4'
    ];
  } else {
    badgeLabels = [
      '<i class="fa-solid fa-1"></i> Option 1',
      '<i class="fa-solid fa-2"></i> Option 2',
      '<i class="fa-solid fa-3"></i> Option 3',
      '<i class="fa-solid fa-4"></i> Option 4'
    ];
  }

  // Clear containers
  finalGridTop.innerHTML = '';
  finalGridBottom.innerHTML = '';

  // Get all completed step results
  const resultSteps = (S._pendingSteps || S.steps).filter(s => s && s.resultImg);

  resultSteps.forEach((step, idx) => {
    const item = document.createElement('div');
    item.className = 'final-grid-item';

    const img = document.createElement('img');
    img.src = step.resultImg.src;
    img.alt = `Result ${idx + 1}`;

    const badge = document.createElement('div');
    // Standardized: Emoji on top, Badge type on bottom for all options
    badge.className = `final-item-badge badge-bottom badge-color-${idx % 4}`;
    badge.innerHTML = badgeLabels[idx] || `Option ${idx + 1}`;

    item.appendChild(img);
    item.appendChild(badge);

    // Emoji badge corresponding to option (always at top)
    if (step.emojiImg) {
      const emojiBadge = document.createElement('div');
      emojiBadge.className = 'final-item-emoji emoji-top';

      const emojiImgEl = document.createElement('img');
      emojiImgEl.src = step.emojiImg.src;
      emojiImgEl.alt = `Emoji ${idx + 1}`;

      emojiBadge.appendChild(emojiImgEl);
      item.appendChild(emojiBadge);
    }

    if (idx < 2) {
      finalGridTop.appendChild(item);
    } else {
      finalGridBottom.appendChild(item);
    }
  });

  // Hide single result reveal animation if active
  resultWrap.classList.remove('show');

  // Hide top emoji header bar when displaying final 4-image grid
  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) emojiHeaderBar.classList.add('hidden');

  // Display final grid overlay
  finalGridWrap.classList.add('show');

  // Trigger sequential badge pop attention animation + sound effect
  const gridItems = finalGridWrap.querySelectorAll('.final-grid-item');
  gridItems.forEach((gridItem, idx) => {
    setTimeout(() => {
      const emojiBadge = gridItem.querySelector('.final-item-emoji');
      const textBadge  = gridItem.querySelector('.final-item-badge');
      if (emojiBadge) {
        emojiBadge.classList.remove('badge-pop-active');
        void emojiBadge.offsetWidth;
        emojiBadge.classList.add('badge-pop-active');
      }
      if (textBadge) {
        textBadge.classList.remove('badge-pop-active');
        void textBadge.offsetWidth;
        textBadge.classList.add('badge-pop-active');
      }
      playSfxBadgePop(idx);
    }, 400 + idx * 350);
  });

  // Mobile: 10s after displaying the 4-result grid, reveal the top header bar again
  if (S.headerTimer) {
    clearTimeout(S.headerTimer);
    S.headerTimer = null;
  }
  S.headerTimer = setTimeout(() => {
    const mobileOverlay = document.getElementById('mobile-theater-overlay');
    if (mobileOverlay) {
      mobileOverlay.classList.remove('hide-bar');
      setTimeout(() => {
        syncCanvasSize();
      }, 100);
    }
  }, 10000);
}

/* ─────────────────────── SOUND SYNTHESIZER (Web Audio API) ─────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

function playSfxBadgePop(index = 0) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const pitches = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6 (ascending cheerful pop)
    const pitch = pitches[index % pitches.length] || 523.25;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitch * 0.85, now);
    osc.frequency.exponentialRampToValueAtTime(pitch * 1.45, now + 0.08);

    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.22);
  } catch (e) { }
}

function playSfxSwoosh(isBottom = false) {
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'sine';
    const now = ctx.currentTime;
    const startFreq = isBottom ? 180 : 650;
    const endFreq = isBottom ? 550 : 220;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + 0.35);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) { }
}

function playSfxImpact() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.4);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);

    const noiseLen = 0.25;
    const bufferSize = ctx.sampleRate * noiseLen;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = 'bandpass';
    nFilter.frequency.setValueAtTime(2400, now);
    nFilter.Q.setValueAtTime(3, now);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.3, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + noiseLen);
    noise.connect(nFilter);
    nFilter.connect(nGain);
    nGain.connect(ctx.destination);
    noise.start(now);
  } catch (e) { }
}

function playSfxSwirlDrone(durMs) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const durSec = (durMs + 650) / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.linearRampToValueAtTime(360, now + durSec);
    lfo.frequency.setValueAtTime(10, now);
    lfo.connect(osc.frequency);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.linearRampToValueAtTime(1800, now + durSec);
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.3);
    gain.gain.setValueAtTime(0.20, now + durSec - 0.2);
    gain.gain.exponentialRampToValueAtTime(0.001, now + durSec);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + durSec);
    lfo.stop(now + durSec);
  } catch (e) { }
}

function playSfxReveal() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51];
    freqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.07);
      gain.gain.setValueAtTime(0.01, now + idx * 0.07);
      gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.07 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.6);
    });
  } catch (e) { }
}

/* ─────────────────────── ANIMATION PHASES ─────────────────────── */
let currentDir = 'bottom';

function phase1() {
  // Character already shown as bg
  setTimeout(phase2, 200);
}

function phase2() {
  fly2.style.opacity = '1';
  playSfxSwoosh(true);

  const directions = ['bottom', 'top', 'left', 'right'];
  currentDir = directions[Math.floor(Math.random() * directions.length)];

  setFlyStyle(fly2, { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', transform: 'none' });

  if (currentDir === 'bottom') {
    setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', bottom: '-60%' });
    animateDir(fly2, 'bottom', -60, 38, 750, () => setTimeout(phase3, 150));
  } else if (currentDir === 'top') {
    setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', top: '-60%' });
    animateDir(fly2, 'top', -60, 38, 750, () => setTimeout(phase3, 150));
  } else if (currentDir === 'left') {
    setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', left: '-60%' });
    animateDir(fly2, 'left', -60, 22.5, 750, () => setTimeout(phase3, 150));
  } else if (currentDir === 'right') {
    setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', right: '-60%' });
    animateDir(fly2, 'right', -60, 22.5, 750, () => setTimeout(phase3, 150));
  }
}

function phase3() {
  // Directly start fusion animation at current landing position without extra movement
  doCollisionFlash();
}

function doCollisionFlash() {
  const flash = document.createElement('div');
  flash.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:20',
    'background:radial-gradient(ellipse 80% 60% at 50% 50%,',
    '  rgba(255,255,255,1) 0%, rgba(255,240,255,.8) 40%, transparent 80%)',
    'border-radius:inherit', 'pointer-events:none',
    'animation:flashOut .55s ease forwards',
  ].join(';');

  if (!document.getElementById('flash-kf')) {
    const st = document.createElement('style');
    st.id = 'flash-kf';
    st.textContent = '@keyframes flashOut{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(st);
  }

  theater.appendChild(flash);

  // Pre-render frame 0 on canvas synchronously before switching visibility to eliminate flicker
  syncCanvasSize();
  renderFrame(0);

  // Show canvas and start blend immediately — runs behind the flash overlay
  bgCharWrap.classList.remove('show');
  canvas.classList.add('visible');
  startSwirlLoop(); // ← blend starts right away

  // Dynamic fusion absorb keyframe: Spin in place (720deg rotation) matching the fly direction base transform
  const baseTr = (currentDir === 'left' || currentDir === 'right') ? 'translateY(-50%)' : 'translateX(-50%)';
  let st = document.getElementById('fusion-absorb-kf');
  if (!st) {
    st = document.createElement('style');
    st.id = 'fusion-absorb-kf';
    document.head.appendChild(st);
  }
  st.textContent = `
    @keyframes fusionAbsorb {
      0%   { opacity: 1;   transform: ${baseTr} scale(1)    rotate(0deg);   filter: blur(0px); }
      30%  { opacity: 0.95; transform: ${baseTr} scale(1.1)  rotate(240deg); filter: blur(0px); }
      100% { opacity: 0;   transform: ${baseTr} scale(0.05) rotate(720deg); filter: blur(8px); }
    }
  `;

  // Emoji "merges into" the character — spins in place, shrinks, blurs out
  // Temporarily lift above canvas (z-index:6) so animation is visible
  fly2.style.zIndex = '15';
  fly2.style.transition = 'none';
  fly2.style.animation = 'fusionAbsorb 0.7s cubic-bezier(.4,0,.2,1) forwards';

  // Clean up after animation completes
  setTimeout(() => {
    fly2.style.animation = '';
    fly2.style.opacity = '0';
    fly2.style.zIndex = '';
    fly2.style.transition = '';
  }, 710);

  // Remove flash overlay after it fades
  setTimeout(() => flash.remove(), 580);
}

function startSwirlLoop() {
  S.time = 0;
  let elapsed = 0;
  const totalMs = 1800;
  const speed = parseFloat(document.getElementById('sl-speed').value);

  function loop() {
    if (!S.running) return;
    const progress = Math.min(1, elapsed / totalMs);
    renderFrame(progress);
    S.time += speed * 0.14;
    elapsed += 16 * (speed / 3.5);
    if (elapsed < totalMs) S.animId = requestAnimationFrame(loop);
    else phase4();
  }
  S.animId = requestAnimationFrame(loop);
}

function phase4() {
  fly1.style.opacity = '0';
  fly2.style.opacity = '0';

  // Prepare Result Badge (do not show yet, wait for reveal to finish)
  const resultBadge = document.getElementById('result-badge');
  if (resultBadge) {
    resultBadge.className = `result-badge badge-color-${S._pendingIdx % 4}`;
    resultBadge.innerHTML = getResultBadgeHTML(S._pendingIdx);
    resultBadge.classList.remove('show');
  }

  // Read revealStyle from current step object
  const currentStep = S._pendingSteps?.[S._pendingIdx];
  const revealStyle = currentStep?.revealStyle || 'eraser-stroke-up';

  const _doEraserReveal = (eraserFn) => {
    resultWrap.classList.remove('reveal-classic');
    resultWrap.classList.add('reveal-eraser');
    resultImg.src = S._currentResultImg.src;
    resultWrap.classList.add('show');
    S.chainPrev = S._currentResultImg;
    S.lastResultImg = S._currentResultImg;
    setTimeout(() => {
      playSfxReveal();
      eraserFn(() => {
        canvas.classList.remove('visible');
        canvas.style.transition = '';
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.opacity = '';
        // Reveal finished: Now show the badge with spring animation!
        if (resultBadge) {
          void resultBadge.offsetWidth;
          resultBadge.classList.add('show');
        }
        _scheduleNextAfterReveal(2500);
      });
    }, 200);
  };

  if (revealStyle === 'none') {
    // ── None: No reveal animation, show result immediately ──
    resultWrap.classList.remove('reveal-eraser');
    resultWrap.classList.remove('reveal-classic');
    resultImg.src = S._currentResultImg.src;
    resultWrap.classList.add('show');
    canvas.classList.remove('visible');
    canvas.style.transition = '';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.style.opacity = '';
    playSfxReveal();
    S.chainPrev = S._currentResultImg;
    S.lastResultImg = S._currentResultImg;
    if (resultBadge) {
      void resultBadge.offsetWidth;
      resultBadge.classList.add('show');
    }
    _scheduleNextAfterReveal(2500);

  } else if (revealStyle === 'classic') {
    // ── Classic: fade canvas out → morphReveal + shockwave ──
    canvas.style.transition = 'opacity .5s ease';
    canvas.style.opacity = '0';
    setTimeout(() => {
      resultWrap.classList.remove('reveal-eraser');
      resultWrap.classList.add('reveal-classic');
      resultImg.src = S._currentResultImg.src;
      resultWrap.classList.add('show');
      canvas.classList.remove('visible');
      canvas.style.transition = '';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      canvas.style.opacity = '';
      playSfxReveal();
      S.chainPrev = S._currentResultImg;
      S.lastResultImg = S._currentResultImg;
      // Show badge after classic morph finishes
      setTimeout(() => {
        if (resultBadge) {
          void resultBadge.offsetWidth;
          resultBadge.classList.add('show');
        }
      }, 700);
      _scheduleNextAfterReveal(2500);
    }, 550);

  } else if (revealStyle === 'eraser-up') {
    _doEraserReveal(startEraserRevealUp);

  } else if (revealStyle === 'eraser-stroke-up') {
    _doEraserReveal(startEraserStrokeUp);

  } else if (revealStyle === 'vortex-spiral') {
    _doEraserReveal(startEraserVortexSpiral);

  } else if (revealStyle === 'diamond-grid') {
    _doEraserReveal(startEraserDiamondGrid);

  } else if (revealStyle === 'split-curtain') {
    _doEraserReveal(startEraserSplitCurtain);

  } else {
    // default: eraser-stroke-up
    _doEraserReveal(startEraserStrokeUp);
  }
}

function _scheduleNextAfterReveal(pauseMs) {
  const currentIdx = S._pendingIdx;
  const allSteps = S._pendingSteps;

  if (currentIdx + 1 < allSteps.length) {
    setTimeout(() => {
      if (!S.running) return;
      const resBadge = document.getElementById('result-badge');
      if (resBadge) resBadge.classList.remove('show');
      bgCharImg.src = S._currentResultImg.src;
      bgCharWrap.classList.add('show');
      resultWrap.classList.remove('show');
      runChainStep(allSteps, currentIdx + 1);
    }, pauseMs);
  } else {
    setTimeout(() => {
      const resBadge = document.getElementById('result-badge');
      if (resBadge) resBadge.classList.remove('show');
      finishAllSteps();
    }, pauseMs);
  }
}

/* ─────────────────────── ERASER REVEAL ─────────────────────── */
function startEraserReveal(onDone) {
  const W = canvas.width;
  const H = canvas.height;

  // We'll draw eraser strokes using destination-out to cut holes in the canvas
  // revealing the result image underneath

  const centerX = W / 2;
  const centerY = H / 2;
  const totalDur = 1800; // ms total to erase
  const startTime = performance.now();

  // Pre-generate a list of stroke "seeds" — random paths that expand outward
  const strokes = [];
  const strokeCount = 28;
  for (let i = 0; i < strokeCount; i++) {
    const angle = (i / strokeCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const dist = 0.12 + Math.random() * 0.08; // normalized radius of full sweep
    strokes.push({
      angle,
      speed: 0.6 + Math.random() * 0.7,
      radius: 22 + Math.random() * 40,
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 2 + Math.random() * 3,
      startDelay: Math.random() * 0.3, // fraction of totalDur before this stroke starts
    });
  }

  // Extra sweeping "big eraser" passes
  const bigPasses = [];
  const bigCount = 5;
  for (let i = 0; i < bigCount; i++) {
    bigPasses.push({
      angle: (i / bigCount) * Math.PI * 2,
      radius: 60 + Math.random() * 60,
      startDelay: 0.3 + (i / bigCount) * 0.55,
      speed: 0.8 + Math.random() * 0.5,
    });
  }

  function erase(now) {
    if (!S.running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalDur); // 0→1

    ctx.globalCompositeOperation = 'destination-out';

    // Draw individual strokes expanding outward from center
    strokes.forEach(s => {
      const localT = Math.max(0, (t - s.startDelay) / (1 - s.startDelay));
      if (localT <= 0) return;

      const maxReach = Math.max(W, H) * 0.85 * s.speed;
      const reach = localT * maxReach;

      const wobble = Math.sin(s.wobble + elapsed * 0.001 * s.wobbleSpeed) * 18;
      const x = centerX + Math.cos(s.angle) * reach + Math.cos(s.angle + Math.PI / 2) * wobble;
      const y = centerY + Math.sin(s.angle) * reach + Math.sin(s.angle + Math.PI / 2) * wobble;

      const r = s.radius * (0.6 + localT * 0.8);
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.85)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // Big sweeping passes
    bigPasses.forEach(s => {
      const localT = Math.max(0, (t - s.startDelay) / (1 - s.startDelay));
      if (localT <= 0) return;

      const maxReach = Math.max(W, H) * s.speed;
      const reach = localT * maxReach;

      const x = centerX + Math.cos(s.angle) * reach;
      const y = centerY + Math.sin(s.angle) * reach;
      const r = s.radius * (0.8 + localT * 0.6);

      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.5, 'rgba(0,0,0,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    // Center "heart" erasure that starts first
    const centerR = (80 + t * 180) * Math.min(1, t * 3);
    const cGrad = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, centerR);
    cGrad.addColorStop(0, 'rgba(0,0,0,1)');
    cGrad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
    cGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(centerX, centerY, centerR, 0, Math.PI * 2);
    ctx.fillStyle = cGrad;
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over'; // restore

    if (t < 1) {
      requestAnimationFrame(erase);
    } else {
      // Final clean — erase entire canvas
      ctx.clearRect(0, 0, W, H);
      onDone();
    }
  }

  requestAnimationFrame(erase);
}

/* ─────────────────────── ERASER REVEAL — BOTTOM TO TOP ─────────────────────── */
function startEraserRevealUp(onDone) {
  const W = canvas.width;
  const H = canvas.height;
  const totalDur = 1600; // ms
  const startTime = performance.now();

  // Each "row band" of the canvas gets erased sequentially from bottom → top.
  // We simulate a brushy eraser by drawing many overlapping soft circles
  // along a horizontal sweep line that rises over time.

  // Pre-generate per-column brush offsets so the edge looks jagged/brushy
  const cols = 40;
  const colOffsets = Array.from({ length: cols }, () => (Math.random() - 0.5) * H * 0.06);
  const colRadii = Array.from({ length: cols }, () => 28 + Math.random() * 36);
  const colWobble = Array.from({ length: cols }, () => Math.random() * Math.PI * 2);
  const colWobbleSpd = Array.from({ length: cols }, () => 1.5 + Math.random() * 3);

  // Extra leading "drip" points that race ahead of the main sweep
  const drips = Array.from({ length: 8 }, (_, i) => ({
    xFrac: 0.05 + (i / 8) * 0.9,
    lead: 0.06 + Math.random() * 0.12,  // how far ahead they go
    r: 18 + Math.random() * 22,
  }));

  function erase(now) {
    if (!S.running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalDur); // 0→1, linear

    // sweepY goes from H (bottom) up to -overshot
    const easeT = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    const sweepY = H - easeT * (H + 60); // main sweep line y position

    ctx.globalCompositeOperation = 'destination-out';

    // ── Main brush band: many soft circles along the sweep line ──
    for (let ci = 0; ci < cols; ci++) {
      const x = (ci / (cols - 1)) * W;
      const wobble = Math.sin(colWobble[ci] + elapsed * 0.001 * colWobbleSpd[ci]) * 14;
      const y = sweepY + colOffsets[ci] + wobble;
      const r = colRadii[ci];

      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.95)');
      grad.addColorStop(0.85, 'rgba(0,0,0,0.6)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // ── Fill everything BELOW the sweep line (already erased zone) ──
    // Use a single tall rectangle below sweepY to ensure no leftover pixels
    if (sweepY < H) {
      const fillY = Math.min(H, sweepY + 50);
      ctx.fillStyle = 'rgba(0,0,0,1)';
      ctx.fillRect(0, fillY, W, H - fillY);
    }

    // ── Drip points that race ahead of the main sweep ──
    drips.forEach(d => {
      const dipY = sweepY - d.lead * H;
      const x = d.xFrac * W;
      const grad = ctx.createRadialGradient(x, dipY, 0, x, dipY, d.r);
      grad.addColorStop(0, 'rgba(0,0,0,0.9)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.5)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(x, dipY, d.r, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    ctx.globalCompositeOperation = 'source-over';

    if (t < 1) {
      requestAnimationFrame(erase);
    } else {
      ctx.clearRect(0, 0, W, H);
      onDone();
    }
  }

  requestAnimationFrame(erase);
}

/* ─────────────────────── ERASER REVEAL — STROKE SWEEP UP ─────────────────────── */
function startEraserStrokeUp(onDone) {
  const W = canvas.width;
  const H = canvas.height;
  const totalDur = 1800; // ms
  const startTime = performance.now();

  // Divide canvas into horizontal bands. Each band is wiped by a stroke
  // moving left→right (even bands) or right→left (odd bands).
  // Bands are revealed from bottom to top progressively.
  const bandCount = 14; // number of horizontal bands
  const bandH = H / bandCount;
  const brushRadius = bandH * 0.85; // brush covers slightly more than one band

  // For each band: pre-generate a "progress offset" so they stagger nicely
  // Bottom band starts first, each band above starts slightly later
  const bandDelay = 0.055; // fraction of totalDur each band starts later

  // Brush stroke x-offsets along the band (for irregular/jagged paint feel)
  const jitterPerBand = Array.from({ length: bandCount }, () =>
    Array.from({ length: 20 }, () => (Math.random() - 0.5) * bandH * 0.5)
  );

  function erase(now) {
    if (!S.running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalDur);

    ctx.globalCompositeOperation = 'destination-out';

    for (let b = 0; b < bandCount; b++) {
      // bandIndex 0 = bottom band, bandIndex bandCount-1 = top band
      const bandFromBottom = b; // 0 = bottom
      const delay = bandFromBottom * bandDelay;
      const localT = Math.max(0, Math.min(1, (t - delay) / (1 - delay)));
      if (localT <= 0) continue;

      // Center Y of this band (from bottom)
      const bandY = H - (bandFromBottom + 0.5) * bandH;

      // Stroke sweeps across X: even=L→R, odd=R→L
      const goRight = (bandFromBottom % 2 === 0);
      const strokeX = goRight
        ? localT * (W + brushRadius * 2) - brushRadius
        : (1 - localT) * (W + brushRadius * 2) - brushRadius;

      // Draw multiple overlapping circles along the stroke path so far
      // (paint all positions from start to current strokeX)
      const steps = Math.ceil(localT * 24) + 1;
      for (let s = 0; s <= steps; s++) {
        const frac = s / steps;
        const sx = goRight
          ? frac * (W + brushRadius * 2) - brushRadius
          : (1 - frac) * (W + brushRadius * 2) - brushRadius;
        if (goRight && sx > strokeX) break;
        if (!goRight && sx < strokeX) break;

        const jitter = jitterPerBand[b][s % 20];
        const sy = bandY + jitter;
        const r = brushRadius * (0.75 + Math.random() * 0.35);

        const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.5, 'rgba(0,0,0,0.95)');
        grad.addColorStop(0.85, 'rgba(0,0,0,0.7)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // Also fill solid below the fully erased zone (no leftover pixels)
      if (localT >= 1) {
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(0, bandY - bandH * 0.5, W, bandH * 1.1);
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    if (t < 1) {
      requestAnimationFrame(erase);
    } else {
      ctx.clearRect(0, 0, W, H);
      onDone();
    }
  }

  requestAnimationFrame(erase);
}

/* ─────────────────────── ERASER REVEAL — VORTEX SPIRAL ─────────────────────── */
function startEraserVortexSpiral(onDone) {
  const W = canvas.width;
  const H = canvas.height;
  const totalDur = 1800;
  const startTime = performance.now();
  const centerX = W / 2;
  const centerY = H / 2;
  const maxR = Math.hypot(W, H) * 0.7;

  // 6 spiral arms
  const armCount = 6;

  function erase(now) {
    if (!S.running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalDur);

    ctx.globalCompositeOperation = 'destination-out';

    const currentMaxR = t * maxR;
    const rot = t * Math.PI * 4; // 2 full rotations as it expands

    for (let a = 0; a < armCount; a++) {
      const armAngleOffset = (a / armCount) * Math.PI * 2;
      const stepCount = Math.ceil(currentMaxR / 6) + 5;

      for (let s = 0; s < stepCount; s++) {
        const rFrac = s / stepCount;
        const r = rFrac * currentMaxR;
        const angle = armAngleOffset + rot + rFrac * 3.5;

        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        const dotRadius = Math.max(12, 18 + rFrac * 38);

        const grad = ctx.createRadialGradient(x, y, 0, x, y, dotRadius);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.6, 'rgba(0,0,0,0.85)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    if (t < 1) {
      requestAnimationFrame(erase);
    } else {
      ctx.clearRect(0, 0, W, H);
      onDone();
    }
  }

  requestAnimationFrame(erase);
}

/* ─────────────────────── ERASER REVEAL — DIAMOND GRID DISSOLVE ─────────────────────── */
function startEraserDiamondGrid(onDone) {
  const W = canvas.width;
  const H = canvas.height;
  const totalDur = 1800;
  const startTime = performance.now();

  const cols = 8;
  const rows = 14;
  const tileW = W / cols;
  const tileH = H / rows;

  const centerX = W / 2;
  const centerY = H / 2;
  const maxDist = Math.hypot(centerX, centerY);

  // Pre-calculate stagger delay based on distance from center + random noise
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const tx = (c + 0.5) * tileW;
      const ty = (r + 0.5) * tileH;
      const dist = Math.hypot(tx - centerX, ty - centerY);
      const distRatio = dist / maxDist; // 0 at center, ~1 at corners
      const delay = distRatio * 0.45 + Math.random() * 0.15;
      tiles.push({ c, r, tx, ty, delay });
    }
  }

  function erase(now) {
    if (!S.running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalDur);

    ctx.globalCompositeOperation = 'destination-out';

    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const localT = Math.max(0, Math.min(1, (t - tile.delay) / (1 - tile.delay)));
      if (localT <= 0) continue;

      if (localT >= 1) {
        ctx.fillStyle = 'rgba(0,0,0,1)';
        ctx.fillRect(tile.c * tileW - 1, tile.r * tileH - 1, tileW + 2, tileH + 2);
      } else {
        const radius = localT * Math.hypot(tileW, tileH) * 0.85;
        const grad = ctx.createRadialGradient(tile.tx, tile.ty, 0, tile.tx, tile.ty, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(0.7, 'rgba(0,0,0,0.9)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');

        ctx.beginPath();
        ctx.arc(tile.tx, tile.ty, radius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = 'source-over';

    if (t < 1) {
      requestAnimationFrame(erase);
    } else {
      ctx.clearRect(0, 0, W, H);
      onDone();
    }
  }

  requestAnimationFrame(erase);
}

/* ─────────────────────── ERASER REVEAL — SPLIT CURTAIN ─────────────────────── */
function startEraserSplitCurtain(onDone) {
  const W = canvas.width;
  const H = canvas.height;
  const totalDur = 1700;
  const startTime = performance.now();
  const centerX = W / 2;

  // Jitter for brushy curtain opening edges
  const edgePoints = 30;
  const pointH = H / edgePoints;
  const jittersL = Array.from({ length: edgePoints + 1 }, () => (Math.random() - 0.5) * 25);
  const jittersR = Array.from({ length: edgePoints + 1 }, () => (Math.random() - 0.5) * 25);

  function erase(now) {
    if (!S.running) return;
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / totalDur);

    ctx.globalCompositeOperation = 'destination-out';

    const sweepDist = t * (W / 2 + 40);

    // Left curtain sweep (opening from center towards x = 0)
    const leftX = centerX - sweepDist;
    // Right curtain sweep (opening from center towards x = W)
    const rightX = centerX + sweepDist;

    ctx.fillStyle = 'rgba(0,0,0,1)';

    // Main center opening rectangle
    if (leftX < rightX) {
      ctx.fillRect(leftX + 15, 0, Math.max(0, rightX - leftX - 30), H);
    }

    // Brushy edges along left and right opening borders
    for (let i = 0; i <= edgePoints; i++) {
      const y = i * pointH;
      const lx = leftX + jittersL[i];
      const rx = rightX + jittersR[i];
      const r = 24 + Math.random() * 12;

      // Left edge brush
      const gradL = ctx.createRadialGradient(lx, y, 0, lx, y, r);
      gradL.addColorStop(0, 'rgba(0,0,0,1)');
      gradL.addColorStop(0.7, 'rgba(0,0,0,0.8)');
      gradL.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(lx, y, r, 0, Math.PI * 2);
      ctx.fillStyle = gradL;
      ctx.fill();

      // Right edge brush
      const gradR = ctx.createRadialGradient(rx, y, 0, rx, y, r);
      gradR.addColorStop(0, 'rgba(0,0,0,1)');
      gradR.addColorStop(0.7, 'rgba(0,0,0,0.8)');
      gradR.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.beginPath();
      ctx.arc(rx, y, r, 0, Math.PI * 2);
      ctx.fillStyle = gradR;
      ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    if (t < 1) {
      requestAnimationFrame(erase);
    } else {
      ctx.clearRect(0, 0, W, H);
      onDone();
    }
  }

  requestAnimationFrame(erase);
}

/* ─────────────────────── RENDER ─────────────────────── */
function renderFrame(progress) {
  const W = canvas.width, H = canvas.height;

  const offA = drawToOff(S._currentCharImg, W, H);
  const offB = drawToOff(S._currentResultImg, W, H); // Blend char → result (new character)
  const pxA = offA.getImageData(0, 0, W, H).data;
  const pxB = offB.getImageData(0, 0, W, H).data;
  const out = ctx.createImageData(W, H);

  const swirl = parseFloat(document.getElementById('sl-swirl').value) / 100;
  const t = S.time;

  const currentStyle = S._currentStepStyle || 'fusion';
  switch (currentStyle) {
    case 'ripple': fxRippleMorph(pxA, pxB, out.data, W, H, t, progress, swirl); break;
    case 'fusion':
    default: fxFusion(pxA, pxB, out.data, W, H, t, progress, swirl); break;
  }

  ctx.putImageData(out, 0, 0);
}

function drawToOff(img, W, H) {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const c = off.getContext('2d');
  // object-fit: contain — keep full image visible, letterbox/pillarbox with transparency
  const ar = img.width / img.height;
  let sw, sh, sx, sy;
  if (ar > W / H) { sw = W; sh = W / ar; sx = 0; sy = (H - sh) / 2; }
  else { sh = H; sw = H * ar; sx = (W - sw) / 2; sy = 0; }
  c.drawImage(img, sx, sy, sw, sh);
  return c;
}

/* ─────────────────────── EFFECTS ─────────────────────── */

/* ── fxFusion: energy-vortex fusion morph (char → new char) ── */
function fxFusion(a, b, out, W, H, t, progress, swirl) {
  const cx = W / 2, cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist; // 0..1
      const angle = Math.atan2(dy, dx);

      // Energy peaks at progress midpoint, fades at start/end
      const energy = Math.sin(progress * Math.PI); // 0→1→0

      // ── Spiral vortex displacement ──
      const spiralFreq = 4;
      const spiralPhase = angle * spiralFreq + t * 2.2 + dist * 7;
      const spiralAmt = Math.sin(spiralPhase) * swirl * energy;
      const radialAmt = Math.cos(t * 2.8 - dist * 5) * swirl * energy * 0.5;

      const offX = (Math.cos(angle + Math.PI / 2) * cx * 0.18 * spiralAmt
        + dx * 0.14 * radialAmt) * energy;
      const offY = (Math.sin(angle + Math.PI / 2) * cy * 0.18 * spiralAmt
        + dy * 0.14 * radialAmt) * energy;

      const sx = clamp(Math.round(x + offX), 0, W - 1);
      const sy = clamp(Math.round(y + offY), 0, H - 1);
      const si = (sy * W + sx) * 4;

      // ── Organic noise blend mask ──
      const nx = (x / W) * 2 - 1, ny = (y / H) * 2 - 1;
      const waveNoise = Math.sin(nx * 12 + t * 1.6) * Math.cos(ny * 12 - t * 1.3) * 0.22;
      const spiralNoise = Math.sin(angle * 6 + dist * 10 - t * 2.4) * 0.18;

      const rawBlend = clamp(progress + waveNoise + spiralNoise, 0, 1);
      // Smoothstep for crisp-but-soft transition
      const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);

      // ── Chromatic glow at the blend edge ──
      const edgeProximity = Math.max(0, 0.28 - Math.abs(rawBlend - 0.5)) / 0.28;
      const glow = edgeProximity * energy * 55;

      out[i] = clamp(lerp(a[si], b[si], blend) + glow * 1.15, 0, 255) | 0;
      out[i + 1] = clamp(lerp(a[si + 1], b[si + 1], blend) + glow * 0.80, 0, 255) | 0;
      out[i + 2] = clamp(lerp(a[si + 2], b[si + 2], blend) + glow * 1.35, 0, 255) | 0;
      out[i + 3] = 255;
    }
  }
}

/* ── fxRippleMorph: expanding circular ripple reveals the new character ── */
function fxRippleMorph(a, b, out, W, H, t, progress, swirl) {
  const cx = W / 2, cy = H / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dx = x - cx, dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / maxDist;
      const angle = Math.atan2(dy, dx);

      // Ripple wave front expands from center
      const rippleWarp = Math.sin(dist * 14 - t * 3) * swirl * 0.05;
      const frontPos = progress + rippleWarp;

      // Behind front → fully revealed; ahead → source char
      const blendBase = clamp((frontPos - dist) / 0.35, 0, 1);
      const blend = blendBase * blendBase * (3 - 2 * blendBase);

      // Displacement: radial push at wave front
      const frontIntensity = Math.exp(-Math.pow(dist - progress, 2) * 28);
      const warpX = Math.cos(angle) * frontIntensity * cx * 0.06 * swirl;
      const warpY = Math.sin(angle) * frontIntensity * cy * 0.06 * swirl;

      const sx = clamp(Math.round(x + warpX), 0, W - 1);
      const sy = clamp(Math.round(y + warpY), 0, H - 1);
      const si = (sy * W + sx) * 4;

      // Glowing rim at wave front
      const rim = frontIntensity * 60;

      out[i] = clamp(lerp(a[si], b[si], blend) + rim * 0.9, 0, 255) | 0;
      out[i + 1] = clamp(lerp(a[si + 1], b[si + 1], blend) + rim * 0.75, 0, 255) | 0;
      out[i + 2] = clamp(lerp(a[si + 2], b[si + 2], blend) + rim * 1.4, 0, 255) | 0;
      out[i + 3] = 255;
    }
  }
}

/* ── Legacy effects (kept for reference) ── */
function fxMarble(a, b, out, W, H, t, p, swirl) {
  const cx = W / 2, cy = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const nx = (x - cx) / W, ny = (y - cy) / H;
      const r = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const a0 = Math.atan2(ny, nx);
      const s1 = Math.sin(r * 0.04 - t * 1.5 + a0 * 4) * swirl * 0.45;
      const s2 = Math.cos(r * 0.025 + t * 1.1 - a0 * 3) * swirl * 0.35;
      const vortex = Math.sin(a0 * 6 + t * 2) * (1 - r / maxR) * swirl * 0.25;
      const dx = Math.round((s1 + s2) * W * 0.08 + vortex * Math.cos(a0) * W * 0.05);
      const dy = Math.round((s2 + s1) * H * 0.08 + vortex * Math.sin(a0) * H * 0.05);
      const sx = clamp(x + dx, 0, W - 1);
      const sy = clamp(y + dy, 0, H - 1);
      const si = (sy * W + sx) * 4;
      const wavePattern = Math.sin(nx * 14 + s1 * 8 + t) * Math.cos(ny * 14 + s2 * 8 - t);
      const spiralMask = Math.sin(a0 * 5 + r * 0.03 - t * 1.8);
      const blendMask = clamp(p * 0.6 + (wavePattern + spiralMask) * 0.35 + 0.15, 0, 1);
      const r_ = lerp(a[si], b[si], blendMask);
      const g_ = lerp(a[si + 1], b[si + 1], blendMask);
      const b_ = lerp(a[si + 2], b[si + 2], blendMask);
      const glow = (1 - Math.abs(blendMask - 0.5) * 2) * 25 * Math.sin(t * 2);
      out[i] = clamp(r_ + glow, 0, 255) | 0;
      out[i + 1] = clamp(g_ + glow, 0, 255) | 0;
      out[i + 2] = clamp(b_ + glow, 0, 255) | 0;
      out[i + 3] = 255;
    }
  }
}

function fxSwirl(a, b, out, W, H, t, p, swirl) {
  const cx = W / 2, cy = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dx = x - cx, dy = y - cy;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx);
      const normR = r / maxR;
      const swirlAng = swirl * 8 * Math.pow(1 - normR, 1.5) * p + t * 0.05;
      const na = ang + swirlAng;
      const sx = clamp(Math.round(cx + r * Math.cos(na)), 0, W - 1);
      const sy = clamp(Math.round(cy + r * Math.sin(na)), 0, H - 1);
      const si = (sy * W + sx) * 4;
      const band = Math.sin(ang * 6 + r / maxR * Math.PI * 5 - t * 2) * .5 + .5;
      const alpha = clamp(p * band + p * (1 - normR) * 0.5, 0, 1);
      let r_ = lerp(a[si], b[si], alpha);
      let g_ = lerp(a[si + 1], b[si + 1], alpha);
      let b_ = lerp(a[si + 2], b[si + 2], alpha);
      const centerGlow = Math.max(0, 1 - normR * 2) * 30 * p;
      out[i] = clamp(r_ + centerGlow, 0, 255) | 0;
      out[i + 1] = clamp(g_ + centerGlow, 0, 255) | 0;
      out[i + 2] = clamp(b_ + centerGlow, 0, 255) | 0;
      out[i + 3] = 255;
    }
  }
}



/* ─────────────────────── FLY ANIMATIONS ─────────────────────── */
function setFlyStyle(el, styles) {
  Object.assign(el.style, styles);
}

function animateDir(el, prop, from, to, durMs, onDone) {
  ['top', 'bottom', 'left', 'right'].forEach(p => {
    if (p !== prop && ((prop === 'top' && p === 'bottom') || (prop === 'bottom' && p === 'top') || (prop === 'left' && p === 'right') || (prop === 'right' && p === 'left'))) {
      el.style[p] = 'auto';
    }
  });
  el.style[prop] = from + '%';
  el.style.opacity = '1';
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / durMs);
    const ease = easeOutSpring(t);
    el.style[prop] = (from + (to - from) * ease) + '%';
    if (t < 1) requestAnimationFrame(step);
    else { el.style[prop] = to + '%'; onDone(); }
  }
  requestAnimationFrame(step);
}

function easeOutSpring(t) {
  return 1 - Math.pow(2, -9 * t) * Math.cos(t * Math.PI * 3.5);
}

/* ─────────────────────── DOWNLOAD ─────────────────────── */
function downloadFinal() {
  if (!S.lastResultImg) return;
  const a = document.createElement('a');
  a.download = `marble-blend-${Date.now()}.png`;
  a.href = S.lastResultImg.src;
  a.click();
}

/* ─────────────────────── MATH ─────────────────────── */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

function fbm(x, y, t) {
  let v = 0, amp = .5, freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * noise2(x * freq + t, y * freq);
    amp *= .5; freq *= 2.1;
  }
  return (v + 1) * .5;
}

function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const n00 = hash2(xi, yi), n10 = hash2(xi + 1, yi);
  const n01 = hash2(xi, yi + 1), n11 = hash2(xi + 1, yi + 1);
  const ux = xf * xf * (3 - 2 * xf), uy = yf * yf * (3 - 2 * yf);
  return lerp(lerp(n00, n10, ux), lerp(n01, n11, ux), uy) * 2 - 1;
}

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/* ─────────────────────── TOAST ─────────────────────── */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ─────────────────────── TAB SWITCHING ─────────────────────── */
function switchTab(tabName) {
  activeTab = tabName;

  // Toggle Tab buttons
  const btnBlend = document.getElementById('tab-btn-blend');
  const btnPoke = document.getElementById('tab-btn-pokemon');
  const btnBattle = document.getElementById('tab-btn-battle');
  if (btnBlend) btnBlend.classList.toggle('active', tabName === 'blend');
  if (btnPoke) btnPoke.classList.toggle('active', tabName === 'pokemon');
  if (btnBattle) btnBattle.classList.toggle('active', tabName === 'battle');

  // Toggle Left panel contents
  const contentBlend = document.getElementById('tab-content-blend');
  const contentPoke = document.getElementById('tab-content-pokemon');
  const contentBattle = document.getElementById('tab-content-battle');
  if (contentBlend) contentBlend.style.display = tabName === 'blend' ? 'flex' : 'none';
  if (contentPoke) contentPoke.style.display = tabName === 'pokemon' ? 'flex' : 'none';
  if (contentBattle) contentBattle.style.display = tabName === 'battle' ? 'flex' : 'none';

  // Toggle Right sidebar tab contents (Always keep right sidebar visible)
  const rightSidebar = document.querySelector('.right-sidebar');
  if (rightSidebar) rightSidebar.style.display = 'flex';

  const rightBlend = document.getElementById('right-tab-content-blend');
  const rightPoke = document.getElementById('right-tab-content-pokemon');
  const rightBattle = document.getElementById('right-tab-content-battle');
  if (rightBlend) rightBlend.style.display = tabName === 'blend' ? 'flex' : 'none';
  if (rightPoke) rightPoke.style.display = tabName === 'pokemon' ? 'flex' : 'none';
  if (rightBattle) rightBattle.style.display = tabName === 'battle' ? 'flex' : 'none';

  // Toggle Emoji Header Bar visibility (Hide in Pokemon & Battle mode)
  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) {
    if (tabName === 'pokemon' || tabName === 'battle') {
      emojiHeaderBar.classList.add('hidden');
    } else {
      emojiHeaderBar.classList.remove('hidden');
      refreshEmojiHeader();
    }
  }

  // Hide overlays
  const pokeOverlay = document.getElementById('poke-card-overlay');
  if (pokeOverlay) pokeOverlay.classList.remove('show');
  const pokeFanOverlay = document.getElementById('poke-fan-screen-overlay');
  if (pokeFanOverlay) pokeFanOverlay.classList.remove('show');
  const battleOverlay = document.getElementById('battle-theater-overlay');
  if (battleOverlay) battleOverlay.classList.remove('show');

  resetAll();
}

/* ─────────────────────── POKEMON FUSION SYSTEM (MULTI-STEP) ─────────────────────── */
const P = {
  charImg: null,
  monsterImages: [],  // Pokemon monsters in order
  cardImages: [],     // Result cards in order
  running: false,
  stepIdx: 0,
  pokeTimer: null
};

// Pick single character file
function pickPokeCharFile() {
  document.getElementById('poke-file-char').click();
}

const pokeCharInput = document.getElementById('poke-file-char');
if (pokeCharInput) {
  pokeCharInput.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadPokeCharSlot(f);
  });
}

function loadPokeCharSlot(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      P.charImg = img;
      document.getElementById('poke-body-char').style.display = 'none';
      const pv = document.getElementById('poke-prev-char');
      pv.style.display = 'flex';
      document.getElementById('poke-pimg-char').src = ev.target.result;

      if (activeTab === 'pokemon') {
        bgCharImg.src = ev.target.result;
        bgCharWrap.classList.add('show');
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearPokeCharSlot() {
  P.charImg = null;
  document.getElementById('poke-body-char').style.display = 'flex';
  document.getElementById('poke-prev-char').style.display = 'none';
  document.getElementById('poke-file-char').value = '';
  bgCharWrap.classList.remove('show');
  bgCharImg.src = '';
}

// Multi-file loaders for Pokemon tab
(function initPokeTableListeners() {
  ['monster', 'card'].forEach(type => {
    const input = document.getElementById(`poke-${type}-multi-input`);
    if (input) {
      input.addEventListener('change', e => {
        loadPokeFilesIntoGallery(type, e.target.files);
        e.target.value = '';
      });
    }
  });

  const addMonster = document.getElementById('poke-bt-add-monster');
  const addCard = document.getElementById('poke-bt-add-card');
  if (addMonster) addMonster.addEventListener('click', () => document.getElementById('poke-monster-multi-input').click());
  if (addCard) addCard.addEventListener('click', () => document.getElementById('poke-card-multi-input').click());
})();

function loadPokeFilesIntoGallery(type, files) {
  const list = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!list.length) return;

  let loadedCount = 0;
  list.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        if (type === 'monster') P.monsterImages.push(img);
        else P.cardImages.push(img);
        loadedCount++;
        if (loadedCount === list.length) {
          renderPokeBlendTable();
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function clearPokeStepSlot(ev, idx, type) {
  if (ev) ev.stopPropagation();
  if (type === 'monster') P.monsterImages.splice(idx, 1);
  else P.cardImages.splice(idx, 1);
  renderPokeBlendTable();
}

function renderPokeBlendTable() {
  const tbody = document.getElementById('poke-blend-table-body');
  const emptyHint = document.getElementById('poke-bt-empty-hint');
  const stepsCount = document.getElementById('poke-steps-count');
  if (!tbody) return;

  const total = Math.max(P.monsterImages.length, P.cardImages.length);
  if (stepsCount) stepsCount.textContent = total ? `(${total} cặp)` : '';
  if (emptyHint) emptyHint.style.display = total === 0 ? 'flex' : 'none';

  tbody.innerHTML = '';
  refreshEmojiHeader();

  for (let i = 0; i < total; i++) {
    const row = document.createElement('div');
    row.className = 'bt-row';
    row.id = `poke-bt-row-${i}`;

    // Column 1: Pokemon Monster
    const mImg = P.monsterImages[i];
    const colMonster = document.createElement('div');
    colMonster.className = 'bt-cell bt-cell-emoji';
    if (mImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bt-img-wrap bt-emoji-wrap';
      wrap.title = 'Kéo để đổi thứ tự';
      const img = document.createElement('img');
      img.src = mImg.src;
      img.draggable = false;
      const badge = document.createElement('span');
      badge.className = 'bt-img-badge';
      badge.textContent = i + 1;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.type = 'button';
      del.title = 'Xóa ảnh này';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.addEventListener('mousedown', e => e.stopPropagation());
      del.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        P.monsterImages.splice(i, 1);
        renderPokeBlendTable();
      });
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      colMonster.appendChild(wrap);
      attachColDrag(wrap, 'poke-monster', i, colMonster, P.monsterImages, renderPokeBlendTable);
    } else {
      colMonster.innerHTML = `
        <div class="bt-slot-empty" onclick="document.getElementById('poke-monster-multi-input').click()">
          <i class="fa-solid fa-plus"></i><span>Pokemon</span>
        </div>
      `;
      attachCellDropTarget(colMonster, 'poke-monster', i, P.monsterImages, renderPokeBlendTable);
    }

    // Column 2: FX indicator
    const colFx = document.createElement('div');
    colFx.className = 'bt-cell bt-cell-fx';
    colFx.innerHTML = `<span class="bt-fx-tag">⚡ Fusion</span>`;

    // Column 3: Pokemon Result Card
    const cImg = P.cardImages[i];
    const colCard = document.createElement('div');
    colCard.className = 'bt-cell bt-cell-result';
    if (cImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bt-img-wrap bt-result-wrap';
      wrap.title = 'Kéo để đổi thứ tự';
      const img = document.createElement('img');
      img.src = cImg.src;
      img.draggable = false;
      const badge = document.createElement('span');
      badge.className = 'bt-img-badge';
      badge.textContent = i + 1;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.type = 'button';
      del.title = 'Xóa ảnh này';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.addEventListener('mousedown', e => e.stopPropagation());
      del.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        P.cardImages.splice(i, 1);
        renderPokeBlendTable();
      });
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      colCard.appendChild(wrap);
      attachColDrag(wrap, 'poke-card', i, colCard, P.cardImages, renderPokeBlendTable);
    } else {
      colCard.innerHTML = `
        <div class="bt-slot-empty" onclick="document.getElementById('poke-card-multi-input').click()">
          <i class="fa-solid fa-plus"></i><span>Thẻ kết quả</span>
        </div>
      `;
      attachCellDropTarget(colCard, 'poke-card', i, P.cardImages, renderPokeBlendTable);
    }

    row.appendChild(colMonster);
    row.appendChild(colFx);
    row.appendChild(colCard);
    tbody.appendChild(row);
  }
}

/* ─────────────────────── RUN MULTI-STEP POKEMON BLEND ─────────────────────── */
function runPokeBlend() {
  const count = Math.min(P.monsterImages.length, P.cardImages.length);
  if (!P.charImg || count === 0) {
    toast('Vui lòng tải: 1. Ảnh nhân vật gốc và ít nhất 1 cặp (Pokemon + Thẻ kết quả)! ⚡');
    return;
  }
  if (P.running) return;
  P.running = true;

  // Enter recording mode (rotate view landscape for short video recording)
  enterRecordingMode();

  // Keep emoji header & hide previous overlays
  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) emojiHeaderBar.classList.remove('hidden');
  const pokeOverlay = document.getElementById('poke-card-overlay');
  if (pokeOverlay) pokeOverlay.classList.remove('show');
  const pokeFanOverlay = document.getElementById('poke-fan-screen-overlay');
  if (pokeFanOverlay) pokeFanOverlay.classList.remove('show');

  P.stepIdx = 0;
  startPokeStepSequence(0);
}

function startPokeStepSequence(stepIdx) {
  const totalSteps = Math.min(P.monsterImages.length, P.cardImages.length);
  if (stepIdx >= totalSteps) {
    // All steps done -> Show card fan-out deck end screen!
    updateEmojiHeaderState(-1);
    showPokeCardFanOutScreen();
    return;
  }

  P.stepIdx = stepIdx;
  updateEmojiHeaderState(stepIdx);
  const currentMonster = P.monsterImages[stepIdx];
  const currentCard = P.cardImages[stepIdx];

  // 1. Display background character full-frame with Zoom-in animation
  bgCharImg.src = P.charImg.src;
  bgCharWrap.classList.remove('show', 'zoom-in');
  void bgCharWrap.offsetWidth; // force reflow
  bgCharWrap.classList.add('show', 'zoom-in');

  // Wait 6s on step 0 (for browser full-screen banner to fade away) and 1.8s on subsequent steps
  const initialDelay = (stepIdx === 0) ? 6000 : 1800;
  P.pokeTimer = setTimeout(() => {
    if (!P.running) return;

    fly2.style.opacity = '1';
    flyImg2.src = currentMonster.src;
    playSfxSwoosh(true);

    const directions = ['bottom', 'top', 'left', 'right'];
    currentDir = directions[Math.floor(Math.random() * directions.length)];

    setFlyStyle(fly2, { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', transform: 'none' });

    const doPokeCollisionFlash = () => {
      const flash = document.createElement('div');
      flash.style.cssText = [
        'position:absolute', 'inset:0', 'z-index:20',
        'background:radial-gradient(ellipse 80% 60% at 50% 50%,',
        '  rgba(255,255,255,1) 0%, rgba(255,240,255,.8) 40%, transparent 80%)',
        'border-radius:inherit', 'pointer-events:none',
        'animation:flashOut .55s ease forwards',
      ].join(';');

      if (!document.getElementById('flash-kf')) {
        const st = document.createElement('style');
        st.id = 'flash-kf';
        st.textContent = '@keyframes flashOut{0%{opacity:1}100%{opacity:0}}';
        document.head.appendChild(st);
      }

      theater.appendChild(flash);

      S._currentCharImg = P.charImg;
      S._currentResultImg = currentCard;
      S._currentStepStyle = 'fusion';

      syncCanvasSize();
      renderFrame(0);

      bgCharWrap.classList.remove('show');
      canvas.classList.add('visible');
      startPokeSwirlLoop(() => {
        setTimeout(() => flash.remove(), 400);
        fly2.style.animation = '';
        fly2.style.opacity = '0';
        fly2.style.zIndex = '';
        fly2.style.transition = '';

        revealSinglePokeCardStep(currentCard, stepIdx, () => {
          startPokeStepSequence(stepIdx + 1);
        });
      });

      const baseTr = (currentDir === 'left' || currentDir === 'right') ? 'translateY(-50%)' : 'translateX(-50%)';
      let st = document.getElementById('fusion-absorb-kf');
      if (!st) {
        st = document.createElement('style');
        st.id = 'fusion-absorb-kf';
        document.head.appendChild(st);
      }
      st.textContent = `
        @keyframes fusionAbsorb {
          0%   { opacity: 1;   transform: ${baseTr} scale(1)    rotate(0deg);   filter: blur(0px); }
          30%  { opacity: 0.95; transform: ${baseTr} scale(1.1)  rotate(240deg); filter: blur(0px); }
          100% { opacity: 0;   transform: ${baseTr} scale(0.05) rotate(720deg); filter: blur(8px); }
        }
      `;

      fly2.style.zIndex = '15';
      fly2.style.transition = 'none';
      fly2.style.animation = 'fusionAbsorb 0.7s cubic-bezier(.4,0,.2,1) forwards';

      setTimeout(() => {
        fly2.style.animation = '';
        fly2.style.opacity = '0';
        fly2.style.zIndex = '';
        fly2.style.transition = '';
      }, 710);

      setTimeout(() => flash.remove(), 580);
    };

    if (currentDir === 'bottom') {
      setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', bottom: '-60%' });
      animateDir(fly2, 'bottom', -60, 38, 750, () => setTimeout(doPokeCollisionFlash, 150));
    } else if (currentDir === 'top') {
      setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', top: '-60%' });
      animateDir(fly2, 'top', -60, 38, 750, () => setTimeout(doPokeCollisionFlash, 150));
    } else if (currentDir === 'left') {
      setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', left: '-60%' });
      animateDir(fly2, 'left', -60, 22.5, 750, () => setTimeout(doPokeCollisionFlash, 150));
    } else if (currentDir === 'right') {
      setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', right: '-60%' });
      animateDir(fly2, 'right', -60, 22.5, 750, () => setTimeout(doPokeCollisionFlash, 150));
    }
  }, initialDelay);
}

function startPokeSwirlLoop(onDone) {
  S.time = 0;
  let elapsed = 0;
  const totalMs = 1000; // 1.0s fast swirl fusion
  const speed = 5.0;    // Dynamic spin speed

  function loop() {
    if (!P.running) return;
    const progress = Math.min(1, elapsed / totalMs);
    renderFrame(progress);
    S.time += speed * 0.14;
    elapsed += 16 * (speed / 3.5);
    if (elapsed < totalMs) {
      S.animId = requestAnimationFrame(loop);
    } else {
      onDone();
    }
  }
  S.animId = requestAnimationFrame(loop);
}

function revealSinglePokeCardStep(cardImgObj, stepIdx = 0, onNext) {
  canvas.classList.remove('visible');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Hide background character image to reveal clean grid background
  bgCharWrap.classList.remove('show', 'zoom-in');

  const pokeOverlay = document.getElementById('poke-card-overlay');
  const pokeShell = document.getElementById('poke-card-shell');
  const artImg = document.getElementById('poke-card-art-img');
  const questionDisp = document.getElementById('poke-card-question-display');

  if (questionDisp) questionDisp.classList.remove('show');
  if (pokeShell) pokeShell.classList.remove('shrink-hide');

  if (artImg) artImg.src = cardImgObj.src;

  playSfxReveal();
  if (pokeOverlay) pokeOverlay.classList.add('show');

  // Pause on single card for 4.0 seconds (extended preview), then shrink card to center & fade out
  setTimeout(() => {
    if (!P.running) return;

    if (pokeShell) pokeShell.classList.add('shrink-hide');

    setTimeout(() => {
      if (pokeOverlay) pokeOverlay.classList.remove('show');
      if (pokeShell) pokeShell.classList.remove('shrink-hide');
      onNext();
    }, 600);
  }, 4000);
}

/* ─────────────────────── POKEMON CARD FAN-OUT END SCREEN ─────────────────────── */
function showPokeCardFanOutScreen() {
  const pokeFanOverlay = document.getElementById('poke-fan-screen-overlay');
  const cardsContainer = document.getElementById('poke-fan-cards-container');
  const questionDisp = document.getElementById('poke-fan-question-display');
  if (!pokeFanOverlay || !cardsContainer) return;

  cardsContainer.innerHTML = '';
  if (questionDisp) questionDisp.classList.remove('show');

  const total = P.cardImages.length;
  // Calculate fan angles & horizontal offsets
  // Example for N cards: spread angles from -25deg to +25deg
  const startAngle = total > 1 ? -22 : 0;
  const angleStep = total > 1 ? (44 / (total - 1)) : 0;
  const startX = total > 1 ? -60 : 0;
  const xStep = total > 1 ? (120 / (total - 1)) : 0;

  P.cardImages.forEach((cImg, idx) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'fan-card-item';
    cardEl.style.zIndex = idx + 1;

    const img = document.createElement('img');
    img.src = cImg.src;
    img.alt = `Card Fan ${idx + 1}`;
    cardEl.appendChild(img);

    cardsContainer.appendChild(cardEl);

    // Apply fan out transform after DOM append
    const rot = startAngle + idx * angleStep;
    const tx = startX + idx * xStep;
    const ty = (total > 1) ? Math.abs(idx - (total - 1) / 2) * 8 : 0;

    setTimeout(() => {
      cardEl.style.transform = `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg)`;
    }, 100 + idx * 120);
  });

  // Set question box text
  const questionRaw = document.getElementById('poke-question-input')?.value || 'HOW MUCH POWER DOES THIS POKEMON CARD DESERVE?\nLET ME KNOW IN THE COMMENTS!';
  if (questionDisp) {
    const lines = questionRaw.split('\n').map(l => l.trim().toUpperCase()).filter(l => l.length > 0);
    questionDisp.innerHTML = lines.join('<br/>');
  }

  playSfxReveal();
  pokeFanOverlay.classList.add('show');

  // Reveal interactive question box 2 seconds after card fan out display
  setTimeout(() => {
    if (questionDisp) {
      questionDisp.classList.add('show');
      playSfxBadgePop(0);
    }
    P.running = false;
  }, 2000);
}

/* ─────────────────────── BATTLE SOLO MODULE ─────────────────────── */
const B = {
  jesus1Img: null,   // Jesus 1 (Hands down)
  jesus2Img: null,   // Jesus 2 (Hand raised)
  jesus3Img: null,   // Jesus 3 (Victory)
  victoryBgImg: null,// Victory Background Scene
  slashImg: null,    // Slash PNG FX
  opponents: [],     // Array of Image objects
  scenes: [],        // Array of Image objects
  oppNames: [],      // Array of Opponent Name strings
  running: false,
  timer: null,
  stepIdx: 0
};

function pickBattleFile(type) {
  const el = document.getElementById(`file-${type}`);
  if (el) el.click();
}

function clearBattleSlot(type) {
  if (type === 'jesus-1') B.jesus1Img = null;
  else if (type === 'jesus-2') B.jesus2Img = null;
  else if (type === 'jesus-3') B.jesus3Img = null;
  else if (type === 'victory-bg') B.victoryBgImg = null;
  else if (type === 'slash-fx') B.slashImg = null;

  const fileInput = document.getElementById(`file-${type}`);
  if (fileInput) fileInput.value = '';
  const body = document.getElementById(`body-${type}`);
  const prev = document.getElementById(`prev-${type}`);
  if (body) body.style.display = 'flex';
  if (prev) prev.style.display = 'none';
}

function initBattleModule() {
  // Bind Jesus, Victory BG & Slash file inputs
  ['jesus-1', 'jesus-2', 'jesus-3', 'victory-bg', 'slash-fx'].forEach(type => {
    const input = document.getElementById(`file-${type}`);
    if (!input) return;
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          if (type === 'jesus-1') B.jesus1Img = img;
          else if (type === 'jesus-2') B.jesus2Img = img;
          else if (type === 'jesus-3') B.jesus3Img = img;
          else if (type === 'victory-bg') B.victoryBgImg = img;
          else if (type === 'slash-fx') B.slashImg = img;

          const pimg = document.getElementById(`pimg-${type}`);
          const body = document.getElementById(`body-${type}`);
          const prev = document.getElementById(`prev-${type}`);
          if (pimg) pimg.src = img.src;
          if (body) body.style.display = 'none';
          if (prev) prev.style.display = 'block';
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
  });

  // Bind Add Buttons
  const btnOpp = document.getElementById('battle-add-opponents');
  if (btnOpp) btnOpp.onclick = () => document.getElementById('battle-opponents-input')?.click();
  const btnScene = document.getElementById('battle-add-scenes');
  if (btnScene) btnScene.onclick = () => document.getElementById('battle-scenes-input')?.click();

  // Multi file inputs
  const oppInput = document.getElementById('battle-opponents-input');
  if (oppInput) {
    oppInput.addEventListener('change', e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      let loaded = 0;
      files.forEach(f => {
        const r = new FileReader();
        r.onload = ev => {
          const img = new Image();
          img.onload = () => {
            B.opponents.push(img);
            loaded++;
            if (loaded === files.length) renderBattleTable();
          };
          img.src = ev.target.result;
        };
        r.readAsDataURL(f);
      });
      oppInput.value = '';
    });
  }

  const sceneInput = document.getElementById('battle-scenes-input');
  if (sceneInput) {
    sceneInput.addEventListener('change', e => {
      const files = Array.from(e.target.files);
      if (!files.length) return;
      let loaded = 0;
      files.forEach(f => {
        const r = new FileReader();
        r.onload = ev => {
          const img = new Image();
          img.onload = () => {
            B.scenes.push(img);
            loaded++;
            if (loaded === files.length) renderBattleTable();
          };
          img.src = ev.target.result;
        };
        r.readAsDataURL(f);
      });
      sceneInput.value = '';
    });
  }

  renderBattleTable();
}

function renderBattleTable() {
  const tbody = document.getElementById('battle-table-body');
  const countEl = document.getElementById('battle-steps-count');
  if (!tbody) return;

  const total = Math.max(B.opponents.length, B.scenes.length);
  if (countEl) countEl.textContent = total > 0 ? `(${total} đối thủ)` : '';
  tbody.innerHTML = '';

  if (total === 0) {
    tbody.innerHTML = `
      <div class="bt-empty-state" style="padding: 16px; text-align: center; color: var(--text-dim); font-size: 0.82rem;">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size: 1.4rem; display: block; margin-bottom: 6px;"></i>
        <span>Tải lên các đối thủ & nền cảnh tương ứng để bắt đầu battle!</span>
      </div>
    `;
    return;
  }

  for (let i = 0; i < total; i++) {
    const oppImgObj = B.opponents[i];
    const sceneImgObj = B.scenes[i];

    const row = document.createElement('div');
    row.className = 'bt-row';

    // Col 1: Opponent Image
    const colOpp = document.createElement('div');
    colOpp.className = 'bt-col bt-col-monster';
    if (oppImgObj) {
      const wrap = document.createElement('div');
      wrap.className = 'bt-img-wrap';
      const img = document.createElement('img');
      img.src = oppImgObj.src;
      const badge = document.createElement('div');
      badge.className = 'bt-img-badge';
      badge.textContent = `VS #${i + 1}`;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.type = 'button';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.onclick = e => {
        e.stopPropagation();
        B.opponents.splice(i, 1);
        B.oppNames.splice(i, 1);
        renderBattleTable();
      };
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      colOpp.appendChild(wrap);
      attachColDrag(wrap, 'battle-opp', i, colOpp, B.opponents, renderBattleTable);
    } else {
      colOpp.innerHTML = `
        <div class="bt-slot-empty" onclick="document.getElementById('battle-opponents-input').click()">
          <i class="fa-solid fa-plus"></i><span>Đối thủ ${i + 1}</span>
        </div>
      `;
      attachCellDropTarget(colOpp, 'battle-opp', i, B.opponents, renderBattleTable);
    }

    // Col 2: Opponent Name Input Field
    const colFx = document.createElement('div');
    colFx.className = 'bt-col bt-col-fx';
    colFx.style.padding = '0 4px';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'ctrl-input';
    nameInput.style.cssText = 'font-size:0.72rem; padding:4px 6px; text-align:center; font-weight:700; width:100%;';
    nameInput.placeholder = `Đối thủ ${i + 1}`;
    nameInput.value = B.oppNames[i] || '';
    nameInput.oninput = (e) => { B.oppNames[i] = e.target.value; };
    colFx.appendChild(nameInput);

    // Col 3: Background Scene Image
    const colScene = document.createElement('div');
    colScene.className = 'bt-col bt-col-card';
    if (sceneImgObj) {
      const wrap = document.createElement('div');
      wrap.className = 'bt-img-wrap';
      const img = document.createElement('img');
      img.src = sceneImgObj.src;
      const badge = document.createElement('div');
      badge.className = 'bt-img-badge';
      badge.textContent = `Cảnh #${i + 1}`;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.type = 'button';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.onclick = e => {
        e.stopPropagation();
        B.scenes.splice(i, 1);
        renderBattleTable();
      };
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      colScene.appendChild(wrap);
      attachColDrag(wrap, 'battle-scene', i, colScene, B.scenes, renderBattleTable);
    } else {
      colScene.innerHTML = `
        <div class="bt-slot-empty" onclick="document.getElementById('battle-scenes-input').click()">
          <i class="fa-solid fa-plus"></i><span>Nền cảnh ${i + 1}</span>
        </div>
      `;
      attachCellDropTarget(colScene, 'battle-scene', i, B.scenes, renderBattleTable);
    }

    row.appendChild(colOpp);
    row.appendChild(colFx);
    row.appendChild(colScene);
    tbody.appendChild(row);
  }
}

function runBattleSolo() {
  const total = Math.min(B.opponents.length, B.scenes.length);
  if (!B.jesus1Img || !B.jesus2Img || !B.jesus3Img) {
    toast('Vui lòng tải đủ 3 trạng thái của nhân vật chính (1. Hạ tay, 2. Vung tay, 3. Thắng)! ⚔️');
    return;
  }
  if (total === 0) {
    toast('Vui lòng tải lên ít nhất 1 cặp (Đối thủ + Nền cảnh)! ⚡');
    return;
  }
  if (B.running) return;
  B.running = true;

  enterRecordingMode();

  const battleOverlay = document.getElementById('battle-theater-overlay');
  if (battleOverlay) battleOverlay.classList.add('show');
  const victoryOverlay = document.getElementById('battle-victory-overlay');
  if (victoryOverlay) victoryOverlay.classList.remove('show');

  const jesusWrap = document.getElementById('battle-jesus-wrap');
  if (jesusWrap) jesusWrap.style.display = 'flex';
  const healthUi = document.getElementById('battle-health-ui');
  if (healthUi) healthUi.style.display = 'flex';

  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) emojiHeaderBar.classList.add('hidden');

  B.stepIdx = 0;
  startBattleStepSequence(0);
}

function startBattleStepSequence(stepIdx) {
  const total = Math.min(B.opponents.length, B.scenes.length);
  if (stepIdx >= total) {
    // All opponents defeated! Show Victory screen!
    showBattleVictoryScreen();
    return;
  }

  B.stepIdx = stepIdx;
  const currentOpp = B.opponents[stepIdx];
  const currentScene = B.scenes[stepIdx];

  const bgImg = document.getElementById('battle-bg-img');
  const bgWrap = document.getElementById('battle-bg-wrap');
  const oppImg = document.getElementById('battle-opponent-img');
  const oppWrap = document.getElementById('battle-opponent-wrap');
  const jesusImg = document.getElementById('battle-jesus-img');
  const jesusWrap = document.getElementById('battle-jesus-wrap');
  const slashWrap = document.getElementById('battle-slash-wrap');
  const slashImg = document.getElementById('battle-slash-img');
  const monsterHpBar = document.getElementById('monster-hp-bar');
  const jesusHpBar = document.getElementById('jesus-hp-bar');

  // Update Health Bar Names dynamically from user inputs
  const heroName = document.getElementById('battle-hero-name')?.value?.trim() || 'JESUS';
  const jesusHpName = document.getElementById('battle-jesus-hp-name');
  if (jesusHpName) jesusHpName.textContent = heroName.toUpperCase();

  const rawOppName = B.oppNames[stepIdx];
  const oppName = (rawOppName && rawOppName.trim()) ? rawOppName.trim() : `MONSTER #${stepIdx + 1}`;
  const monsterHpName = document.getElementById('battle-monster-hp-name');
  if (monsterHpName) monsterHpName.textContent = oppName.toUpperCase();

  // Reset states
  if (bgImg && currentScene) bgImg.src = currentScene.src;
  if (bgWrap) bgWrap.classList.remove('grayscale');

  if (oppImg && currentOpp) oppImg.src = currentOpp.src;
  if (oppWrap) {
    oppWrap.classList.remove('grayscale', 'hit', 'slide-in');
    void oppWrap.offsetWidth; // force reflow
    oppWrap.classList.add('slide-in');
  }

  if (jesusImg) jesusImg.src = B.jesus1Img.src;
  if (jesusWrap) jesusWrap.classList.remove('attack');

  if (slashWrap) slashWrap.classList.remove('show');
  if (slashImg) {
    if (B.slashImg) {
      slashImg.src = B.slashImg.src;
    } else {
      slashImg.src = 'mong-vuot.png';
    }
  }

  if (monsterHpBar) monsterHpBar.style.width = '100%';
  if (jesusHpBar) jesusHpBar.style.width = '100%';

  // Step delay: Wait 2.0s after opponent slide in before hero attacks
  B.timer = setTimeout(() => {
    if (!B.running) return;

    // 1. Hero switches to Image 2 (Hand raised / vung tay) & attacks
    if (jesusImg) jesusImg.src = B.jesus2Img.src;
    if (jesusWrap) jesusWrap.classList.add('attack');

    // 2. Show Slash FX PNG over opponent
    if (slashWrap) {
      slashWrap.classList.add('show');
      playSfxSlash();
    }

    // 3. After 220ms: Opponent turns GRAYSCALE + Monster HP drops to 0!
    setTimeout(() => {
      if (!B.running) return;

      if (oppWrap) oppWrap.classList.add('grayscale', 'hit');
      if (bgWrap) bgWrap.classList.add('grayscale');
      if (monsterHpBar) monsterHpBar.style.width = '0%';

      // Hide slash FX and remove attack class so sway animation resumes
      setTimeout(() => {
        if (slashWrap) slashWrap.classList.remove('show');
        if (jesusWrap) jesusWrap.classList.remove('attack');
      }, 450);

      // Pause extended duration while opponent is defeated, then move to next opponent
      const stepDurationSec = parseFloat(document.getElementById('battle-step-sec')?.value || 4.0);
      B.timer = setTimeout(() => {
        if (!B.running) return;
        startBattleStepSequence(stepIdx + 1);
      }, stepDurationSec * 1000);
    }, 220);

  }, 2000);
}

function showBattleVictoryScreen() {
  const victoryOverlay = document.getElementById('battle-victory-overlay');
  const victoryImg = document.getElementById('battle-victory-img');
  const victoryBgImg = document.getElementById('battle-victory-bg-img');
  const jesusWrap = document.getElementById('battle-jesus-wrap');
  const slashWrap = document.getElementById('battle-slash-wrap');
  const healthUi = document.getElementById('battle-health-ui');

  if (healthUi) healthUi.style.display = 'none';
  if (jesusWrap) jesusWrap.style.display = 'none';
  if (slashWrap) slashWrap.classList.remove('show');

  // Set Victory Main Character image (Jesus 3)
  if (victoryImg && B.jesus3Img) {
    victoryImg.src = B.jesus3Img.src;
  }

  // Set Victory Background Scene image (custom victory bg or fallback to last scene image)
  if (victoryBgImg && B.victoryBgImg) {
    victoryBgImg.src = B.victoryBgImg.src;
  } else if (victoryBgImg && B.scenes.length > 0) {
    victoryBgImg.src = B.scenes[B.scenes.length - 1].src;
  }

  if (victoryOverlay) {
    victoryOverlay.classList.add('show');
    playSfxReveal();
  }
  B.running = false;
}

function resetBattleSolo() {
  if (B.timer) {
    clearTimeout(B.timer);
    B.timer = null;
  }
  B.running = false;

  const battleOverlay = document.getElementById('battle-theater-overlay');
  if (battleOverlay) battleOverlay.classList.remove('show');
  const victoryOverlay = document.getElementById('battle-victory-overlay');
  if (victoryOverlay) victoryOverlay.classList.remove('show');

  const jesusWrap = document.getElementById('battle-jesus-wrap');
  if (jesusWrap) jesusWrap.style.display = 'flex';
  const healthUi = document.getElementById('battle-health-ui');
  if (healthUi) healthUi.style.display = 'flex';

  exitRecordingMode();
}

function playSfxSlash() {
  if (!document.getElementById('battle-sound-enable')?.checked) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.18);
  } catch (e) {}
}

/* ─────────────────────── INIT ─────────────────────── */
initBattleModule();


