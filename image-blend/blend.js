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
    badgeType = badgeTypeSelect?.value || 'none';
  }

  if (badgeType === 'none') {
    return '';
  } else if (badgeType === 'actions') {
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
    badgeType = badgeTypeSelect?.value || 'none';
  }

  if (badgeType === 'none') {
    return '';
  } else if (badgeType === 'actions') {
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
  const bar = document.getElementById('emoji-header-bar');
  const inner = document.getElementById('emoji-header-inner') || emojiHeaderEl;
  if (!inner) return;

  let uploaded = [];
  if (activeTab === 'pokemon') {
    uploaded = (typeof P !== 'undefined' && P.monsterImages ? P.monsterImages : [])
      .map((img, i) => ({ idx: i, img }))
      .filter(s => s.img && s.img.src);
  } else if (activeTab === 'blendplus') {
    uploaded = (typeof BP !== 'undefined' && BP.streams ? BP.streams : [])
      .map((s, i) => ({ idx: i, img: s.emojiImg }))
      .filter(s => s.img && s.img.src);
  } else {
    uploaded = (typeof S !== 'undefined' && S.steps ? S.steps : [])
      .map((s, i) => ({ idx: i, img: s.emojiImg }))
      .filter(s => s.img && s.img.src);
  }

  if (uploaded.length === 0) {
    inner.innerHTML = '';
    const ph = document.createElement('span');
    ph.className = 'emoji-header-placeholder';
    ph.id = 'emoji-header-placeholder';
    ph.textContent = activeTab === 'pokemon' ? 'Pokemon sẽ hiển thị ở đây sau khi tải lên ✨' : 'Emoji sẽ hiển thị ở đây sau khi tải lên ✨';
    inner.appendChild(ph);
    return;
  }

  inner.innerHTML = '';
  // Dynamic sizing when there are many items so they all display nicely
  const itemCount = uploaded.length;
  let itemSize = 74;
  if (itemCount > 4) {
    itemSize = Math.max(48, Math.floor(320 / itemCount));
  }

  uploaded.forEach(({ idx, img }) => {
    const item = document.createElement('div');
    item.className = 'emoji-header-item';
    item.id = `emoji-header-item-${idx}`;

    const badgeContent = activeTab === 'blendplus' ? '' : getHeaderBadgeHTML(idx);
    if (badgeContent) {
      const badge = document.createElement('span');
      badge.className = 'step-num-badge';
      badge.innerHTML = badgeContent;
      item.appendChild(badge);
    }

    const imgEl = document.createElement('img');
    imgEl.src = img.src;
    imgEl.alt = `Emoji bước ${idx + 1}`;

    item.appendChild(imgEl);
    inner.appendChild(item);
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
    badgeType: document.getElementById('badge-type-select')?.value || 'none',
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
    emojiHeaderBar.style.display = '';
    if (activeTab === 'battle' || activeTab === 'flashlight' || activeTab === 'puzzle') {
      emojiHeaderBar.classList.add('hidden');
    } else {
      emojiHeaderBar.classList.remove('hidden');
    }
  }

  const btnBlend = document.getElementById('btn-blend');
  if (btnBlend) btnBlend.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Bắt đầu Blend';
  const btnBpBlend = document.getElementById('btn-bp-blend');
  if (btnBpBlend) btnBpBlend.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Bắt đầu Blend +';
  const btnDl = document.getElementById('btn-dl');
  if (btnDl) btnDl.style.display = 'none';

  // Reset Blend+ running & timer state
  if (typeof BP !== 'undefined') {
    if (BP.timer) { clearTimeout(BP.timer); BP.timer = null; }
    BP.running = false;
    document.querySelectorAll('.bp-stream-row').forEach(el => {
      el.classList.remove('active-blend', 'done-blend');
    });
  }

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
  const updateRecordingLayout = () => {
    if (!document.body.classList.contains('recording-mode')) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const is1to1 = document.body.classList.contains('climax-active-mode');

    if (is1to1) {
      // 1:1 Square Theater in rotated Landscape Mode
      // When rotated -90deg, natural size is S x S where S = min(vw, vh)
      // Scale down slightly (0.96) to ensure 100% full view without top/bottom cropping
      const side = Math.min(vw, vh);
      const scale = (side / theater.offsetHeight) * 0.96;
      theater.style.transform = `rotate(-90deg) scale(${scale})`;
    } else {
      // 9:16 Portrait Theater in rotated Landscape Mode
      const theaterH = vh;
      const scale = vw / theaterH;
      theater.style.transform = `rotate(-90deg) scale(${scale})`;
    }
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
  if (badgeType === 'none') {
    badgeLabels = [];
  } else if (badgeType === 'actions') {
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
    item.appendChild(img);

    if (badgeType !== 'none') {
      const badge = document.createElement('div');
      // Standardized: Emoji on top, Badge type on bottom for all options
      badge.className = `final-item-badge badge-bottom badge-color-${idx % 4}`;
      badge.innerHTML = badgeLabels[idx] || `Option ${idx + 1}`;
      item.appendChild(badge);
    }

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

  // Result Badge ẩn khi xuất hiện kết quả (theo yêu cầu người dùng)
  const resultBadge = document.getElementById('result-badge');
  if (resultBadge) {
    resultBadge.innerHTML = '';
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
  bgStyle: 'solid-red', // Default Background Color Style
  opponents: [],     // Array of Image objects
  scenes: [],        // Array of Image objects
  oppNames: [],      // Array of Opponent Name strings
  running: false,
  timer: null,
  stepIdx: 0
};

function updateBattleBgStyle(styleVal) {
  B.bgStyle = styleVal;
  const sel1 = document.getElementById('battle-bg-style-select');
  const sel2 = document.getElementById('right-battle-bg-style-select');
  if (sel1) sel1.value = styleVal;
  if (sel2) sel2.value = styleVal;
  renderBattleTable();
}

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

  const total = B.opponents.length;
  if (countEl) countEl.textContent = total > 0 ? `(${total} đối thủ)` : '';
  tbody.innerHTML = '';

  if (total === 0) {
    tbody.innerHTML = `
      <div class="bt-empty-state" style="padding: 16px; text-align: center; color: var(--text-dim); font-size: 0.82rem;">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size: 1.4rem; display: block; margin-bottom: 6px;"></i>
        <span>Tải lên các đối thủ để bắt đầu battle! (Nền cảnh tùy chọn, nếu thiếu sẽ tự động dùng Màu Nền)</span>
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

    // Col 3: Background Scene Image (or Default Color Fallback Slot)
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
        <div class="bt-slot-empty color-fallback" onclick="document.getElementById('battle-scenes-input').click()" title="Đang dùng Màu Nền (Bấm để chọn ảnh nền riêng)">
          <i class="fa-solid fa-palette"></i><span>Dùng Màu Nền</span>
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
  const total = B.opponents.length;
  if (!B.jesus1Img || !B.jesus2Img || !B.jesus3Img) {
    toast('Vui lòng tải đủ 3 trạng thái của nhân vật chính (1. Hạ tay, 2. Vung tay, 3. Thắng)! ⚔️');
    return;
  }
  if (total === 0) {
    toast('Vui lòng tải lên ít nhất 1 đối thủ! ⚡');
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
  const total = B.opponents.length;
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

  // Reset states & Apply Background Scene Image OR Selected Background Color
  if (bgWrap) {
    if (currentScene) {
      bgWrap.style.background = 'none';
      if (bgImg) {
        bgImg.src = currentScene.src;
        bgImg.style.display = 'block';
      }
    } else {
      if (bgImg) bgImg.style.display = 'none';
      bgWrap.className = 'battle-bg-wrap ' + (B.bgStyle || 'solid-red');
    }
    bgWrap.classList.remove('grayscale');
  }

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
  const victoryBgWrap = document.getElementById('battle-victory-bg-wrap');
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

  // Set Victory Background Scene image OR Background Color Style
  if (B.victoryBgImg) {
    if (victoryBgWrap) victoryBgWrap.style.background = 'none';
    if (victoryBgImg) {
      victoryBgImg.src = B.victoryBgImg.src;
      victoryBgImg.style.display = 'block';
    }
  } else if (B.scenes.length > 0 && B.scenes[B.scenes.length - 1]) {
    if (victoryBgWrap) victoryBgWrap.style.background = 'none';
    if (victoryBgImg) {
      victoryBgImg.src = B.scenes[B.scenes.length - 1].src;
      victoryBgImg.style.display = 'block';
    }
  } else {
    if (victoryBgImg) victoryBgImg.style.display = 'none';
    if (victoryBgWrap) victoryBgWrap.className = 'battle-victory-bg-wrap ' + (B.bgStyle || 'solid-red');
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

/* ─────────────────────────────────────────────────────────────
   TAB 4: PUZZLE GAME MODULE  (powered by headbreaker)
   ───────────────────────────────────────────────────────────── */
const PUZZLE = {
  mainImg:        null,
  activeVariantIdx: null,   // which top variant is in the center hole
  hbCanvas:       null,     // headbreaker Canvas instance
  centerImgEl:    null,     // plain <img> of the center tile (for variants)
  boardSize:      340,      // px — headbreaker canvas size
};

// ── Init file listener ────────────────────────────────────────
(function initPuzzleModule() {
  const input = document.getElementById('file-puzzle-main');
  if (input) {
    input.addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const img = new Image();
        img.onload = () => {
          PUZZLE.mainImg = img;
          updatePuzzleSlotPreview(ev.target.result);
          renderPuzzleGame();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
  }
})();

function updatePuzzleSlotPreview(src) {
  const body = document.getElementById('body-puzzle-main');
  const prev = document.getElementById('prev-puzzle-main');
  const pimg = document.getElementById('pimg-puzzle-main');
  if (body) body.style.display = 'none';
  if (prev) prev.style.display = 'block';
  if (pimg) pimg.src = src;
}

function clearPuzzleSlot() {
  PUZZLE.mainImg = null;
  PUZZLE.activeVariantIdx = null;
  if (PUZZLE.hbCanvas) { try { PUZZLE.hbCanvas.destroy(); } catch(e){} PUZZLE.hbCanvas = null; }
  const body = document.getElementById('body-puzzle-main');
  const prev = document.getElementById('prev-puzzle-main');
  const pimg = document.getElementById('pimg-puzzle-main');
  if (body) body.style.display = 'flex';
  if (prev) prev.style.display = 'none';
  if (pimg) pimg.src = '';
  renderPuzzleGame();
}

// ── Main render ───────────────────────────────────────────────
function renderPuzzleGame() {
  const puzzleOverlay = document.getElementById('puzzle-theater-overlay');
  if (puzzleOverlay) puzzleOverlay.classList.add('show');

  const topRow = document.getElementById('puzzle-top-row');
  const boardContainer = document.getElementById('custom-puzzle-board');
  if (!topRow || !boardContainer) return;

  topRow.innerHTML = '';
  boardContainer.innerHTML = '';

  if (!PUZZLE.mainImg) {
    boardContainer.innerHTML = '<div style="color:#94a3b8;font-size:0.9rem;text-align:center;padding:60px 10px;grid-column:span 3;">Vui lòng tải 1 hình ảnh ở cột bên trái để bắt đầu Game Xếp Hình 🧩</div>';
    return;
  }

  // ── Prepare source image cropped to square ────────────────────
  const src = PUZZLE.mainImg;
  const BS = 360; // 360x360 board pixel canvas size
  const srcW = src.naturalWidth  || src.width  || 360;
  const srcH = src.naturalHeight || src.height || 360;
  const cropSize = Math.min(srcW, srcH);
  const sx = (srcW - cropSize) / 2;
  const sy = (srcH - cropSize) / 2;

  // Offscreen master canvas (360x360)
  const masterCvs = document.createElement('canvas');
  masterCvs.width  = BS;
  masterCvs.height = BS;
  const mCtx = masterCvs.getContext('2d');
  mCtx.drawImage(src, sx, sy, cropSize, cropSize, 0, 0, BS, BS);
  PUZZLE.masterCvs = masterCvs;

  // Render 3x3 custom puzzle board
  buildCustomPuzzleBoard(boardContainer, masterCvs);

  // Render 3 top-row variant cards
  buildTopVariants(masterCvs);
}

// ── Draw non-square custom tile shape path ────────────────────
function drawCustomTilePath(ctx, w, h) {
  const shape = document.getElementById('puzzle-shape-select')?.value || 'notched';

  if (shape === 'heart') {
    const cx = w / 2;
    const topY = h * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.bezierCurveTo(cx - w * 0.45, topY - h * 0.32, cx - w * 0.55, topY + h * 0.4, cx, h - 2);
    ctx.bezierCurveTo(cx + w * 0.55, topY + h * 0.4, cx + w * 0.45, topY - h * 0.32, cx, topY);
    ctx.closePath();
  } else if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(w, h) / 2 - 2, 0, Math.PI * 2);
    ctx.closePath();
  } else if (shape === 'trapezoid') {
    const inset = 16;
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(inset + r, 4);
    ctx.lineTo(w - inset - r, 4);
    ctx.quadraticCurveTo(w - inset, 4, w - inset + r / 2, 4 + r);
    ctx.lineTo(w - 4, h - 4 - r);
    ctx.quadraticCurveTo(w - 4, h - 4, w - 4 - r, h - 4);
    ctx.lineTo(4 + r, h - 4);
    ctx.quadraticCurveTo(4, h - 4, 4, h - 4 - r);
    ctx.lineTo(inset - r / 2, 4 + r);
    ctx.quadraticCurveTo(inset, 4, inset + r, 4);
    ctx.closePath();
  } else if (shape === 'hexagon') {
    const cx = w / 2, cy = h / 2, rad = Math.min(w, h) / 2 - 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      const x = cx + rad * Math.cos(angle);
      const y = cy + rad * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (shape === 'diamond') {
    const cx = w / 2, cy = h / 2;
    ctx.beginPath();
    ctx.moveTo(cx, 4);
    ctx.lineTo(w - 4, cy);
    ctx.lineTo(cx, h - 4);
    ctx.lineTo(4, cy);
    ctx.closePath();
  } else if (shape === 'squircle') {
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(4 + r, 4);
    ctx.lineTo(w - 4 - r, 4);
    ctx.quadraticCurveTo(w - 4, 4, w - 4, 4 + r);
    ctx.lineTo(w - 4, h - 4 - r);
    ctx.quadraticCurveTo(w - 4, h - 4, w - 4 - r, h - 4);
    ctx.lineTo(4 + r, h - 4);
    ctx.quadraticCurveTo(4, h - 4, 4, h - 4 - r);
    ctx.lineTo(4, 4 + r);
    ctx.quadraticCurveTo(4, 4, 4 + r, 4);
    ctx.closePath();
  } else {
    // Default notched shield
    const r = 14;      // Corner rounding radius
    const indent = 10; // Notched side inset
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w - indent, r);
    ctx.lineTo(w, h / 2 - 8);
    ctx.bezierCurveTo(w + 5, h / 2, w + 5, h / 2, w, h / 2 + 8);
    ctx.lineTo(w - indent, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, indent, h - r);
    ctx.lineTo(0, h / 2 + 8);
    ctx.bezierCurveTo(-5, h / 2, -5, h / 2, 0, h / 2 - 8);
    ctx.lineTo(indent, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
  }
}

function renderClippedTileCanvas(sourceCvs, srcX, srcY, srcSize, targetSize, hexColor = null) {
  const cvs = document.createElement('canvas');
  cvs.width  = targetSize;
  cvs.height = targetSize;
  const ctx  = cvs.getContext('2d');

  ctx.save();
  // Clip to custom non-square shape
  drawCustomTilePath(ctx, targetSize, targetSize);
  ctx.clip();

  // Draw corresponding slice of source image
  ctx.drawImage(sourceCvs, srcX, srcY, srcSize, srcSize, 0, 0, targetSize, targetSize);

  // Optional color tint overlay
  if (hexColor !== null) {
    applyVariantTint(ctx, cvs, hexColor);
  }

  // Draw smooth border outline along the custom shape
  ctx.restore();
  ctx.save();
  drawCustomTilePath(ctx, targetSize, targetSize);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth   = 2.5;
  ctx.stroke();
  ctx.restore();

  return cvs;
}

// ── Build 3x3 Puzzle Board ────────────────────────────────────
function buildCustomPuzzleBoard(container, masterCvs) {
  container.innerHTML = '';
  const BS = 360;
  const tileSize = 120; // 360 / 3
  const displayTileSize = 110;

  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const idx = row * 3 + col;
      const cell = document.createElement('div');
      cell.className = 'puzzle-tile-cell';
      cell.dataset.index = idx;

      if (idx === 4) {
        // Center cell (index 4) — missing slot / drop zone
        buildCenterSlotCell(cell, masterCvs, tileSize, displayTileSize);
      } else {
        // Surrounding 8 tiles
        const tileCvs = renderClippedTileCanvas(masterCvs, col * tileSize, row * tileSize, tileSize, displayTileSize);
        tileCvs.className = 'puzzle-tile-canvas';
        cell.appendChild(tileCvs);
      }

      container.appendChild(cell);
    }
  }
}

function buildCenterSlotCell(cell, masterCvs, tileSize, displayTileSize) {
  cell.id = 'puzzle-center-slot';
  const isFilled = (PUZZLE.activeVariantIdx !== null);
  const shape = document.getElementById('puzzle-shape-select')?.value || 'notched';
  let dropRadius = '14px';
  if (shape === 'circle') dropRadius = '50%';
  else if (shape === 'hexagon') dropRadius = '22%';
  else if (shape === 'heart') dropRadius = '35% 35% 50% 50%';

  if (!isFilled) {
    cell.innerHTML = `
      <div id="puzzle-drop-zone" style="
        width: 100%;
        height: 100%;
        border: 2px dashed rgba(99,102,241,0.6);
        border-radius: ${dropRadius};
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.8rem;
        cursor: pointer;
        transition: all 0.2s ease;
      ">❓</div>
    `;
  } else {
    // Render filled center tile with selected variant color
    const rawColors = [
      document.getElementById('puzzle-color-1')?.value || '#22c55e',
      document.getElementById('puzzle-color-2')?.value || '#eab308',
      document.getElementById('puzzle-color-3')?.value || '#ec4899',
    ];
    const colorEnabled = [
      document.getElementById('puzzle-color-1-enable')?.checked !== false,
      document.getElementById('puzzle-color-2-enable')?.checked !== false,
      document.getElementById('puzzle-color-3-enable')?.checked !== false,
    ];
    const color = colorEnabled[PUZZLE.activeVariantIdx] ? rawColors[PUZZLE.activeVariantIdx] : null;

    cell.innerHTML = '';
    const tileCvs = renderClippedTileCanvas(masterCvs, 1 * tileSize, 1 * tileSize, tileSize, displayTileSize, color);
    tileCvs.className = 'puzzle-tile-canvas';
    tileCvs.style.cursor = 'pointer';
    cell.appendChild(tileCvs);
  }

  // Always accept drag & drop to replace current piece with new variant!
  cell.ondragover = e => e.preventDefault();
  cell.ondrop = e => {
    e.preventDefault();
    const vIdx = parseInt(e.dataTransfer.getData('text/plain'));
    if (!isNaN(vIdx)) swapCenterPuzzleVariant(vIdx);
  };
  cell.onclick = () => {
    const next = (PUZZLE.activeVariantIdx === null) ? 0 : (PUZZLE.activeVariantIdx + 1) % 3;
    swapCenterPuzzleVariant(next);
  };
}

// ── Top Row Variant Cards ─────────────────────────────────────
function buildTopVariants(masterCvs) {
  const topRow = document.getElementById('puzzle-top-row');
  if (!topRow || !masterCvs) return;
  topRow.innerHTML = '';

  const rawColors = [
    document.getElementById('puzzle-color-1')?.value || '#22c55e',
    document.getElementById('puzzle-color-2')?.value || '#eab308',
    document.getElementById('puzzle-color-3')?.value || '#ec4899',
  ];
  const colorEnabled = [
    document.getElementById('puzzle-color-1-enable')?.checked !== false,
    document.getElementById('puzzle-color-2-enable')?.checked !== false,
    document.getElementById('puzzle-color-3-enable')?.checked !== false,
  ];
  const colors = rawColors.map((c, i) => colorEnabled[i] ? c : null);
  const hearts = ['💚', '💛', '💗'];

  const tileSize = 120; // center is at (120, 120) in 360x360 canvas

  for (let i = 0; i < 3; i++) {
    const isActive = (PUZZLE.activeVariantIdx === i);
    const card = document.createElement('div');
    card.className = 'puzzle-variant-card' + (isActive ? ' active' : '');
    card.style.opacity = isActive ? '0.45' : '1';
    card.draggable = true;

    // Render center tile with variant tint
    const cvs = renderClippedTileCanvas(masterCvs, 1 * tileSize, 1 * tileSize, tileSize, 86, colors[i]);

    const wrap = document.createElement('div');
    wrap.className = 'puzzle-piece-canvas-wrap';
    wrap.appendChild(cvs);

    const badge = document.createElement('div');
    badge.className = 'puzzle-heart-badge';
    badge.textContent = hearts[i];

    card.appendChild(wrap);
    card.appendChild(badge);

    card.addEventListener('dragstart', e => {
      PUZZLE.draggedVariantIdx = i;
      e.dataTransfer.setData('text/plain', i);
    });
    card.addEventListener('click', () => {
      swapCenterPuzzleVariant(i);
    });

    topRow.appendChild(card);
  }
}

function applyVariantTint(ctx, cvs, hexColor) {
  if (!hexColor) return;

  ctx.save();
  // Blend mode 'color' changes hue while preserving 100% of light, shadow, and line details
  ctx.globalCompositeOperation = 'color';
  ctx.fillStyle = hexColor;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  // Soft overlay boost for rich vibrant tone without washing out contrast
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = hexColor;
  ctx.globalAlpha = 0.20;
  ctx.fillRect(0, 0, cvs.width, cvs.height);

  ctx.restore();
}

// ── Swap Center Puzzle Variant ────────────────────────────────
function swapCenterPuzzleVariant(newIdx) {
  PUZZLE.activeVariantIdx = newIdx;
  playPuzzleDropSound();

  const centerCell = document.getElementById('puzzle-center-slot');
  if (centerCell && PUZZLE.masterCvs) {
    buildCenterSlotCell(centerCell, PUZZLE.masterCvs, 120, 110);
  }
  if (PUZZLE.masterCvs) {
    buildTopVariants(PUZZLE.masterCvs);
  }
}

function resetPuzzleGame() {
  PUZZLE.activeVariantIdx = null;
  const centerCell = document.getElementById('puzzle-center-slot');
  if (centerCell && PUZZLE.masterCvs) {
    buildCenterSlotCell(centerCell, PUZZLE.masterCvs, 120, 110);
  }
  if (PUZZLE.masterCvs) {
    buildTopVariants(PUZZLE.masterCvs);
  }
}

function playPuzzleDropSound() {
  if (!document.getElementById('puzzle-sound-enable')?.checked) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(659.25, audioCtx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch (e) {}
}

function handlePuzzleColorToggle(changedIdx) {
  const cb1 = document.getElementById('puzzle-color-1-enable');
  const cb2 = document.getElementById('puzzle-color-2-enable');
  const cb3 = document.getElementById('puzzle-color-3-enable');
  const cbs = [cb1, cb2, cb3];

  if (cbs[changedIdx] && !cbs[changedIdx].checked) {
    // Exactly 1 piece un-tinted: check the other two
    cbs.forEach((cb, idx) => {
      if (idx !== changedIdx && cb) cb.checked = true;
    });
  } else if (cbs[changedIdx] && cbs[changedIdx].checked) {
    // If all 3 are checked, uncheck one of the others so exactly 1 remains un-tinted
    const uncheckedCount = cbs.filter(cb => cb && !cb.checked).length;
    if (uncheckedCount === 0) {
      const nextUncheck = (changedIdx + 1) % 3;
      if (cbs[nextUncheck]) cbs[nextUncheck].checked = false;
    }
  }
  renderPuzzleGame();
}

// ── LANDSCAPE FULLSCREEN PUZZLE MODE ──────────────────────────
function startPuzzleAnimation() {
  if (!PUZZLE.mainImg) {
    toast('Vui lòng tải 1 hình ảnh trước khi khởi chạy! 🧩');
    return;
  }

  // 1. Enter landscape fullscreen theater mode
  if (window.innerWidth < 1024) {
    openMobileTheater();
  } else {
    enterRecordingMode();
  }

  // Reset active piece so center slot is empty initially
  resetPuzzleGame();
}

// ── DYNAMIC HUGE PENCIL CURSOR TRACKER (MOVE, DRAG, DROP) ────
(function initBigPencilCursor() {
  let pencilEl = document.getElementById('big-pencil-cursor');
  if (!pencilEl) {
    pencilEl = document.createElement('div');
    pencilEl.id = 'big-pencil-cursor';
    pencilEl.className = 'big-pencil-cursor';
    pencilEl.innerHTML = `
      <svg width="192" height="192" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16.862 2.487a1.75 1.75 0 012.474 2.474L8.35 15.947l-3.864.966.966-3.864L16.862 2.487z" fill="#f59e0b" stroke="#0f172a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14.387 4.962l2.474 2.474" stroke="#0f172a" stroke-width="1.8"/>
        <path d="M4.486 16.913l.966-3.864 2.898 2.898-3.864.966z" fill="#38bdf8"/>
      </svg>
    `;
    document.body.appendChild(pencilEl);
  }

  const updatePos = (e) => {
    // Only show big pencil follower when hovering/dragging on PUZZLE tab
    const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
    if (activeTab !== 'puzzle') {
      pencilEl.classList.remove('active');
      return;
    }

    const x = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const y = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);
    if (x || y) {
      pencilEl.style.left = x + 'px';
      pencilEl.style.top  = y + 'px';
      pencilEl.classList.add('active');
    }
  };

  document.addEventListener('mousemove', updatePos, { passive: true });
  document.addEventListener('dragover',  updatePos, { passive: true });
  document.addEventListener('dragstart', (e) => {
    updatePos(e);
    pencilEl.classList.add('grabbing');
  }, { passive: true });
  document.addEventListener('dragend', () => {
    pencilEl.classList.remove('grabbing');
  }, { passive: true });
  document.addEventListener('drop', (e) => {
    updatePos(e);
    pencilEl.classList.remove('grabbing');
  }, { passive: true });
  document.addEventListener('mouseleave', () => {
    pencilEl.classList.remove('active');
  });
})();

// ──────────────────────────────────────────────────────────────
// FLASHLIGHT / SOI ĐÈN MODULE
// ──────────────────────────────────────────────────────────────
const FLASHLIGHT = {
  img1: null,
  img2: null,
  radius: 200,
  handSize: 44,
  imgScale: 100,
  imgOffsetY: 0,
  mode: 'circle', // 'circle' | 'horizontal'
  beamAngle: -135
};

function updateFlashlightMode(val) {
  FLASHLIGHT.mode = val || 'circle';
  renderFlashlightTab();
}

function updateFlashlightHandSize(val, fromInput) {
  const size = Math.max(10, parseInt(val) || 44);
  FLASHLIGHT.handSize = size;
  const valEl = document.getElementById('fl-hand-val');
  if (valEl && !fromInput) valEl.value = size;
  const rangeEl = document.getElementById('fl-hand-range');
  if (rangeEl) rangeEl.value = size;
  const cur = document.getElementById('fl-custom-cursor');
  if (cur) cur.style.fontSize = size + 'px';
}

function updateFlashlightImgScale(val, fromInput) {
  const scaleVal = Math.max(10, parseInt(val) || 100);
  FLASHLIGHT.imgScale = scaleVal;
  const valEl = document.getElementById('fl-img-scale-val');
  if (valEl && !fromInput) valEl.value = scaleVal;
  const rangeEl = document.getElementById('fl-img-scale-range');
  if (rangeEl) rangeEl.value = scaleVal;
  renderFlashlightTab();
}

function updateFlashlightImgOffsetY(val, fromInput) {
  const offsetVal = parseInt(val) || 0;
  FLASHLIGHT.imgOffsetY = offsetVal;
  const valEl = document.getElementById('fl-img-offsety-val');
  if (valEl && !fromInput) valEl.value = offsetVal;
  const rangeEl = document.getElementById('fl-img-offsety-range');
  if (rangeEl) rangeEl.value = offsetVal;
  renderFlashlightTab();
}

function updateFlashlightRadius(val, fromInput) {
  FLASHLIGHT.radius = Math.max(1, parseInt(val) || 65);
  const valEl = document.getElementById('fl-radius-val');
  if (valEl && !fromInput) valEl.value = FLASHLIGHT.radius;
  const rangeEl = document.getElementById('fl-radius-range');
  if (rangeEl) rangeEl.value = FLASHLIGHT.radius;
  renderFlashlightTab();
}

function updateBeamAngle(val) {
  FLASHLIGHT.beamAngle = parseInt(val) || 0;
  const valEl = document.getElementById('fl-beam-angle-val');
  if (valEl) valEl.textContent = FLASHLIGHT.beamAngle + '°';
  renderFlashlightTab();
}

// ── Lưu / tải cài đặt Soi Đèn bằng localStorage ──
const FL_SETTINGS_KEY = 'flashlightSettings';

function saveFlashlightSettings() {
  try {
    localStorage.setItem(FL_SETTINGS_KEY, JSON.stringify({
      mode: FLASHLIGHT.mode,
      radius: FLASHLIGHT.radius,
      handSize: FLASHLIGHT.handSize || 44,
      imgScale: FLASHLIGHT.imgScale || 100,
      imgOffsetY: FLASHLIGHT.imgOffsetY || 0
    }));
  } catch (e) { /* storage unavailable */ }
}

(function initFlashlightSettingsPersistence() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(FL_SETTINGS_KEY) || 'null'); } catch (e) { }

  if (saved) {
    if (saved.mode) FLASHLIGHT.mode = saved.mode;
    if (saved.radius) FLASHLIGHT.radius = saved.radius;
    if (saved.handSize) FLASHLIGHT.handSize = saved.handSize;
    if (saved.imgScale !== undefined) FLASHLIGHT.imgScale = saved.imgScale;
    if (saved.imgOffsetY !== undefined) FLASHLIGHT.imgOffsetY = saved.imgOffsetY;
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('fl-mode-select', FLASHLIGHT.mode);
  set('fl-radius-val', FLASHLIGHT.radius);
  set('fl-radius-range', FLASHLIGHT.radius);
  set('fl-hand-val', FLASHLIGHT.handSize || 44);
  set('fl-hand-range', FLASHLIGHT.handSize || 44);
  set('fl-img-scale-val', FLASHLIGHT.imgScale || 100);
  set('fl-img-scale-range', FLASHLIGHT.imgScale || 100);
  set('fl-img-offsety-val', FLASHLIGHT.imgOffsetY || 0);
  set('fl-img-offsety-range', FLASHLIGHT.imgOffsetY || 0);

  // Lưu mỗi khi người dùng chỉnh bất kỳ cài đặt nào
  ['fl-mode-select', 'fl-radius-val', 'fl-radius-range', 'fl-hand-val', 'fl-hand-range', 'fl-img-scale-val', 'fl-img-scale-range', 'fl-img-offsety-val', 'fl-img-offsety-range'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => setTimeout(saveFlashlightSettings, 0));
    el.addEventListener('change', () => setTimeout(saveFlashlightSettings, 0));
  });
})();


// Init file listeners for Flashlight tab (Supports selecting 2 images at once)
(function initFlashlightModule() {
  const multiInput = document.getElementById('file-fl-multi');

  if (multiInput) {
    multiInput.addEventListener('change', e => {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      if (files.length === 0) return;

      loadFlashlightImage(1, files[0]);
      e.target.value = '';
    });
  }
})();

function loadFlashlightImage(slot, file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      if (slot === 1) FLASHLIGHT.img1 = img;
      if (slot === 2) FLASHLIGHT.img2 = img;
      updateFlashlightMultiPreview();
      renderFlashlightTab();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function updateFlashlightMultiPreview() {
  const body = document.getElementById('body-fl-multi');
  const prev = document.getElementById('prev-fl-multi');
  const pimg1 = document.getElementById('pimg-fl-1');
  const pimg2 = document.getElementById('pimg-fl-2');

  if (FLASHLIGHT.img1) {
    if (body) body.style.display = 'none';
    if (prev) prev.style.display = 'block';
    if (pimg1) pimg1.src = FLASHLIGHT.img1.src;
  } else {
    if (body) body.style.display = 'flex';
    if (prev) prev.style.display = 'none';
  }
}

function clearFlashlightMulti() {
  FLASHLIGHT.img1 = null;
  FLASHLIGHT.img2 = null;
  updateFlashlightMultiPreview();
  renderFlashlightTab();
}

function updateFlashlightRadius(val, fromInput) {
  FLASHLIGHT.radius = Math.max(1, parseInt(val) || 65);
  const valEl = document.getElementById('fl-radius-val');
  if (valEl && !fromInput) valEl.value = FLASHLIGHT.radius;
  const rangeEl = document.getElementById('fl-radius-range');
  if (rangeEl) rangeEl.value = FLASHLIGHT.radius;

  const ring = document.getElementById('fl-beam-ring');
  if (ring) {
    const d = FLASHLIGHT.radius * 2;
    ring.style.width  = d + 'px';
    ring.style.height = d + 'px';
  }
}

function renderFlashlightTab() {
  const flOverlay = document.getElementById('flashlight-theater-overlay');
  const emojiHeader = document.getElementById('emoji-header-bar');

  if (flOverlay && activeTab === 'flashlight') {
    flOverlay.classList.add('show');
    if (emojiHeader) emojiHeader.classList.add('hidden');
  }

  // Update dynamic badges emoji text
  const e1Val = document.getElementById('fl-emoji-1-input')?.value || '💙';
  const e2Val = document.getElementById('fl-emoji-2-input')?.value || '❤️';
  const badge1El = document.getElementById('fl-badge-emoji-1');
  const badge2El = document.getElementById('fl-badge-emoji-2');
  if (badge1El) badge1El.textContent = e1Val;
  if (badge2El) badge2El.textContent = e2Val;

  // 1. Draw top row 2 cards (Image 1 and Image 2)
  renderTopFlashlightCards();

  // 2. Render bottom main stage (color image + black mask overlay)
  renderFlashlightStage();
}

function renderTopFlashlightCards() {
  const cvs1 = document.getElementById('fl-cvs-top-1');
  const cvs2 = document.getElementById('fl-cvs-top-2');

  if (cvs1) {
    const ctx = cvs1.getContext('2d');
    ctx.clearRect(0, 0, 150, 150);
    if (FLASHLIGHT.img1 && FLASHLIGHT.img1.complete && FLASHLIGHT.img1.naturalWidth) {
      drawScaledFit(ctx, FLASHLIGHT.img1, 150, 150);
    }
  }

  if (cvs2) {
    const ctx = cvs2.getContext('2d');
    ctx.clearRect(0, 0, 150, 150);
    if (FLASHLIGHT.img2 && FLASHLIGHT.img2.complete && FLASHLIGHT.img2.naturalWidth) {
      drawScaledFit(ctx, FLASHLIGHT.img2, 150, 150);
    }
  }
}

function drawScaledFit(ctx, img, targetW, targetH, customScale = 1, offsetY = 0) {
  const srcW = img.naturalWidth  || img.width  || targetW;
  const srcH = img.naturalHeight || img.height || targetH;
  const baseScale = Math.min(targetW / srcW, targetH / srcH);
  const finalScale = baseScale * customScale;
  const renderW = srcW * finalScale;
  const renderH = srcH * finalScale;
  const dx = (targetW - renderW) / 2;
  const dy = (targetH - renderH) / 2 + offsetY;
  ctx.drawImage(img, 0, 0, srcW, srcH, dx, dy, renderW, renderH);
}

function renderFlashlightStage() {
  const colorCvs = document.getElementById('fl-color-canvas');
  const maskCvs  = document.getElementById('fl-mask-canvas');
  const stageEl  = document.getElementById('flashlight-bottom-stage');
  if (!colorCvs || !maskCvs || !stageEl) return;

  const W = 1080, H = 1920;
  const targetSel = document.getElementById('fl-target-select')?.value || '1';
  const targetImg = (targetSel === '1') ? FLASHLIGHT.img1 : FLASHLIGHT.img2;

  const scaleFactor = (FLASHLIGHT.imgScale || 100) / 100;
  const offsetY = FLASHLIGHT.imgOffsetY || 0;

  // 1. Render color canvas (bottom layer)
  const cCtx = colorCvs.getContext('2d');
  cCtx.imageSmoothingEnabled = true;
  cCtx.imageSmoothingQuality = 'high';
  cCtx.clearRect(0, 0, W, H);
  if (targetImg && targetImg.complete && targetImg.naturalWidth) {
    drawScaledFit(cCtx, targetImg, W, H, scaleFactor, offsetY);
  }

  // 2. Render pitch-black mask canvas (top layer)
  resetFlashlightMaskCanvas(maskCvs, targetImg, W, H);

  // 3. Attach mousemove / touchmove listeners for spotlight reveal
  setupFlashlightSpotlightEvents(stageEl, maskCvs, colorCvs, W, H);
}

function resetFlashlightMaskCanvas(maskCvs, targetImg, W, H) {
  const mCtx = maskCvs.getContext('2d');
  mCtx.imageSmoothingEnabled = true;
  mCtx.imageSmoothingQuality = 'high';
  mCtx.globalCompositeOperation = 'source-over';
  mCtx.clearRect(0, 0, W, H);

  if (targetImg && targetImg.complete && targetImg.naturalWidth) {
    const scaleFactor = (FLASHLIGHT.imgScale || 100) / 100;
    const offsetY = FLASHLIGHT.imgOffsetY || 0;
    // Fill mask strictly matching character's outline/silhouette (Alpha channel)
    mCtx.save();
    drawScaledFit(mCtx, targetImg, W, H, scaleFactor, offsetY);
    mCtx.globalCompositeOperation = 'source-in';
    mCtx.fillStyle = '#000000';
    mCtx.fillRect(0, 0, W, H);
    mCtx.restore();
  }
}

function setupFlashlightSpotlightEvents(stageEl, maskCvs, colorCvs, W, H) {
  const mCtx = maskCvs.getContext('2d');

  let isDragging = false;

  // Helper function to render torch light beam at specified CSS position (cssX, cssY)
  const renderTorchAtCSSPos = (cssX, cssY) => {
    const targetSel = document.getElementById('fl-target-select')?.value || '1';
    const targetImg = (targetSel === '1') ? FLASHLIGHT.img1 : FLASHLIGHT.img2;

    const isRotated = document.body.classList.contains('recording-mode');
    const rect = maskCvs.getBoundingClientRect();

    const scaleX = maskCvs.width / (isRotated ? (rect.height || 1) : (rect.width || 1));
    const scaleY = maskCvs.height / (isRotated ? (rect.width || 1) : (rect.height || 1));

    const x = cssX * scaleX;
    const y = cssY * scaleY;

    // Reset mask to black so unlit areas stay pitch black
    resetFlashlightMaskCanvas(maskCvs, targetImg, W, H);

    const rCSS = FLASHLIGHT.radius;
    const scaleCanvasRatio = maskCvs.width / (isRotated ? rect.height : rect.width);
    const rCanvas = rCSS * scaleCanvasRatio;

    mCtx.save();

    if (FLASHLIGHT.mode === 'horizontal') {
      // Mode 2: Angled Cone Spotlight Beam (Chiếu chéo góc nón theo FLASHLIGHT.beamAngle riêng)
      const beamRadAngle = (FLASHLIGHT.beamAngle || -135) * Math.PI / 180;

      const torchHeadX = x;
      const torchHeadY = y;

      const rStart = Math.max(12, rCanvas);
      const rEnd = rCanvas * 1.3; // gần như song song, nở nhẹ
      const beamLength = Math.max(W, H) * 1.5;

      const endX = torchHeadX + Math.cos(beamRadAngle) * beamLength;
      const endY = torchHeadY + Math.sin(beamRadAngle) * beamLength;

      const perpX = -Math.sin(beamRadAngle);
      const perpY = Math.cos(beamRadAngle);

      const p1x = torchHeadX + perpX * rStart;
      const p1y = torchHeadY + perpY * rStart;
      const p2x = torchHeadX - perpX * rStart;
      const p2y = torchHeadY - perpY * rStart;

      const p3x = endX - perpX * rEnd;
      const p3y = endY - perpY * rEnd;
      const p4x = endX + perpX * rEnd;
      const p4y = endY + perpY * rEnd;

      const coneGrad = mCtx.createLinearGradient(torchHeadX, torchHeadY, endX, endY);
      coneGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
      coneGrad.addColorStop(0.65, 'rgba(0, 0, 0, 0.9)');
      coneGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      mCtx.globalCompositeOperation = 'destination-out';
      mCtx.fillStyle = coneGrad;

      mCtx.beginPath();
      mCtx.moveTo(p1x, p1y);
      mCtx.lineTo(p4x, p4y);
      mCtx.lineTo(p3x, p3y);
      mCtx.lineTo(p2x, p2y);
      mCtx.closePath();
      mCtx.fill();

      // Soft circular tip glow
      const tipGrad = mCtx.createRadialGradient(torchHeadX, torchHeadY, 0, torchHeadX, torchHeadY, rStart);
      tipGrad.addColorStop(0, 'rgba(0, 0, 0, 1)');
      tipGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      mCtx.fillStyle = tipGrad;
      mCtx.beginPath();
      mCtx.arc(torchHeadX, torchHeadY, rStart, 0, Math.PI * 2);
      mCtx.fill();
    } else {
      // Mode 1: Circle Spotlight (viền tròn rõ nét, không nhòe)
      mCtx.globalCompositeOperation = 'destination-out';
      mCtx.fillStyle = '#000000';
      mCtx.beginPath();
      mCtx.arc(x, y, rCanvas, 0, Math.PI * 2);
      mCtx.fill();
    }

    mCtx.restore();
  };

  // Convert raw pointer screen coordinates to local CSS coordinates inside stage
  const getStageLocalCSS = (e) => {
    const rect = maskCvs.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0));

    const isRotated = document.body.classList.contains('recording-mode');
    if (isRotated) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const unRotatedX = -(clientY - centerY);
      const unRotatedY = clientX - centerX;
      return {
        cssX: unRotatedX + rect.height / 2,
        cssY: unRotatedY + rect.width / 2
      };
    } else {
      return {
        cssX: clientX - rect.left,
        cssY: clientY - rect.top
      };
    }
  };

  // Custom cursor living INSIDE the stage so it rotates together with the landscape theater
  let cursorEl = stageEl.querySelector('#fl-custom-cursor');
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.id = 'fl-custom-cursor';
    cursorEl.textContent = '\uD83D\uDC46';
    cursorEl.style.cssText = 'position:absolute;left:0;top:0;line-height:1;pointer-events:none;z-index:10;display:none;transform:translate(-50%,-8%);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));';
    stageEl.appendChild(cursorEl);
  }
  stageEl.style.cursor = 'none';
  stageEl.querySelectorAll('canvas').forEach(c => { c.style.cursor = 'none'; });

  const moveCursor = (e) => {
    cursorEl.style.fontSize = (FLASHLIGHT.handSize || 44) + 'px';
    const { cssX, cssY } = getStageLocalCSS(e);
    const isRotated = document.body.classList.contains('recording-mode');
    const rect = maskCvs.getBoundingClientRect();
    const s = (isRotated ? rect.height : rect.width) / (maskCvs.offsetWidth || 1) || 1;
    cursorEl.style.left = (cssX / s) + 'px';
    cursorEl.style.top = (cssY / s) + 'px';
    cursorEl.style.display = 'block';
  };
  if (!stageEl.dataset.flCursorBound) {
    stageEl.dataset.flCursorBound = '1';
    stageEl.addEventListener('pointermove', moveCursor);
    stageEl.addEventListener('pointerdown', moveCursor);
    stageEl.addEventListener('pointerleave', () => { cursorEl.style.display = 'none'; });
  }

  // Drag / Touch Handlers
  const onPointerDown = (e) => {
    isDragging = true;
    if (e.cancelable) e.preventDefault();
    const { cssX, cssY } = getStageLocalCSS(e);
    renderTorchAtCSSPos(cssX, cssY);
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    if (e.cancelable) e.preventDefault();
    const { cssX, cssY } = getStageLocalCSS(e);
    renderTorchAtCSSPos(cssX, cssY);
  };

  const onPointerUp = () => {
    isDragging = false;
  };

  stageEl.addEventListener('pointerdown', onPointerDown, { passive: false });
  stageEl.addEventListener('touchstart', onPointerDown, { passive: false });
  stageEl.addEventListener('mousedown', onPointerDown);

  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('mousemove', onPointerMove);

  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('touchend', onPointerUp);
  window.addEventListener('mouseup', onPointerUp);
  window.addEventListener('touchcancel', onPointerUp);

  // Initial center position setup
  renderTorchAtCSSPos(540, 960);
}

// ──────────────────────────────────────────────────────────────
// SHADOW MATCH / GHÉP BÓNG MODULE
// ──────────────────────────────────────────────────────────────
const SHADOWMATCH = {
  images: [], // array of HTMLImageElement (up to 3)
  shadowIndex: 0, // index of the silhouette image (0, 1 or 2)
  handSize: 44,
  imgScale: 100,
  imgOffsetY: 0,
  cardState: [] // { index, origSlot, top, left, width, height, scaleRatio, isDropped, dropTop, dropLeft, isDragging }
};

function updateShadowMatchHandSize(val, fromInput) {
  const size = Math.max(10, parseInt(val) || 44);
  SHADOWMATCH.handSize = size;
  const valEl = document.getElementById('sm-hand-val');
  if (valEl && !fromInput) valEl.value = size;
  const rangeEl = document.getElementById('sm-hand-range');
  if (rangeEl) rangeEl.value = size;
  const cur = document.getElementById('sm-custom-cursor');
  if (cur) cur.style.fontSize = size + 'px';
}

function updateShadowMatchImgScale(val, fromInput) {
  const scaleVal = Math.max(10, parseInt(val) || 100);
  SHADOWMATCH.imgScale = scaleVal;
  const valEl = document.getElementById('sm-img-scale-val');
  if (valEl && !fromInput) valEl.value = scaleVal;
  const rangeEl = document.getElementById('sm-img-scale-range');
  if (rangeEl) rangeEl.value = scaleVal;
  renderShadowMatchTab();
}

function updateShadowMatchImgOffsetY(val, fromInput) {
  const offsetVal = parseInt(val) || 0;
  SHADOWMATCH.imgOffsetY = offsetVal;
  const valEl = document.getElementById('sm-img-offsety-val');
  if (valEl && !fromInput) valEl.value = offsetVal;
  const rangeEl = document.getElementById('sm-img-offsety-range');
  if (rangeEl) rangeEl.value = offsetVal;
  renderShadowMatchTab();
}

function updateShadowMatchTarget(val) {
  SHADOWMATCH.shadowIndex = parseInt(val) || 0;
  renderShadowMatchTab();
}

// Persistence for Shadow Match settings
const SM_SETTINGS_KEY = 'shadowMatchSettings';

function saveShadowMatchSettings() {
  try {
    localStorage.setItem(SM_SETTINGS_KEY, JSON.stringify({
      shadowIndex: SHADOWMATCH.shadowIndex,
      handSize: SHADOWMATCH.handSize || 44,
      imgScale: SHADOWMATCH.imgScale || 100,
      imgOffsetY: SHADOWMATCH.imgOffsetY || 0
    }));
  } catch (e) { }
}

(function initShadowMatchSettingsPersistence() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SM_SETTINGS_KEY) || 'null'); } catch (e) { }

  if (saved) {
    if (saved.shadowIndex !== undefined) SHADOWMATCH.shadowIndex = saved.shadowIndex;
    if (saved.handSize) SHADOWMATCH.handSize = saved.handSize;
    if (saved.imgScale !== undefined) SHADOWMATCH.imgScale = saved.imgScale;
    if (saved.imgOffsetY !== undefined) SHADOWMATCH.imgOffsetY = saved.imgOffsetY;
  }

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('sm-shadow-select', SHADOWMATCH.shadowIndex);
  set('sm-hand-val', SHADOWMATCH.handSize || 44);
  set('sm-hand-range', SHADOWMATCH.handSize || 44);
  set('sm-img-scale-val', SHADOWMATCH.imgScale || 100);
  set('sm-img-scale-range', SHADOWMATCH.imgScale || 100);
  set('sm-img-offsety-val', SHADOWMATCH.imgOffsetY || 0);
  set('sm-img-offsety-range', SHADOWMATCH.imgOffsetY || 0);

  ['sm-shadow-select', 'sm-hand-val', 'sm-hand-range', 'sm-img-scale-val', 'sm-img-scale-range', 'sm-img-offsety-val', 'sm-img-offsety-range'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', () => setTimeout(saveShadowMatchSettings, 0));
    el.addEventListener('change', () => setTimeout(saveShadowMatchSettings, 0));
  });
})();

// File listener for Shadow Match
(function initShadowMatchModule() {
  const multiInput = document.getElementById('file-sm-multi');
  if (multiInput) {
    multiInput.addEventListener('change', e => {
      const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
      if (files.length === 0) return;

      SHADOWMATCH.images = [];
      let loaded = 0;
      files.forEach((file, idx) => {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            SHADOWMATCH.images[idx] = img;
            loaded++;
            updateShadowMatchPreviewList();
            renderShadowMatchTab();
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });
  }

  // Global spacebar listener to reset dropped cards back to original positions
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && activeTab === 'shadowmatch') {
      e.preventDefault();
      resetShadowMatchPositions();
    }
  });
})();

function updateShadowMatchPreviewList() {
  const body = document.getElementById('body-sm-multi');
  const prev = document.getElementById('prev-sm-multi');
  const listEl = document.getElementById('sm-preview-list');

  if (SHADOWMATCH.images && SHADOWMATCH.images.length > 0) {
    if (body) body.style.display = 'none';
    if (prev) prev.style.display = 'block';
    if (listEl) {
      listEl.innerHTML = '';
      SHADOWMATCH.images.forEach((img, idx) => {
        if (!img) return;
        const item = document.createElement('div');
        item.style.cssText = 'position:relative;width:60px;height:70px;border-radius:8px;overflow:hidden;background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;';
        
        const previewImg = document.createElement('img');
        previewImg.src = img.src;
        previewImg.style.cssText = 'width:100%;height:50px;object-fit:contain;';

        const label = document.createElement('span');
        label.textContent = `${idx + 1}. ` + (idx === SHADOWMATCH.shadowIndex ? 'Bóng' : `Ảnh ${idx + 1}`);
        label.style.cssText = 'font-size:0.6rem;color:#fff;background:rgba(0,0,0,0.7);width:100%;text-align:center;padding:1px 0;';

        item.appendChild(previewImg);
        item.appendChild(label);
        listEl.appendChild(item);
      });
    }
  } else {
    if (body) body.style.display = 'flex';
    if (prev) prev.style.display = 'none';
  }
}

function clearShadowMatchImages() {
  SHADOWMATCH.images = [];
  updateShadowMatchPreviewList();
  renderShadowMatchTab();
}

function resetShadowMatchPositions() {
  SHADOWMATCH.activeCardEl = null;
  SHADOWMATCH.cardState.forEach(cs => {
    cs.isDropped = false;
  });
  renderShadowMatchTab();
}

function renderShadowMatchTab() {
  const smOverlay = document.getElementById('shadowmatch-theater-overlay');
  const emojiHeader = document.getElementById('emoji-header-bar');

  if (smOverlay && activeTab === 'shadowmatch') {
    smOverlay.classList.add('show');
    if (emojiHeader) emojiHeader.classList.add('hidden');
  }

  // 1. Render blackout silhouette canvas on stage
  renderShadowMatchStage();
}

function renderShadowMatchStage() {
  const shadowCvs = document.getElementById('sm-shadow-canvas');
  const stageEl   = document.getElementById('sm-stage');
  const dragCont  = document.getElementById('sm-drag-container');
  if (!shadowCvs || !stageEl || !dragCont) return;

  const W = 1080, H = 1920;
  const shadowIdx = SHADOWMATCH.shadowIndex || 0;
  const shadowImg = SHADOWMATCH.images[shadowIdx];

  const scaleFactor = (SHADOWMATCH.imgScale || 100) / 100;
  const offsetY = SHADOWMATCH.imgOffsetY || 0;

  // Render silhouette blackout canvas
  const sCtx = shadowCvs.getContext('2d');
  sCtx.imageSmoothingEnabled = true;
  sCtx.imageSmoothingQuality = 'high';
  sCtx.clearRect(0, 0, W, H);

  if (shadowImg && shadowImg.complete && shadowImg.naturalWidth) {
    sCtx.save();
    drawScaledFit(sCtx, shadowImg, W, H, scaleFactor, offsetY);
    sCtx.globalCompositeOperation = 'source-in';
    sCtx.fillStyle = '#000000';
    sCtx.fillRect(0, 0, W, H);
    sCtx.restore();
  }

  // Build top draggable cards inside dragCont
  renderShadowMatchDraggableCards(stageEl, dragCont, W, H, scaleFactor, offsetY);
  setupShadowMatchCursor(stageEl);
}

// Compute bounding box for scaled fit image on target W, H
function getScaledFitBounds(img, targetW, targetH, customScale = 1, offsetY = 0) {
  const srcW = img.naturalWidth || img.width || targetW;
  const srcH = img.naturalHeight || img.height || targetH;
  const baseScale = Math.min(targetW / srcW, targetH / srcH);
  const finalScale = baseScale * customScale;
  const renderW = srcW * finalScale;
  const renderH = srcH * finalScale;
  const dx = (targetW - renderW) / 2;
  const dy = (targetH - renderH) / 2 + offsetY;
  return { dx, dy, renderW, renderH };
}

function renderShadowMatchDraggableCards(stageEl, dragCont, W, H, scaleFactor, offsetY) {
  dragCont.innerHTML = '';
  if (!SHADOWMATCH.images || SHADOWMATCH.images.length === 0) return;

  const stageRect = stageEl.getBoundingClientRect();
  const isRotated = document.body.classList.contains('recording-mode');
  const stageW = isRotated ? (stageRect.height || 640) : (stageRect.width || 360);
  const stageH = isRotated ? (stageRect.width || 360) : (stageRect.height || 640);

  // Calculate shadow silhouette target bounding box in stage CSS pixels
  const shadowIdx = SHADOWMATCH.shadowIndex || 0;
  const shadowImg = SHADOWMATCH.images[shadowIdx];
  let shadowBounds = { dx: 0, dy: (H - H * scaleFactor) / 2 + offsetY, renderW: W * scaleFactor, renderH: H * scaleFactor };
  if (shadowImg && shadowImg.naturalWidth) {
    shadowBounds = getScaledFitBounds(shadowImg, W, H, scaleFactor, offsetY);
  }

  // Convert canvas pixel bounds to stage CSS pixel bounds
  const cvsToCssX = stageW / W;
  const cvsToCssY = stageH / H;

  const targetCssX = shadowBounds.dx * cvsToCssX;
  const targetCssY = shadowBounds.dy * cvsToCssY;
  const targetCssW = shadowBounds.renderW * cvsToCssX;
  const targetCssH = shadowBounds.renderH * cvsToCssY;

  // Available images to display in top row
  const nonShadowImages = SHADOWMATCH.images;
  const totalCards = nonShadowImages.length;
  if (totalCards === 0) return;

  const topRowPadding = 15;
  const topRowHeight = stageH * 0.22;
  const cardW = (stageW - topRowPadding * (totalCards + 1)) / totalCards;
  const cardH = topRowHeight;

  nonShadowImages.forEach((img, idx) => {
    if (!img) return;

    if (!SHADOWMATCH.cardState[idx]) {
      SHADOWMATCH.cardState[idx] = { isDropped: false, dropTop: 0, dropLeft: 0 };
    }
    const state = SHADOWMATCH.cardState[idx];

    const cardEl = document.createElement('div');
    cardEl.className = 'sm-draggable-card';
    cardEl.dataset.cardIdx = idx;

    const imgEl = document.createElement('img');
    imgEl.src = img.src;
    cardEl.appendChild(imgEl);

    // Initial position in top row
    const origLeft = topRowPadding + idx * (cardW + topRowPadding);
    const origTop = 15;

    if (state.isDropped) {
      cardEl.classList.add('dropped');
      const curW = state.dropW !== undefined ? state.dropW : targetCssW;
      const curH = state.dropH !== undefined ? state.dropH : targetCssH;
      cardEl.style.width = curW + 'px';
      cardEl.style.height = curH + 'px';
      cardEl.style.left = (state.dropLeft !== undefined ? state.dropLeft : targetCssX) + 'px';
      cardEl.style.top = (state.dropTop !== undefined ? state.dropTop : targetCssY) + 'px';

      // Create 4 corner resize handles
      ['tl', 'tr', 'bl', 'br'].forEach(corner => {
        const handle = document.createElement('div');
        handle.className = `sm-resize-handle ${corner}`;
        handle.dataset.corner = corner;
        cardEl.appendChild(handle);
        makeHandleResizable(handle, cardEl, idx, stageEl, corner);
      });
    } else {
      cardEl.classList.remove('dropped');
      cardEl.style.width = cardW + 'px';
      cardEl.style.height = cardH + 'px';
      cardEl.style.left = origLeft + 'px';
      cardEl.style.top = origTop + 'px';
    }

    // Attach Pointer Drag events for each card
    makeCardDraggable(cardEl, idx, stageEl, targetCssW, targetCssH, origLeft, origTop);

    dragCont.appendChild(cardEl);
  });
}

function makeHandleResizable(handle, cardEl, cardIdx, stageEl, corner) {
  let isResizing = false;
  let startX = 0, startY = 0;
  let startWidth = 0, startHeight = 0;
  let startLeft = 0, startTop = 0;

  const getStageCssPos = (e) => {
    const rect = stageEl.getBoundingClientRect();
    const isRotated = document.body.classList.contains('recording-mode');
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    if (isRotated) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        stageCssX: -(clientY - centerY) + rect.height / 2,
        stageCssY: (clientX - centerX) + rect.width / 2
      };
    } else {
      return {
        stageCssX: clientX - rect.left,
        stageCssY: clientY - rect.top
      };
    }
  };

  const onPointerMove = (e) => {
    if (!isResizing) return;
    const { stageCssX, stageCssY } = getStageCssPos(e);
    let deltaX = stageCssX - startX;
    let deltaY = stageCssY - startY;

    let newW = startWidth;
    let newH = startHeight;
    let newLeft = startLeft;
    let newTop = startTop;

    const aspect = startWidth / startHeight || 1;

    if (corner === 'br') {
      newW = Math.max(30, startWidth + deltaX);
      newH = newW / aspect;
    } else if (corner === 'bl') {
      newW = Math.max(30, startWidth - deltaX);
      newH = newW / aspect;
      newLeft = startLeft + (startWidth - newW);
    } else if (corner === 'tr') {
      newW = Math.max(30, startWidth + deltaX);
      newH = newW / aspect;
      newTop = startTop + (startHeight - newH);
    } else if (corner === 'tl') {
      newW = Math.max(30, startWidth - deltaX);
      newH = newW / aspect;
      newLeft = startLeft + (startWidth - newW);
      newTop = startTop + (startHeight - newH);
    }

    cardEl.style.width = newW + 'px';
    cardEl.style.height = newH + 'px';
    cardEl.style.left = newLeft + 'px';
    cardEl.style.top = newTop + 'px';

    SHADOWMATCH.cardState[cardIdx].dropW = newW;
    SHADOWMATCH.cardState[cardIdx].dropH = newH;
    SHADOWMATCH.cardState[cardIdx].dropLeft = newLeft;
    SHADOWMATCH.cardState[cardIdx].dropTop = newTop;
  };

  const onPointerUp = (e) => {
    if (!isResizing) return;
    isResizing = false;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('touchmove', onPointerMove);
    window.removeEventListener('touchend', onPointerUp);
  };

  const onPointerDown = (e) => {
    e.stopPropagation();
    isResizing = true;

    const { stageCssX, stageCssY } = getStageCssPos(e);
    startX = stageCssX;
    startY = stageCssY;
    startWidth = parseFloat(cardEl.style.width) || cardEl.offsetWidth;
    startHeight = parseFloat(cardEl.style.height) || cardEl.offsetHeight;
    startLeft = parseFloat(cardEl.style.left) || 0;
    startTop = parseFloat(cardEl.style.top) || 0;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: false });
}

function makeCardDraggable(cardEl, cardIdx, stageEl, targetCssW, targetCssH, origLeft, origTop) {
  const getStageCssPos = (e) => {
    const rect = stageEl.getBoundingClientRect();
    const isRotated = document.body.classList.contains('recording-mode');
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0));
    const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientY : 0));
    if (isRotated) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        stageCssX: -(clientY - centerY) + rect.height / 2,
        stageCssY: (clientX - centerX) + rect.width / 2
      };
    } else {
      return {
        stageCssX: clientX - rect.left,
        stageCssY: clientY - rect.top
      };
    }
  };

  const onPointerMove = (e) => {
    if (!SHADOWMATCH.activeCardEl || SHADOWMATCH.activeCardEl !== cardEl) return;
    const { stageCssX, stageCssY } = getStageCssPos(e);
    cardEl.style.left = (stageCssX - targetCssW / 2) + 'px';
    cardEl.style.top = (stageCssY - targetCssH / 2) + 'px';
  };

  const onPointerDown = (e) => {
    e.stopPropagation();

    // If this card is ALREADY active (being moved), click again to DROP it at current location
    if (SHADOWMATCH.activeCardEl === cardEl) {
      SHADOWMATCH.activeCardEl = null;
      cardEl.style.zIndex = '5';
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchmove', onPointerMove);

      const currentTop = parseFloat(cardEl.style.top) || 0;
      const currentLeft = parseFloat(cardEl.style.left) || 0;

      if (currentTop > 30) {
        SHADOWMATCH.cardState[cardIdx] = {
          isDropped: true,
          dropLeft: currentLeft,
          dropTop: currentTop
        };
      } else {
        SHADOWMATCH.cardState[cardIdx] = { isDropped: false };
        renderShadowMatchTab();
      }
      return;
    }

    // Release any previous active card if another one was selected
    if (SHADOWMATCH.activeCardEl && SHADOWMATCH.activeCardEl !== cardEl) {
      SHADOWMATCH.activeCardEl.style.zIndex = '5';
      SHADOWMATCH.activeCardEl = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('touchmove', onPointerMove);
    }

    // ACTIVATE THIS CARD: Pick up and follow cursor immediately
    SHADOWMATCH.activeCardEl = cardEl;
    cardEl.style.zIndex = '100';

    const state = SHADOWMATCH.cardState[cardIdx];
    state.isDropped = true;
    cardEl.style.width = targetCssW + 'px';
    cardEl.style.height = targetCssH + 'px';

    const { stageCssX, stageCssY } = getStageCssPos(e);
    cardEl.style.left = (stageCssX - targetCssW / 2) + 'px';
    cardEl.style.top = (stageCssY - targetCssH / 2) + 'px';

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('touchmove', onPointerMove, { passive: false });
  };

  cardEl.addEventListener('pointerdown', onPointerDown);
  cardEl.addEventListener('touchstart', onPointerDown, { passive: false });
}

function setupShadowMatchCursor(stageEl) {
  let cursorEl = stageEl.querySelector('#sm-custom-cursor');
  if (!cursorEl) {
    cursorEl = document.createElement('div');
    cursorEl.id = 'sm-custom-cursor';
    cursorEl.textContent = '👆';
    cursorEl.style.cssText = 'position:absolute;left:0;top:0;line-height:1;pointer-events:none;z-index:200;display:none;transform:translate(-50%,-8%);filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));';
    stageEl.appendChild(cursorEl);
  }
  stageEl.style.cursor = 'none';

  const moveCursor = (e) => {
    cursorEl.style.fontSize = (SHADOWMATCH.handSize || 44) + 'px';
    const rect = stageEl.getBoundingClientRect();
    const clientX = e.clientX || (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
    const clientY = e.clientY || (e.touches && e.touches[0] ? e.touches[0].clientY : 0);

    const isRotated = document.body.classList.contains('recording-mode');
    let cssX, cssY;
    if (isRotated) {
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const unRotatedX = -(clientY - centerY);
      const unRotatedY = clientX - centerX;
      cssX = unRotatedX + rect.height / 2;
      cssY = unRotatedY + rect.width / 2;
    } else {
      cssX = clientX - rect.left;
      cssY = clientY - rect.top;
    }

    cursorEl.style.left = cssX + 'px';
    cursorEl.style.top = cssY + 'px';
    cursorEl.style.display = 'block';
  };

  if (!stageEl.dataset.smCursorBound) {
    stageEl.dataset.smCursorBound = '1';
    stageEl.addEventListener('pointermove', moveCursor);
    stageEl.addEventListener('pointerdown', moveCursor);
    stageEl.addEventListener('pointerleave', () => { cursorEl.style.display = 'none'; });
  }
}

function startShadowMatchAnimation() {
  if (!SHADOWMATCH.images || SHADOWMATCH.images.length === 0) return;

  if (window.innerWidth < 1024) {
    openMobileTheater();
  } else {
    enterRecordingMode();
  }

  renderShadowMatchTab();
  setTimeout(() => {
    renderShadowMatchTab();
  }, 50);
  setTimeout(() => {
    renderShadowMatchTab();
  }, 350);
}

// ── Launch Flashlight Fullscreen Mode ────────────────────────
function startFlashlightAnimation() {
  if (!FLASHLIGHT.img1 && !FLASHLIGHT.img2) {
    toast('Vui lòng tải ít nhất 1 hình ảnh trước khi khởi chạy! 💡');
    return;
  }

  // Enter landscape fullscreen theater mode
  if (window.innerWidth < 1024) {
    openMobileTheater();
  } else {
    enterRecordingMode();
  }

  // Re-render and reset mask canvas to pitch black
  renderFlashlightTab();
  toast('Di chuyển chuột vào bức ảnh phía dưới để soi đèn pin! 💡');
}

/* ─────────────────────── TAB SWITCHER CONTROLLER ─────────────────────── */
function switchTab(tabName) {
  activeTab = tabName;

  // Toggle active button
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.getElementById(`tab-btn-${tabName}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    // Scroll active tab smoothly into view if tab bar overflows
    activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  // Toggle left tab contents
  document.querySelectorAll('.tab-content').forEach(content => {
    content.style.display = 'none';
  });
  const targetContent = document.getElementById(`tab-content-${tabName}`);
  if (targetContent) targetContent.style.display = 'flex';

  // Toggle right sidebar contents
  document.querySelectorAll('.right-tab-content').forEach(content => {
    content.style.display = 'none';
  });
  const targetRightContent = document.getElementById(`right-tab-content-${tabName}`);
  if (targetRightContent) targetRightContent.style.display = 'flex';

  // Specific tab initializations
  const flOverlay = document.getElementById('flashlight-theater-overlay');
  if (flOverlay) {
    if (tabName === 'flashlight') {
      renderFlashlightTab();
    } else {
      flOverlay.classList.remove('show');
      document.getElementById('theater')?.classList.remove('fl-theater-full');
    }
  }

  const puzzleOverlay = document.getElementById('puzzle-theater-overlay');
  if (puzzleOverlay) {
    if (tabName === 'puzzle') {
      puzzleOverlay.classList.add('show');
    } else {
      puzzleOverlay.classList.remove('show');
    }
  }

  const climaxOverlay = document.getElementById('climax-theater-overlay');
  if (climaxOverlay) {
    if (tabName === 'climax') {
      climaxOverlay.classList.add('show');
      document.body.classList.add('climax-active-mode');
      renderClimaxPreview();
    } else {
      climaxOverlay.classList.remove('show');
      document.body.classList.remove('climax-active-mode');
    }
  }

  const smOverlay = document.getElementById('shadowmatch-theater-overlay');
  if (smOverlay) {
    if (tabName === 'shadowmatch') {
      renderShadowMatchTab();
    } else {
      smOverlay.classList.remove('show');
    }
  }

  // Toggle Emoji Header Bar visibility (Show in Blend, Blend+ & Pokemon)
  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) {
    emojiHeaderBar.style.display = '';
    if (tabName === 'battle' || tabName === 'flashlight' || tabName === 'puzzle' || tabName === 'climax' || tabName === 'shadowmatch') {
      emojiHeaderBar.classList.add('hidden');
    } else {
      emojiHeaderBar.classList.remove('hidden');
    }
  }

  if (tabName === 'blendplus') {
    renderBpTable();
    updateBpPreview();
    refreshEmojiHeader();
  } else if (tabName !== 'puzzle' && tabName !== 'flashlight' && tabName !== 'climax' && tabName !== 'shadowmatch') {
    resetAll();
    refreshEmojiHeader();
  }
}

// ──────────────────────────────────────────────────────────────
// CLIMAX AUTOMATION MODULE (SPLIT DUEL & REVENGE CLIMAX)
// ──────────────────────────────────────────────────────────────
const CLIMAX = {
  heroNormalImg: null,
  heroWeakImg: null,
  heroStrongImg: null,
  opponentImg: null,
  bgImg: null,
  bgStyle: 'solid-red',
  heroName: 'POMNI',
  running: false,
  timers: []
};

function pickClimaxFile(slot) {
  document.getElementById(`file-climax-${slot}`).click();
}

(function initClimaxListeners() {
  ['hero-normal', 'hero-weak', 'hero-strong', 'opponent', 'bg'].forEach(slot => {
    const input = document.getElementById(`file-climax-${slot}`);
    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) loadClimaxSlot(slot, file);
      });
    }
  });
})();

function loadClimaxSlot(slot, file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      if (slot === 'hero-normal') CLIMAX.heroNormalImg = img;
      if (slot === 'hero-weak')   CLIMAX.heroWeakImg   = img;
      if (slot === 'hero-strong') CLIMAX.heroStrongImg = img;
      if (slot === 'opponent')    CLIMAX.opponentImg    = img;
      if (slot === 'bg')          CLIMAX.bgImg          = img;

      document.getElementById(`body-climax-${slot}`).style.display = 'none';
      const pv = document.getElementById(`prev-climax-${slot}`);
      if (pv) pv.style.display = 'flex';
      document.getElementById(`pimg-climax-${slot}`).src = ev.target.result;

      renderClimaxPreview();
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearClimaxSlot(slot) {
  if (slot === 'hero-normal') CLIMAX.heroNormalImg = null;
  if (slot === 'hero-weak')   CLIMAX.heroWeakImg   = null;
  if (slot === 'hero-strong') CLIMAX.heroStrongImg = null;
  if (slot === 'opponent')    CLIMAX.opponentImg    = null;
  if (slot === 'bg')          CLIMAX.bgImg          = null;

  document.getElementById(`body-climax-${slot}`).style.display = 'flex';
  const pv = document.getElementById(`prev-climax-${slot}`);
  if (pv) pv.style.display = 'none';
  document.getElementById(`file-climax-${slot}`).value = '';

  renderClimaxPreview();
}

function updateClimaxBgStyle(styleVal) {
  CLIMAX.bgStyle = styleVal;
  const bgWrap = document.getElementById('climax-bg-wrap');
  if (bgWrap) {
    bgWrap.className = 'climax-bg-wrap ' + styleVal;
  }
}

function updateClimaxHeroName(val) {
  CLIMAX.heroName = (val.trim() || 'POMNI').toUpperCase();
  const nameDisplay = document.getElementById('climax-hero-name-display');
  if (nameDisplay) nameDisplay.textContent = CLIMAX.heroName;

  // Auto suggest CTA line 1 if empty or default
  const line1Input = document.getElementById('climax-cta-line1-input');
  if (line1Input) {
    line1Input.value = `${CLIMAX.heroName} NEEDS POWER!`;
  }
}

function getClimaxFallbackImg(type) {
  if (type === 'bg') {
    return '';
  }
  if (type === 'hero-normal') {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><g transform="translate(200, 260)"><circle cx="0" cy="-70" r="65" fill="%233b82f6"/><path d="M-50,60 C-50,-10 50,-10 50,60 Z" fill="%232563eb"/><circle cx="-22" cy="-80" r="8" fill="%23ffffff"/><circle cx="22" cy="-80" r="8" fill="%23ffffff"/><circle cx="-22" cy="-80" r="4" fill="%23000"/><circle cx="22" cy="-80" r="4" fill="%23000"/><path d="M-25,-45 Q0,-30 25,-45" stroke="%23ffffff" stroke-width="5" fill="none"/><text x="0" y="-150" font-family="sans-serif" font-size="28" font-weight="900" fill="%2360a5fa" text-anchor="middle">😀 HERO NORMAL</text></g></svg>';
  }
  if (type === 'hero-weak') {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><g transform="translate(200, 260)"><circle cx="0" cy="-70" r="65" fill="%23f43f5e"/><path d="M-50,60 C-50,-10 50,-10 50,60 Z" fill="%23e11d48"/><circle cx="-22" cy="-80" r="8" fill="%23ffffff"/><circle cx="22" cy="-80" r="8" fill="%23ffffff"/><circle cx="-22" cy="-78" r="4" fill="%23000"/><circle cx="22" cy="-78" r="4" fill="%23000"/><path d="M-25,-45 Q0,-65 25,-45" stroke="%23ffffff" stroke-width="5" fill="none"/><text x="0" y="-150" font-family="sans-serif" font-size="28" font-weight="900" fill="%23fef08a" text-anchor="middle">⚡ HERO WEAK</text></g></svg>';
  }
  if (type === 'hero-strong') {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500" viewBox="0 0 400 500"><g transform="translate(200, 260)"><circle cx="0" cy="-70" r="75" fill="%23a855f7"/><path d="M-60,70 C-60,-20 60,-20 60,70 Z" fill="%239333ea"/><circle cx="-24" cy="-82" r="12" fill="%23fef08a"/><circle cx="24" cy="-82" r="12" fill="%23fef08a"/><circle cx="-24" cy="-82" r="6" fill="%23dc2626"/><circle cx="24" cy="-82" r="6" fill="%23dc2626"/><path d="M-30,-45 Q0,-25 30,-45" stroke="%23fef08a" stroke-width="6" fill="none"/><text x="0" y="-160" font-family="sans-serif" font-size="32" font-weight="900" fill="%23ef4444" text-anchor="middle">🔥 SUPER HERO</text></g></svg>';
  }
  if (type === 'opponent') {
    return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><g transform="translate(200, 200)"><polygon points="0,-110 35,-35 110,0 35,35 0,110 -35,35 -110,0 -35,-35" fill="%23dc2626"/><circle cx="0" cy="0" r="50" fill="%230f172a"/><circle cx="-16" cy="-12" r="8" fill="%23fbbf24"/><circle cx="16" cy="-12" r="8" fill="%23fbbf24"/><text x="0" y="-130" font-family="sans-serif" font-size="26" font-weight="900" fill="%23fca5a5" text-anchor="middle">😈 JAX BOSS</text></g></svg>';
  }
  return '';
}

function renderClimaxPreview() {
  const bgWrap        = document.getElementById('climax-bg-wrap');
  const bgImgEl       = document.getElementById('climax-bg-img');
  const opponentImgEl = document.getElementById('climax-opponent-img');
  const heroImgEl     = document.getElementById('climax-hero-img');
  const nameDisplay   = document.getElementById('climax-hero-name-display');

  if (bgWrap) {
    if (CLIMAX.bgImg) {
      bgWrap.style.background = 'none';
      if (bgImgEl) {
        bgImgEl.src = CLIMAX.bgImg.src;
        bgImgEl.style.display = 'block';
      }
    } else {
      if (bgImgEl) bgImgEl.style.display = 'none';
      bgWrap.className = 'climax-bg-wrap ' + (CLIMAX.bgStyle || 'solid-red');
    }
  }

  const heroNormalSrc = CLIMAX.heroNormalImg ? CLIMAX.heroNormalImg.src : (CLIMAX.heroWeakImg ? CLIMAX.heroWeakImg.src : getClimaxFallbackImg('hero-normal'));
  if (opponentImgEl) opponentImgEl.src = CLIMAX.opponentImg ? CLIMAX.opponentImg.src : getClimaxFallbackImg('opponent');
  if (heroImgEl)     heroImgEl.src     = heroNormalSrc;
  if (nameDisplay)   nameDisplay.textContent = CLIMAX.heroName;
}

function clearClimaxTimers() {
  CLIMAX.timers.forEach(t => clearTimeout(t));
  CLIMAX.timers = [];
}

function resetClimaxAutomation() {
  CLIMAX.running = false;
  clearClimaxTimers();

  document.body.classList.remove('climax-active-mode');

  const overlay      = document.getElementById('climax-theater-overlay');
  const bgWrap       = document.getElementById('climax-bg-wrap');
  const oppWrap      = document.getElementById('climax-opponent-wrap');
  const heroWrap     = document.getElementById('climax-hero-wrap');
  const splitDivider = document.getElementById('climax-split-divider');
  const clashFx      = document.getElementById('climax-clash-fx');
  const warningEl    = document.getElementById('climax-error-warning');
  const ctaOverlay   = document.getElementById('climax-cta-overlay');
  const hpFill       = document.getElementById('climax-hp-fill');
  const oppHpFill    = document.getElementById('climax-opp-hp-fill');
  const powerFill    = document.getElementById('climax-power-fill');
  const flashFx      = document.getElementById('climax-flash-fx');
  const auraFx       = document.getElementById('climax-aura-fx');
  const finishBanner = document.getElementById('climax-finish-banner');

  const darkenLeft   = document.getElementById('climax-darken-left');
  const darkenRight  = document.getElementById('climax-darken-right');

  if (overlay)      overlay.classList.remove('shake');
  if (bgWrap)       bgWrap.classList.remove('darkened');
  if (darkenLeft)   darkenLeft.classList.remove('show');
  if (darkenRight)  darkenRight.classList.remove('show');
  if (splitDivider) splitDivider.classList.remove('show');
  if (clashFx)      clashFx.classList.remove('active');
  if (oppWrap)      oppWrap.classList.remove('enter-right', 'clash-right', 'blow-away', 'entered');
  if (heroWrap)     heroWrap.classList.remove('enter-left', 'clash-left', 'weak', 'awaken', 'charging-saiyan');
  if (warningEl)    warningEl.classList.remove('show');
  if (ctaOverlay)   ctaOverlay.classList.remove('show');
  if (flashFx)      flashFx.classList.remove('active');
  if (auraFx)       auraFx.classList.remove('show');
  if (finishBanner) finishBanner.classList.remove('show');
  if (hpFill)       hpFill.style.width = '100%';
  if (oppHpFill)    oppHpFill.style.width = '100%';
  if (powerFill)    powerFill.style.width = '0%';

  renderClimaxPreview();
}

/* ── RUN SCRIPT: SPLIT BATTLE & REVENGE CLIMAX ── */
function runClimaxAutomation() {
  resetClimaxAutomation();
  CLIMAX.running = true;
  document.body.classList.add('climax-active-mode');

  // Enter mobile/desktop recording view
  if (window.innerWidth < 1024) {
    openMobileTheater();
  } else {
    enterRecordingMode();
  }

  const climaxOverlay = document.getElementById('climax-theater-overlay');
  if (climaxOverlay) climaxOverlay.classList.add('show');

  const heroNameInput = document.getElementById('climax-hero-name-input');
  const heroLvInput   = document.getElementById('climax-hero-lv-input');
  const oppNameInput  = document.getElementById('climax-opp-name-input');
  const oppLvInput    = document.getElementById('climax-opp-lv-input');
  const line1Input    = document.getElementById('climax-cta-line1-input');
  const line2Input    = document.getElementById('climax-cta-line2-input');

  const heroName = (heroNameInput?.value.trim() || 'POMNI').toUpperCase();
  const heroLv   = heroLvInput?.value.trim()   || 'Lv 20';
  const oppName  = (oppNameInput?.value.trim()  || 'JAX').toUpperCase();
  const oppLv    = oppLvInput?.value.trim()    || 'Lv 67';
  const ctaLine1 = line1Input?.value.trim() || `${heroName} NEEDS POWER!`;
  const ctaLine2 = line2Input?.value.trim() || 'LIKE & SUBSCRIBE TO SAVE HER!';

  document.getElementById('climax-hero-name-display').textContent = heroName;
  document.getElementById('climax-hero-lv-display').textContent   = heroLv;
  document.getElementById('climax-opp-name-display').textContent  = oppName;
  document.getElementById('climax-opp-lv-display').textContent    = oppLv;
  document.getElementById('climax-cta-text-line1').textContent   = ctaLine1;
  document.getElementById('climax-cta-text-line2').textContent   = ctaLine2;

  const bgWrap       = document.getElementById('climax-bg-wrap');
  const oppWrap      = document.getElementById('climax-opponent-wrap');
  const heroWrap     = document.getElementById('climax-hero-wrap');
  const splitDivider = document.getElementById('climax-split-divider');
  const clashFx      = document.getElementById('climax-clash-fx');
  const bgImgEl      = document.getElementById('climax-bg-img');
  const oppImgEl     = document.getElementById('climax-opponent-img');
  const heroImgEl    = document.getElementById('climax-hero-img');

  const warningEl    = document.getElementById('climax-error-warning');
  const ctaOverlay   = document.getElementById('climax-cta-overlay');
  const countdown    = document.getElementById('climax-countdown-box');
  const hpFill       = document.getElementById('climax-hp-fill');
  const oppHpFill    = document.getElementById('climax-opp-hp-fill');
  const powerFill    = document.getElementById('climax-power-fill');
  const powerPct     = document.getElementById('climax-power-pct');
  const flashFx      = document.getElementById('climax-flash-fx');
  const auraFx       = document.getElementById('climax-aura-fx');
  const finishBanner = document.getElementById('climax-finish-banner');

  // Set images (User uploaded or Demo Fallback)
  const heroNormalSrc = CLIMAX.heroNormalImg ? CLIMAX.heroNormalImg.src : (CLIMAX.heroWeakImg ? CLIMAX.heroWeakImg.src : getClimaxFallbackImg('hero-normal'));
  const heroWeakSrc   = CLIMAX.heroWeakImg   ? CLIMAX.heroWeakImg.src   : (CLIMAX.heroNormalImg ? CLIMAX.heroNormalImg.src : getClimaxFallbackImg('hero-weak'));
  const heroStrongSrc = CLIMAX.heroStrongImg ? CLIMAX.heroStrongImg.src : (CLIMAX.heroWeakImg   ? CLIMAX.heroWeakImg.src   : getClimaxFallbackImg('hero-strong'));
  const opponentSrc   = CLIMAX.opponentImg   ? CLIMAX.opponentImg.src   : getClimaxFallbackImg('opponent');

  if (bgWrap) {
    if (CLIMAX.bgImg) {
      bgWrap.style.background = 'none';
      if (bgImgEl) {
        bgImgEl.src = CLIMAX.bgImg.src;
        bgImgEl.style.display = 'block';
      }
    } else {
      if (bgImgEl) bgImgEl.style.display = 'none';
      bgWrap.className = 'climax-bg-wrap ' + (CLIMAX.bgStyle || 'solid-red');
    }
  }

  if (oppImgEl)  oppImgEl.src  = opponentSrc;
  if (heroImgEl) heroImgEl.src = heroNormalSrc;

  // ══════════════════════════════════════════════════════════════
  // GIAI ĐOẠN 1 (Giây 0 - 3s): Màn hình ban đầu KHÔNG CÓ nhân vật nào.
  // 1. Pomni xuất hiện di chuyển từ ngoài bên trái vào.
  // 2. Jax xuất hiện di chuyển từ ngoài bên phải vào (sau 1.2s).
  // ══════════════════════════════════════════════════════════════
  if (splitDivider) splitDivider.classList.add('show');
  if (heroWrap) heroWrap.classList.add('enter-left');
  playSfxSwoosh(true);

  CLIMAX.timers.push(setTimeout(() => {
    if (!CLIMAX.running) return;
    if (oppWrap) oppWrap.classList.add('enter-right', 'entered');
    playSfxSwoosh(true);
  }, 1200));

  // ══════════════════════════════════════════════════════════════
  // GIAI ĐOẠN 2 (Giây 3.5 - 7s): Giao chiến dữ dội (Hất va chạm, tia lửa nhấp nháy 💥)
  // ══════════════════════════════════════════════════════════════
  CLIMAX.timers.push(setTimeout(() => {
    if (!CLIMAX.running) return;

    if (heroWrap) {
      heroWrap.classList.remove('enter-left');
      heroWrap.classList.add('clash-left');
    }
    if (oppWrap) {
      oppWrap.classList.remove('enter-right');
      oppWrap.classList.add('clash-right');
    }
    if (clashFx) clashFx.classList.add('active');

    playSfxImpact();
  }, 3500));

  // ══════════════════════════════════════════════════════════════
  // GIAI ĐOẠN 3 (Giây 7 - 10s): Pomni thua cuộc nằm run rẩy & HP tụt cạn, Cảnh báo nguy cấp
  // ══════════════════════════════════════════════════════════════
  CLIMAX.timers.push(setTimeout(() => {
    if (!CLIMAX.running) return;

    if (clashFx)  clashFx.classList.remove('active');
    if (oppWrap)  oppWrap.classList.remove('clash-right');

    // Chuyển sang ảnh Pomni Thất bại / Thua cuộc
    if (heroImgEl && heroWeakSrc) heroImgEl.src = heroWeakSrc;

    if (heroWrap) {
      heroWrap.classList.remove('clash-left');
      heroWrap.classList.add('weak');
    }

    // Pomni HP Bar drops to 8%
    if (hpFill) hpFill.style.width = '8%';

    // Chỉ tối 1 nửa màn hình phía bên Pomni (Bên Trái) khi Pomni bị thua gục
    const darkenLeft = document.getElementById('climax-darken-left');
    if (darkenLeft) darkenLeft.classList.add('show');

    playClimaxWarningSound();
  }, 7000));

  // ══════════════════════════════════════════════════════════════
  // GIAI ĐOẠN 4 (Giây 10 - 15s): Đếm ngược 5s & Kêu gọi Like/Sub tiếp sức
  // ══════════════════════════════════════════════════════════════
  CLIMAX.timers.push(setTimeout(() => {
    if (!CLIMAX.running) return;

    if (warningEl)  warningEl.classList.remove('show');
    if (ctaOverlay) ctaOverlay.classList.add('show');

    let sec = 5;
    if (countdown) countdown.textContent = sec;

    const countInterval = setInterval(() => {
      if (!CLIMAX.running) {
        clearInterval(countInterval);
        return;
      }
      sec--;
      if (sec >= 0) {
        if (countdown) countdown.textContent = sec;
        const pct = Math.round(((5 - sec) / 5) * 100);
        if (powerFill) powerFill.style.width = pct + '%';
        if (powerPct)  powerPct.textContent  = pct + '%';
        playClimaxBeepSound(sec);
      }
      if (sec <= 0) {
        clearInterval(countInterval);
      }
    }, 1000);
  }, 10000));

  // ══════════════════════════════════════════════════════════════
  // GIAI ĐOẠN 5 (Giây 15 - 18s): Gồng nhận sức mạnh kiểu Songoku & Level tăng từ level hiện tại lên 999
  // ══════════════════════════════════════════════════════════════
  CLIMAX.timers.push(setTimeout(() => {
    if (!CLIMAX.running) return;

    if (ctaOverlay) ctaOverlay.classList.remove('show');

    // Tắt tối bên trái của Hero
    const darkenLeft  = document.getElementById('climax-darken-left');
    const darkenRight = document.getElementById('climax-darken-right');
    if (darkenLeft) darkenLeft.classList.remove('show');

    // 1. Pomni vào tư thế Gồng nhận sức mạnh (Super Saiyan Charge)
    if (heroWrap) {
      heroWrap.classList.remove('weak');
      heroWrap.classList.add('charging-saiyan');
    }
    if (auraFx) auraFx.classList.add('show');

    // 2. Chữ Level bùng nổ hiệu ứng ánh sáng
    const heroLvDisplay = document.getElementById('climax-hero-lv-display');
    if (heroLvDisplay) heroLvDisplay.classList.add('lv-power-burst');

    // Tăng Level liên tục từ Level hiện tại -> Level 999
    const startLvNum = parseInt((heroLv || '').replace(/\D/g, '')) || 20;
    const targetLvNum = 999;
    const chargeDuration = 2500; // 2.5 giây gồng nhận năng lượng
    const startTime = Date.now();

    playClimaxChargingSound(2.5);

    const lvInterval = setInterval(() => {
      if (!CLIMAX.running) {
        clearInterval(lvInterval);
        return;
      }
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / chargeDuration);
      
      // Đường cong tăng tốc Level
      const currentLv = Math.floor(startLvNum + (targetLvNum - startLvNum) * Math.pow(progress, 2.2));
      
      if (heroLvDisplay) heroLvDisplay.textContent = 'Lv ' + currentLv;

      // Hồi lại thanh máu của Hero
      if (hpFill) {
        const recoverPct = Math.min(100, Math.floor(8 + progress * 92));
        hpFill.style.width = recoverPct + '%';
      }

      if (progress >= 1) {
        clearInterval(lvInterval);
        if (heroLvDisplay) heroLvDisplay.textContent = 'Lv 999';
        if (hpFill) hpFill.style.width = '100%';
      }
    }, 30);

    // ══════════════════════════════════════════════════════════════
    // GIAI ĐOẠN 5.5 (Sau khi đạt Lv 999): Bùng nổ chiêu thức ĐÁNH BAY Jax & Máu Jax về 0
    // ══════════════════════════════════════════════════════════════
    CLIMAX.timers.push(setTimeout(() => {
      if (!CLIMAX.running) return;

      // Pomni đổi sang dạng Thức tỉnh (Awaken Form)
      if (heroWrap) {
        heroWrap.classList.remove('charging-saiyan');
        heroWrap.classList.add('awaken');
      }
      if (heroImgEl && heroStrongSrc) heroImgEl.src = heroStrongSrc;

      // Chớp sáng nổ tung cực đại + Rung chấn
      if (flashFx) {
        flashFx.classList.add('active');
        setTimeout(() => flashFx.classList.remove('active'), 350);
      }
      if (climaxOverlay) climaxOverlay.classList.add('shake');
      playClimaxExplosionSound();

      // Máu của Jax bị bùng nổ tụt về 0%, tối bên Jax và Jax bị đánh bay ra ngoài
      if (darkenRight) darkenRight.classList.add('show');
      if (oppHpFill)   oppHpFill.style.width = '0%';
      if (oppWrap)     oppWrap.classList.add('blow-away');
    }, 2600));

  }, 15000));

  // ══════════════════════════════════════════════════════════════
  // GIAI ĐOẠN 6 (Giây 21 - 25s): Màn ăn mừng chiến thắng rực rỡ (Victory KO Celebration)
  // ══════════════════════════════════════════════════════════════
  CLIMAX.timers.push(setTimeout(() => {
    if (!CLIMAX.running) return;

    if (finishBanner) {
      finishBanner.querySelector('.finish-title').textContent = 'VICTORY KO!';
      finishBanner.querySelector('.finish-sub').textContent   = `${heroName} DEFEATED ${oppName}! 🏆`;
      finishBanner.classList.add('show');
    }
    playSfxReveal();
  }, 21000));
}

/* ── Web Audio Synth Sounds for Climax Mode ── */
function playClimaxWarningSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {}
}

function playClimaxBeepSound(sec) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    const freq = sec === 0 ? 1200 : (600 + (5 - sec) * 100);
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch (e) {}
}

function playClimaxExplosionSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.8);
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.8);
  } catch (e) {}
}

function playClimaxChargingSound(durationSec) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + (durationSec || 2.5));
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + (durationSec || 2.5) * 0.8);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + (durationSec || 2.5));
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + (durationSec || 2.5));
  } catch (e) {}
}

/* ──────────────────────────────────────────────────────────────
   BLEND + MODULE (MULTI-STREAM INDEPENDENT FUSION BLEND)
   Mỗi luồng: { charImg, emojiImg, resultImg }
   Hiệu ứng blend: Fusion. Không dùng hiệu ứng xuất hiện kết quả (none).
   Chuyển luồng: Giữ kết quả ~2.5s rồi chuyển mượt sang luồng kế tiếp.
   ────────────────────────────────────────────────────────────── */

const BP = {
  streams: [
    { charImg: null, emojiImg: null, resultImg: null }
  ],
  running: false,
  streamIdx: 0,
  timer: null
};

function syncBpVal(type) {
  if (type === 'swirl') {
    const el = document.getElementById('sl-bp-swirl');
    const val = document.getElementById('val-bp-swirl');
    if (el && val) val.textContent = el.value;
  } else if (type === 'speed') {
    const el = document.getElementById('sl-bp-speed');
    const val = document.getElementById('val-bp-speed');
    if (el && val) val.textContent = el.value;
  }
}

function addBpStream() {
  BP.streams.push({ charImg: null, emojiImg: null, resultImg: null });
  renderBpTable();
  const tbody = document.getElementById('bp-table-body');
  if (tbody && tbody.lastElementChild) {
    tbody.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function removeBpStream(index) {
  if (BP.streams.length <= 1) {
    BP.streams = [{ charImg: null, emojiImg: null, resultImg: null }];
  } else {
    BP.streams.splice(index, 1);
  }
  renderBpTable();
  updateBpPreview();
}

function clearAllBpStreams() {
  BP.streams = [
    { charImg: null, emojiImg: null, resultImg: null }
  ];
  resetAll();
  renderBpTable();
  updateBpPreview();
}

// Tải nhiều ảnh và đổ lần lượt vào tất cả các ô trống (Nhân vật -> Emoji -> Ảnh mới) theo thứ tự
function loadBpFilesIntoAllSlots(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return;

  let loaded = 0;
  const loadedImgs = [];

  imageFiles.forEach((file, fIdx) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        loadedImgs[fIdx] = img;
        loaded++;
        if (loaded === imageFiles.length) {
          // Duyệt và đổ vào các ô theo hàng ngang: stream 0 (char -> emoji -> result), stream 1, ...
          let currentStreamIdx = 0;
          let currentSlotType = 'char'; // 'char' | 'emoji' | 'result'

          // Tìm ô trống đầu tiên để bắt đầu đổ
          let foundStart = false;
          for (let s = 0; s < BP.streams.length; s++) {
            if (!BP.streams[s].charImg) {
              currentStreamIdx = s; currentSlotType = 'char'; foundStart = true; break;
            }
            if (!BP.streams[s].emojiImg) {
              currentStreamIdx = s; currentSlotType = 'emoji'; foundStart = true; break;
            }
            if (!BP.streams[s].resultImg) {
              currentStreamIdx = s; currentSlotType = 'result'; foundStart = true; break;
            }
          }
          if (!foundStart) {
            currentStreamIdx = BP.streams.length;
            currentSlotType = 'char';
          }

          loadedImgs.forEach(imageObj => {
            while (BP.streams.length <= currentStreamIdx) {
              BP.streams.push({ charImg: null, emojiImg: null, resultImg: null });
            }

            if (currentSlotType === 'char') {
              BP.streams[currentStreamIdx].charImg = imageObj;
              currentSlotType = 'emoji';
            } else if (currentSlotType === 'emoji') {
              BP.streams[currentStreamIdx].emojiImg = imageObj;
              currentSlotType = 'result';
            } else if (currentSlotType === 'result') {
              BP.streams[currentStreamIdx].resultImg = imageObj;
              currentSlotType = 'char';
              currentStreamIdx++;
            }
          });

          renderBpTable();
          updateBpPreview();
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function loadBpFilesIntoColumn(type, files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (imageFiles.length === 0) return;

  let loaded = 0;
  const loadedImgs = [];

  imageFiles.forEach((file, fIdx) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        loadedImgs[fIdx] = img;
        loaded++;
        if (loaded === imageFiles.length) {
          // Gán lần lượt ảnh vào các stream từ stream đầu tiên
          loadedImgs.forEach((imageObj, i) => {
            if (!BP.streams[i]) {
              BP.streams.push({ charImg: null, emojiImg: null, resultImg: null });
            }
            if (type === 'char')   BP.streams[i].charImg = imageObj;
            if (type === 'emoji')  BP.streams[i].emojiImg = imageObj;
            if (type === 'result') BP.streams[i].resultImg = imageObj;
          });
          renderBpTable();
          updateBpPreview();
        }
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// Global drag state for Blend + items (hỗ trợ kéo thả giữa bất kỳ ô/hàng nào)
const BP_DRAG = {
  type: null, // 'char' | 'emoji' | 'result'
  fromIdx: null
};

function attachBpColDrag(wrap, type, idx, cell) {
  wrap.draggable = true;

  wrap.addEventListener('dragstart', e => {
    e.stopPropagation();
    BP_DRAG.type = type;
    BP_DRAG.fromIdx = idx;
    wrap.classList.add('bt-col-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(new Image(), 0, 0);
  });

  wrap.addEventListener('dragend', e => {
    e.stopPropagation();
    wrap.classList.remove('bt-col-dragging');
    document.querySelectorAll('.bt-cell-over, .drag-over').forEach(c => c.classList.remove('bt-cell-over', 'drag-over'));
    BP_DRAG.type = null;
    BP_DRAG.fromIdx = null;
  });

  cell.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('Files')) return;
    if (!BP_DRAG.type || (BP_DRAG.fromIdx === idx && BP_DRAG.type === type)) return;
    e.preventDefault();
    e.stopPropagation();
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
    wrap.classList.remove('drag-over');
    const fromIdx = BP_DRAG.fromIdx;
    const fromType = BP_DRAG.type;
    if (!fromType || fromIdx === null || (fromIdx === idx && fromType === type)) return;

    // Hoán đổi ảnh giữa ô nguồn (fromIdx, fromType) và ô đích (idx, type)
    const fromProp = fromType === 'char' ? 'charImg' : fromType === 'emoji' ? 'emojiImg' : 'resultImg';
    const targetProp = type === 'char' ? 'charImg' : type === 'emoji' ? 'emojiImg' : 'resultImg';

    const temp = BP.streams[fromIdx][fromProp];
    BP.streams[fromIdx][fromProp] = BP.streams[idx][targetProp];
    BP.streams[idx][targetProp] = temp;

    BP_DRAG.type = null;
    BP_DRAG.fromIdx = null;
    renderBpTable();
    updateBpPreview();
  });
}

function attachBpCellDropTarget(cell, type, idx) {
  cell.addEventListener('dragover', e => {
    if (e.dataTransfer.types.includes('Files')) return;
    if (!BP_DRAG.type || (BP_DRAG.fromIdx === idx && BP_DRAG.type === type)) return;
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
    const fromIdx = BP_DRAG.fromIdx;
    const fromType = BP_DRAG.type;
    if (!fromType || fromIdx === null || (fromIdx === idx && fromType === type)) return;

    const fromProp = fromType === 'char' ? 'charImg' : fromType === 'emoji' ? 'emojiImg' : 'resultImg';
    const targetProp = type === 'char' ? 'charImg' : type === 'emoji' ? 'emojiImg' : 'resultImg';

    const temp = BP.streams[fromIdx][fromProp];
    BP.streams[fromIdx][fromProp] = BP.streams[idx][targetProp];
    BP.streams[idx][targetProp] = temp;

    BP_DRAG.type = null;
    BP_DRAG.fromIdx = null;
    renderBpTable();
    updateBpPreview();
  });
}

function pickBpFile(streamIdx, type) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = (e) => {
    const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    if (files.length === 1) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
          if (!BP.streams[streamIdx]) return;
          if (type === 'char')   BP.streams[streamIdx].charImg = img;
          if (type === 'emoji')  BP.streams[streamIdx].emojiImg = img;
          if (type === 'result') BP.streams[streamIdx].resultImg = img;
          renderBpTable();
          updateBpPreview();
        };
        img.src = ev.target.result;
      };
      reader.readAsDataURL(files[0]);
    } else {
      // Tải nhiều ảnh: đổ tiếp nối vào các ô (từ ô hiện tại sang ô tiếp theo)
      let loaded = 0;
      const loadedImgs = [];
      files.forEach((file, fIdx) => {
        const reader = new FileReader();
        reader.onload = ev => {
          const img = new Image();
          img.onload = () => {
            loadedImgs[fIdx] = img;
            loaded++;
            if (loaded === files.length) {
              let curStream = streamIdx;
              let curSlot = type;
              loadedImgs.forEach(imageObj => {
                while (BP.streams.length <= curStream) {
                  BP.streams.push({ charImg: null, emojiImg: null, resultImg: null });
                }
                if (curSlot === 'char') {
                  BP.streams[curStream].charImg = imageObj;
                  curSlot = 'emoji';
                } else if (curSlot === 'emoji') {
                  BP.streams[curStream].emojiImg = imageObj;
                  curSlot = 'result';
                } else if (curSlot === 'result') {
                  BP.streams[curStream].resultImg = imageObj;
                  curSlot = 'char';
                  curStream++;
                }
              });
              renderBpTable();
              updateBpPreview();
            }
          };
          img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    }
  };
  input.click();
}

function clearBpSlot(streamIdx, type) {
  if (!BP.streams[streamIdx]) return;
  if (type === 'char')   BP.streams[streamIdx].charImg = null;
  if (type === 'emoji')  BP.streams[streamIdx].emojiImg = null;
  if (type === 'result') BP.streams[streamIdx].resultImg = null;
  renderBpTable();
  updateBpPreview();
}

function renderBpTable() {
  const tbody = document.getElementById('bp-table-body');
  const countEl = document.getElementById('bp-streams-count');
  const emptyHint = document.getElementById('bp-empty-hint');
  if (!tbody) return;

  const total = BP.streams.length;
  if (countEl) countEl.textContent = total ? `(${total} luồng)` : '';
  if (emptyHint) emptyHint.style.display = total === 0 ? 'flex' : 'none';

  tbody.innerHTML = '';

  BP.streams.forEach((stream, idx) => {
    const row = document.createElement('div');
    row.className = 'bp-stream-row';
    row.id = `bp-stream-row-${idx}`;

    // Col 1: Character
    const colChar = document.createElement('div');
    colChar.className = 'bp-cell bp-cell-char';
    if (stream.charImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bp-img-wrap';
      wrap.title = 'Kéo để đổi vị trí sang bất kỳ ô/hàng nào';
      const img = document.createElement('img');
      img.src = stream.charImg.src;
      img.draggable = false;
      const badge = document.createElement('span');
      badge.className = 'bp-img-badge';
      badge.textContent = `L${idx + 1}`;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.title = 'Xóa ảnh nhân vật';
      del.onclick = (e) => { e.stopPropagation(); clearBpSlot(idx, 'char'); };
      wrap.appendChild(img);
      wrap.appendChild(badge);
      wrap.appendChild(del);
      colChar.appendChild(wrap);
      attachBpColDrag(wrap, 'char', idx, colChar);
    } else {
      colChar.innerHTML = `
        <div class="bp-slot-empty" onclick="pickBpFile(${idx}, 'char')" title="Click chọn 1 hoặc nhiều ảnh">
          <i class="fa-solid fa-plus"></i><span>Nhân vật</span>
        </div>
      `;
      attachBpCellDropTarget(colChar, 'char', idx);
    }

    // Col 2: Emoji
    const colEmoji = document.createElement('div');
    colEmoji.className = 'bp-cell bp-cell-emoji';
    if (stream.emojiImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bp-img-wrap';
      wrap.title = 'Kéo để đổi vị trí sang bất kỳ ô/hàng nào';
      const img = document.createElement('img');
      img.src = stream.emojiImg.src;
      img.draggable = false;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.title = 'Xóa emoji';
      del.onclick = (e) => { e.stopPropagation(); clearBpSlot(idx, 'emoji'); };
      wrap.appendChild(img);
      wrap.appendChild(del);
      colEmoji.appendChild(wrap);
      attachBpColDrag(wrap, 'emoji', idx, colEmoji);
    } else {
      colEmoji.innerHTML = `
        <div class="bp-slot-empty" onclick="pickBpFile(${idx}, 'emoji')" title="Click chọn 1 hoặc nhiều ảnh">
          <i class="fa-solid fa-plus"></i><span>Emoji</span>
        </div>
      `;
      attachBpCellDropTarget(colEmoji, 'emoji', idx);
    }

    // Col 3: New Result Image
    const colResult = document.createElement('div');
    colResult.className = 'bp-cell bp-cell-result';
    if (stream.resultImg) {
      const wrap = document.createElement('div');
      wrap.className = 'bp-img-wrap bp-img-result';
      wrap.title = 'Kéo để đổi vị trí sang bất kỳ ô/hàng nào';
      const img = document.createElement('img');
      img.src = stream.resultImg.src;
      img.draggable = false;
      const del = document.createElement('button');
      del.className = 'bt-img-del';
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.title = 'Xóa ảnh mới';
      del.onclick = (e) => { e.stopPropagation(); clearBpSlot(idx, 'result'); };
      wrap.appendChild(img);
      wrap.appendChild(del);
      colResult.appendChild(wrap);
      attachBpColDrag(wrap, 'result', idx, colResult);
    } else {
      colResult.innerHTML = `
        <div class="bp-slot-empty" onclick="pickBpFile(${idx}, 'result')" title="Click chọn 1 hoặc nhiều ảnh">
          <i class="fa-solid fa-plus"></i><span>Ảnh mới</span>
        </div>
      `;
      attachBpCellDropTarget(colResult, 'result', idx);
    }

    // Col 4: Action (Delete stream row)
    const colAction = document.createElement('div');
    colAction.className = 'bp-cell bp-cell-action';
    colAction.innerHTML = `
      <button type="button" class="bp-del-btn" title="Xóa luồng này" onclick="removeBpStream(${idx})">
        <i class="fa-solid fa-trash-can"></i>
      </button>
    `;

    row.appendChild(colChar);
    row.appendChild(colEmoji);
    row.appendChild(colResult);
    row.appendChild(colAction);
    tbody.appendChild(row);
  });

  refreshEmojiHeader();
}

// Lắng nghe sự kiện tải nhiều ảnh từ các input ẩn của Blend +
(function initBpMultiInputs() {
  const allInput = document.getElementById('bp-all-multi-input');
  const charInput = document.getElementById('bp-char-multi-input');
  const emojiInput = document.getElementById('bp-emoji-multi-input');
  const resultInput = document.getElementById('bp-result-multi-input');

  if (allInput) {
    allInput.addEventListener('change', e => {
      loadBpFilesIntoAllSlots(e.target.files);
      e.target.value = '';
    });
  }
  if (charInput) {
    charInput.addEventListener('change', e => {
      loadBpFilesIntoColumn('char', e.target.files);
      e.target.value = '';
    });
  }
  if (emojiInput) {
    emojiInput.addEventListener('change', e => {
      loadBpFilesIntoColumn('emoji', e.target.files);
      e.target.value = '';
    });
  }
  if (resultInput) {
    resultInput.addEventListener('change', e => {
      loadBpFilesIntoColumn('result', e.target.files);
      e.target.value = '';
    });
  }

  const btnAll = document.getElementById('bp-btn-upload-all');
  const btnChar = document.getElementById('bp-btn-upload-chars');
  const btnEmoji = document.getElementById('bp-btn-upload-emojis');
  const btnResult = document.getElementById('bp-btn-upload-results');

  if (btnAll) btnAll.addEventListener('click', () => allInput?.click());
  if (btnChar) btnChar.addEventListener('click', () => charInput?.click());
  if (btnEmoji) btnEmoji.addEventListener('click', () => emojiInput?.click());
  if (btnResult) btnResult.addEventListener('click', () => resultInput?.click());
})();

function updateBpPreview() {
  if (activeTab !== 'blendplus' || BP.running) return;
  // If first stream has charImg, display as theater background
  const firstChar = BP.streams[0]?.charImg;
  if (firstChar) {
    bgCharImg.src = firstChar.src;
    bgCharWrap.classList.add('show');
  } else {
    bgCharWrap.classList.remove('show');
  }
  refreshEmojiHeader();
}

/* ── RUN BLEND + FLOW ── */
function runBlendPlus() {
  if (BP.running) {
    resetAll();
    return;
  }

  // Validate streams: only consider fully filled streams
  const validStreams = BP.streams.filter(s => s.charImg && s.emojiImg && s.resultImg);
  if (validStreams.length === 0) {
    toast('Cần ít nhất 1 luồng có đủ: Nhân vật + Emoji + Ảnh mới! ✨');
    return;
  }

  BP.running = true;
  BP.streamIdx = 0;

  const btn = document.getElementById('btn-bp-blend');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-square"></i> Dừng Blend +';

  const finalGridWrap = document.getElementById('final-grid-wrap');
  if (finalGridWrap) finalGridWrap.classList.remove('show');

  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) emojiHeaderBar.classList.remove('hidden');

  buildPhaseBar(validStreams.length);

  // Desktop recording mode or mobile theater
  if (window.innerWidth < 1024) {
    openMobileTheater();
    startBpStreamSequence(validStreams, 0);
  } else {
    enterRecordingMode();
    setTimeout(() => {
      if (BP.running) startBpStreamSequence(validStreams, 0);
    }, 1200);
  }
}

function startBpStreamSequence(validStreams, sIdx) {
  if (!BP.running) return;
  if (sIdx >= validStreams.length) {
    finishBlendPlus();
    return;
  }

  const stream = validStreams[sIdx];
  BP.streamIdx = sIdx;

  // Highlight active row in UI
  document.querySelectorAll('.bp-stream-row').forEach((row, i) => {
    row.classList.remove('active-blend', 'done-blend');
    if (BP.streams[i] === stream) {
      row.classList.add('active-blend');
    } else if (BP.streams[i] && validStreams.indexOf(BP.streams[i]) >= 0 && validStreams.indexOf(BP.streams[i]) < sIdx) {
      row.classList.add('done-blend');
    }
  });

  setPhase(sIdx, validStreams.length);
  updateEmojiHeaderState(sIdx);

  syncCanvasSize();
  resultWrap.classList.remove('show', 'reveal-eraser', 'reveal-classic');
  canvas.classList.remove('visible');
  canvas.style.opacity = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const resBadge = document.getElementById('result-badge');
  if (resBadge) resBadge.classList.remove('show');

  // Set theater layers for this stream
  bgCharImg.src = stream.charImg.src;
  bgCharWrap.classList.add('show');

  flyImg1.src = stream.charImg.src;
  flyImg2.src = stream.emojiImg.src;

  setFlyStyle(fly1, { top: '-60%', left: '50%', transform: 'translateX(-50%)', opacity: '0', bottom: 'auto', right: 'auto' });
  setFlyStyle(fly2, { bottom: '-60%', left: '50%', transform: 'translateX(-50%)', opacity: '0', top: 'auto', right: 'auto' });

  // Store runtime refs
  S._currentCharImg = stream.charImg;
  S._currentEmojiImg = stream.emojiImg;
  S._currentResultImg = stream.resultImg;
  S._currentStepStyle = 'fusion';

  // Ảnh đầu tiên (nhân vật) xuất hiện, đợi khoảng 2s (tùy chỉnh) thì mới tới lượt emoji bay vào
  const charWaitSec = parseFloat(document.getElementById('bp-char-wait-sec')?.value || '2.0');
  const charWaitMs = Math.max(300, charWaitSec * 1000);

  BP.timer = setTimeout(() => {
    if (!BP.running) return;
    phaseBpFlyEmoji(validStreams, sIdx);
  }, charWaitMs);
}

function phaseBpFlyEmoji(validStreams, sIdx) {
  if (!BP.running) return;
  fly2.style.opacity = '1';
  playSfxSwoosh(true);

  const directions = ['bottom', 'top', 'left', 'right'];
  currentDir = directions[Math.floor(Math.random() * directions.length)];

  setFlyStyle(fly2, { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto', transform: 'none' });

  if (currentDir === 'bottom') {
    setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', bottom: '-60%' });
    animateDir(fly2, 'bottom', -60, 38, 750, () => setTimeout(() => phaseBpCollision(validStreams, sIdx), 150));
  } else if (currentDir === 'top') {
    setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', top: '-60%' });
    animateDir(fly2, 'top', -60, 38, 750, () => setTimeout(() => phaseBpCollision(validStreams, sIdx), 150));
  } else if (currentDir === 'left') {
    setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', left: '-60%' });
    animateDir(fly2, 'left', -60, 22.5, 750, () => setTimeout(() => phaseBpCollision(validStreams, sIdx), 150));
  } else if (currentDir === 'right') {
    setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', right: '-60%' });
    animateDir(fly2, 'right', -60, 22.5, 750, () => setTimeout(() => phaseBpCollision(validStreams, sIdx), 150));
  }
}

function phaseBpCollision(validStreams, sIdx) {
  if (!BP.running) return;

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

  syncCanvasSize();
  renderFrame(0);

  bgCharWrap.classList.remove('show');
  canvas.classList.add('visible');

  // Dynamic fusion absorb spin
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

  startBpSwirlLoop(() => {
    phaseBpShowResult(validStreams, sIdx);
  });
}

function startBpSwirlLoop(onDone) {
  S.time = 0;
  let elapsed = 0;
  const totalMs = 1600; // Fast smooth fusion vortex
  const speed = parseFloat(document.getElementById('sl-bp-speed')?.value || '7');
  const swirlVal = parseFloat(document.getElementById('sl-bp-swirl')?.value || '100') / 100;

  function loop() {
    if (!BP.running) return;
    const progress = Math.min(1, elapsed / totalMs);
    renderBpFrame(progress, swirlVal);
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

function renderBpFrame(progress, swirl) {
  const W = canvas.width, H = canvas.height;
  const offA = drawToOff(S._currentCharImg, W, H);
  const offB = drawToOff(S._currentResultImg, W, H);
  const pxA = offA.getImageData(0, 0, W, H).data;
  const pxB = offB.getImageData(0, 0, W, H).data;
  const out = ctx.createImageData(W, H);

  // Blend char -> result with Fusion effect
  fxFusion(pxA, pxB, out.data, W, H, S.time, progress, swirl);
  ctx.putImageData(out, 0, 0);
}

function phaseBpShowResult(validStreams, sIdx) {
  if (!BP.running) return;

  fly1.style.opacity = '0';
  fly2.style.opacity = '0';

  // Hiệu ứng blend sử dụng Fusion, không dùng hiệu ứng xuất hiện kết quả (none)
  resultWrap.classList.remove('reveal-eraser', 'reveal-classic');
  resultImg.src = S._currentResultImg.src;
  resultWrap.classList.add('show');

  canvas.classList.remove('visible');
  canvas.style.transition = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  canvas.style.opacity = '';

  playSfxReveal();

  const pauseSec = parseFloat(document.getElementById('bp-pause-sec')?.value || '2.5');
  const pauseMs = Math.max(500, pauseSec * 1000);

  // Giữ kết quả trên màn hình theo thời gian cài đặt (~2.5s) rồi chuyển sang luồng tiếp theo
  BP.timer = setTimeout(() => {
    if (!BP.running) return;
    startBpStreamSequence(validStreams, sIdx + 1);
  }, pauseMs);
}

function finishBlendPlus() {
  BP.running = false;
  const btn = document.getElementById('btn-bp-blend');
  if (btn) btn.innerHTML = '<i class="fa-solid fa-wand-magic-sparkles"></i> Bắt đầu Blend +';

  document.querySelectorAll('.bp-stream-row').forEach(row => {
    row.classList.remove('active-blend');
    row.classList.add('done-blend');
  });

  setPhase(BP.streams.length, BP.streams.length);
  updateEmojiHeaderState(-1);
}
