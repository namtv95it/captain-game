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
const S = {
  charImg:   null,          // Ảnh nhân vật gốc
  steps:     [],            // Array of { emojiImg, resultImg } (up to 4)
  stepCount: 1,             // Current number of blend steps rendered
  style:     'marble',
  animId:    null,
  running:   false,
  time:      0,
  chainIdx:  0,             // current step index being blended
  chainPrev: null,          // Image used as "character" in current chain step
  lastResultImg: null,      // Last completed result image object
};

/* ─────────────────────── DOM ─────────────────────── */
const canvas         = document.getElementById('blend-canvas');
const ctx            = canvas.getContext('2d');
const theater        = document.getElementById('theater');
const fly1           = document.getElementById('fly-1');
const fly2           = document.getElementById('fly-2');
const flyImg1        = document.getElementById('fly-img-1');
const flyImg2        = document.getElementById('fly-img-2');
const resultWrap     = document.getElementById('result-reveal');
const resultImg      = document.getElementById('result-img');
const bgCharWrap     = document.getElementById('bg-char-wrap');
const bgCharImg      = document.getElementById('bg-char-img');
const toastEl        = document.getElementById('toast');
const stepLabelOv    = document.getElementById('step-label-overlay');
const emojiHeaderEl  = document.getElementById('emoji-header-inner');
const emojiPlaceholder = document.getElementById('emoji-header-placeholder');
const phaseBar       = document.getElementById('phase-bar');

/* ─────────────────────── CHARACTER UPLOAD ─────────────────────── */
function pickFile(n) {
  document.getElementById(`file-${n}`).click();
}

const charInput = document.getElementById('file-1');
const charCard  = document.getElementById('card-1');

charInput.addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) loadCharSlot(f);
});

charCard.addEventListener('dragover',  e => { e.preventDefault(); charCard.classList.add('drag-over'); });
charCard.addEventListener('dragleave', ()  => charCard.classList.remove('drag-over'));
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
    document.getElementById('prev-1').style.display  = 'none';
    document.getElementById('file-1').value           = '';
    bgCharWrap.classList.remove('show');
    bgCharImg.src = '';
    resetAll();
  }
}

/* ─────────────────────── MULTI-STEP UI ─────────────────────── */

// Steps data store: indexed by step index (0-based)
// S.steps[i] = { emojiImg: Image|null, resultImg: Image|null }
// Initialize 4 steps by default
S.steps = [
  { emojiImg: null, resultImg: null },
  { emojiImg: null, resultImg: null },
  { emojiImg: null, resultImg: null },
  { emojiImg: null, resultImg: null }
];
S.stepCount = 4;

function addStep() {
  if (S.stepCount >= 4) {
    toast('Tối đa 4 bước blend! 🎯');
    return;
  }
  const idx = S.stepCount;
  S.steps.push({ emojiImg: null, resultImg: null });
  S.stepCount++;

  const html = `
    <div class="blend-step" id="step-${idx}" data-index="${idx}">
      <div class="step-header">
        <span class="step-badge">Bước ${idx + 1}</span>
        <button class="step-remove-btn" onclick="removeStep(${idx})" title="Xóa bước">✕</button>
      </div>
      <div class="step-row">
        <div class="step-card step-emoji" id="emoji-card-${idx}" onclick="pickStepFile(${idx},'emoji')">
          <input type="file" id="emoji-file-${idx}" accept="image/*" hidden />
          <div class="step-empty" id="emoji-body-${idx}">
            <div class="step-empty-icon">🌟</div>
            <div class="step-empty-hint">Emoji</div>
          </div>
          <div class="step-preview" id="emoji-prev-${idx}" style="display:none">
            <img id="emoji-img-${idx}" alt="emoji" />
            <button class="x-btn x-btn-sm" onclick="clearStepSlot(event,${idx},'emoji')">✕</button>
          </div>
        </div>
        <div class="step-arrow">→</div>
        <div class="step-card step-result" id="result-card-${idx}" onclick="pickStepFile(${idx},'result')">
          <input type="file" id="result-file-${idx}" accept="image/*" hidden />
          <div class="step-empty" id="result-body-${idx}">
            <div class="step-empty-icon">🎁</div>
            <div class="step-empty-hint">Kết quả</div>
          </div>
          <div class="step-preview" id="result-prev-${idx}" style="display:none">
            <img id="result-img-${idx}" alt="result" />
            <button class="x-btn x-btn-sm" onclick="clearStepSlot(event,${idx},'result')">✕</button>
          </div>
        </div>
      </div>
    </div>`;

  document.getElementById('steps-list').insertAdjacentHTML('beforeend', html);

  // Attach file listener
  attachStepFileListeners(idx);

  // Disable add button if maxed
  if (S.stepCount >= 4) {
    document.getElementById('add-step-btn').disabled = true;
  }
}

function removeStep(idx) {
  if (S.stepCount <= 1) {
    toast('Cần ít nhất 1 bước blend! 🎯');
    return;
  }
  // Remove from DOM
  const el = document.getElementById(`step-${idx}`);
  if (el) el.remove();

  // Rebuild steps array and re-index DOM
  S.steps.splice(idx, 1);
  S.stepCount--;

  // Re-label remaining steps
  const stepEls = document.querySelectorAll('.blend-step');
  stepEls.forEach((el, i) => {
    el.id = `step-${i}`;
    el.dataset.index = i;
    el.querySelector('.step-badge').textContent = `Bước ${i + 1}`;
    el.querySelector('.step-remove-btn').setAttribute('onclick', `removeStep(${i})`);

    const emojiCard = el.querySelector('[id^="emoji-card-"]');
    const resultCard = el.querySelector('[id^="result-card-"]');
    const emojiFile = el.querySelector('[id^="emoji-file-"]');
    const resultFile = el.querySelector('[id^="result-file-"]');
    const emojiBody = el.querySelector('[id^="emoji-body-"]');
    const resultBody = el.querySelector('[id^="result-body-"]');
    const emojiPrev = el.querySelector('[id^="emoji-prev-"]');
    const resultPrev = el.querySelector('[id^="result-prev-"]');
    const emojiImgEl = el.querySelector('[id^="emoji-img-"]');
    const resultImgEl = el.querySelector('[id^="result-img-"]');
    const emojiXBtn = emojiPrev?.querySelector('.x-btn');
    const resultXBtn = resultPrev?.querySelector('.x-btn');

    if (emojiCard) {
      emojiCard.id = `emoji-card-${i}`;
      emojiCard.setAttribute('onclick', `pickStepFile(${i},'emoji')`);
    }
    if (resultCard) {
      resultCard.id = `result-card-${i}`;
      resultCard.setAttribute('onclick', `pickStepFile(${i},'result')`);
    }
    if (emojiFile) emojiFile.id = `emoji-file-${i}`;
    if (resultFile) resultFile.id = `result-file-${i}`;
    if (emojiBody) emojiBody.id = `emoji-body-${i}`;
    if (resultBody) resultBody.id = `result-body-${i}`;
    if (emojiPrev) emojiPrev.id = `emoji-prev-${i}`;
    if (resultPrev) resultPrev.id = `result-prev-${i}`;
    if (emojiImgEl) emojiImgEl.id = `emoji-img-${i}`;
    if (resultImgEl) resultImgEl.id = `result-img-${i}`;
    if (emojiXBtn) emojiXBtn.setAttribute('onclick', `clearStepSlot(event,${i},'emoji')`);
    if (resultXBtn) resultXBtn.setAttribute('onclick', `clearStepSlot(event,${i},'result')`);

    // Re-attach file listeners by replacing input elements
    attachStepFileListeners(i);
  });

  document.getElementById('add-step-btn').disabled = false;
  refreshEmojiHeader();
}

function attachStepFileListeners(idx) {
  // Use a data attribute trick to avoid duplicate listeners
  const emojiInput = document.getElementById(`emoji-file-${idx}`);
  const resultInput = document.getElementById(`result-file-${idx}`);
  if (emojiInput) {
    const newEmojiInput = emojiInput.cloneNode(true);
    emojiInput.replaceWith(newEmojiInput);
    newEmojiInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) loadStepSlot(idx, 'emoji', f);
    });
  }
  if (resultInput) {
    const newResultInput = resultInput.cloneNode(true);
    resultInput.replaceWith(newResultInput);
    newResultInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) loadStepSlot(idx, 'result', f);
    });
  }
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
function refreshEmojiHeader() {
  // Collect all emoji images that have been uploaded
  const uploaded = S.steps
    .map((s, i) => ({ idx: i, img: s.emojiImg }))
    .filter(s => s.img !== null);

  if (uploaded.length === 0) {
    emojiHeaderEl.innerHTML = '';
    const ph = document.createElement('span');
    ph.className = 'emoji-header-placeholder';
    ph.id = 'emoji-header-placeholder';
    ph.textContent = 'Emoji sẽ hiển thị ở đây sau khi tải lên ✨';
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
    badge.textContent = idx + 1;

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
}

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
  for (let i = 0; i < totalSteps; i++) labels.push(`Bước ${i+1}`);
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
    if (i < p)       step.classList.add('done');
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

  canvas.classList.remove('visible');
  canvas.style.opacity = '';
  canvas.style.transition = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resultWrap.classList.remove('show');

  bgCharWrap.classList.remove('show');
  if (S.charImg) {
    bgCharImg.src = S.charImg.src;
    bgCharWrap.classList.add('show');
  }

  // stepLabelOv hidden

  const finalGridWrap = document.getElementById('final-grid-wrap');
  if (finalGridWrap) finalGridWrap.classList.remove('show');

  const emojiHeaderBar = document.getElementById('emoji-header-bar');
  if (emojiHeaderBar) emojiHeaderBar.classList.remove('hidden');

  document.getElementById('btn-blend').textContent = '🌀 Bắt đầu Blend';
  document.getElementById('btn-dl').style.display    = 'none';

  // Reset step highlight states
  document.querySelectorAll('.blend-step').forEach(el => {
    el.classList.remove('active-blend', 'done-blend');
  });
  updateEmojiHeaderState(-1);
  phaseBar.innerHTML = '';
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

  document.getElementById('btn-blend').textContent = '⏹ Dừng';
  document.getElementById('btn-dl').style.display = 'none';

  buildPhaseBar(effectiveSteps.length);

  // Start chain
  runChainStep(effectiveSteps, 0);
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

  const rect = theater.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;

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
  S._currentCharImg  = charImgForStep;
  S._currentEmojiImg = emojiImgForStep;
  S._currentResultImg = step.resultImg;
  S._pendingSteps = steps;
  S._pendingIdx   = idx;

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
  updateEmojiHeaderState(999);
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
    badgeLabels = ['👍 Like', '💬 Comment', '🔄 Share', '🔔 Subscribe'];
  } else if (badgeType === 'hearts') {
    badgeLabels = ['❤️ #1', '💖 #2', '💗 #3', '💓 #4'];
  } else {
    badgeLabels = ['1️⃣ Option 1', '2️⃣ Option 2', '3️⃣ Option 3', '4️⃣ Option 4'];
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
    // Top 2 images (idx 0, 1): badge at bottom
    // Bottom 2 images (idx 2, 3): badge pushed to top
    const badgePosClass = idx < 2 ? 'badge-bottom' : 'badge-top';
    badge.className = `final-item-badge ${badgePosClass}`;
    badge.textContent = badgeLabels[idx] || `Option ${idx + 1}`;

    item.appendChild(img);
    item.appendChild(badge);

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
}

/* ─────────────────────── SOUND SYNTHESIZER (Web Audio API) ─────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
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
    const endFreq   = isBottom ? 550 : 220;
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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
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
  } catch (e) {}
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
    animateDir(fly2, 'bottom', -60, 38, 850, () => setTimeout(phase3, 800));
  } else if (currentDir === 'top') {
    setFlyStyle(fly2, { left: '50%', transform: 'translateX(-50%)', top: '-60%' });
    animateDir(fly2, 'top', -60, 38, 850, () => setTimeout(phase3, 800));
  } else if (currentDir === 'left') {
    setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', left: '-60%' });
    animateDir(fly2, 'left', -60, 22.5, 850, () => setTimeout(phase3, 800));
  } else if (currentDir === 'right') {
    setFlyStyle(fly2, { top: '50%', transform: 'translateY(-50%)', right: '-60%' });
    animateDir(fly2, 'right', -60, 22.5, 850, () => setTimeout(phase3, 800));
  }
}

function phase3() {
  const convergeMs = 400;
  let targetVal = 42;
  if (currentDir === 'left' || currentDir === 'right') targetVal = 22.5;
  animateDir(fly2, currentDir, (currentDir === 'left' || currentDir === 'right') ? 22.5 : 38, targetVal, convergeMs, () => {
    doCollisionFlash();
  });
}

function doCollisionFlash() {
  playSfxImpact();

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

  fly2.style.transition = 'opacity .2s';
  fly2.style.opacity = '0';
  bgCharWrap.classList.remove('show');
  canvas.classList.add('visible');

  setTimeout(() => {
    flash.remove();
    fly2.style.transition = '';
    startSwirlLoop();
  }, 300);
}

function startSwirlLoop() {
  S.time = 0;
  let elapsed  = 0;
  const totalMs = 1800;
  const speed   = parseFloat(document.getElementById('sl-speed').value);

  playSfxSwirlDrone(totalMs);

  function loop() {
    if (!S.running) return;
    const progress = Math.min(1, elapsed / totalMs);
    renderFrame(progress);
    S.time  += speed * 0.14;
    elapsed += 16 * (speed / 3.5);
    if (elapsed < totalMs) S.animId = requestAnimationFrame(loop);
    else phase4();
  }
  S.animId = requestAnimationFrame(loop);
}

function phase4() {
  fly1.style.opacity = '0';
  fly2.style.opacity = '0';
  canvas.style.transition = 'opacity .5s ease';
  canvas.style.opacity = '0';

  setTimeout(() => {
    resultImg.src = S._currentResultImg.src;
    resultWrap.classList.add('show');
    canvas.classList.remove('visible');
    canvas.style.transition = '';

    playSfxReveal();

    // Update chain prev to current result
    S.chainPrev = S._currentResultImg;
    S.lastResultImg = S._currentResultImg;

    const currentIdx = S._pendingIdx;
    const allSteps   = S._pendingSteps;

    // After showing result, pause 2-3 seconds then continue
    const pauseMs = 2000 + Math.random() * 1000; // 2-3 seconds

    if (currentIdx + 1 < allSteps.length) {
      setTimeout(() => {
        if (!S.running) return;
        // Set resultImg as background charImg so it stays visible seamlessly
        bgCharImg.src = S._currentResultImg.src;
        bgCharWrap.classList.add('show');
        resultWrap.classList.remove('show');
        runChainStep(allSteps, currentIdx + 1);
      }, pauseMs);
    } else {
      // All done
      setTimeout(() => {
        finishAllSteps();
      }, pauseMs);
    }
  }, 550);
}

/* ─────────────────────── RENDER ─────────────────────── */
function renderFrame(progress) {
  const W = canvas.width, H = canvas.height;

  const offA = drawToOff(S._currentCharImg, W, H);
  const offB = drawToOff(S._currentEmojiImg, W, H);
  const pxA  = offA.getImageData(0, 0, W, H).data;
  const pxB  = offB.getImageData(0, 0, W, H).data;
  const out  = ctx.createImageData(W, H);

  const swirl = parseFloat(document.getElementById('sl-swirl').value) / 100;
  const t     = S.time;

  switch (S.style) {
    case 'marble':   fxMarble(pxA, pxB, out.data, W, H, t, progress, swirl); break;
    case 'swirl':    fxSwirl(pxA, pxB, out.data, W, H, t, progress, swirl);  break;
    case 'wave':     fxWave(pxA, pxB, out.data, W, H, t, progress, swirl);   break;
    case 'dissolve': fxDissolve(pxA, pxB, out.data, W, H, t, progress);       break;
  }

  ctx.putImageData(out, 0, 0);
}

function drawToOff(img, W, H) {
  const off = document.createElement('canvas');
  off.width = W; off.height = H;
  const c = off.getContext('2d');
  const ar = img.width / img.height;
  let sw, sh, sx, sy;
  if (ar > W / H) { sh = H; sw = sh * ar; sx = (W - sw) / 2; sy = 0; }
  else             { sw = W; sh = sw / ar; sx = 0; sy = (H - sh) / 2; }
  c.drawImage(img, sx, sy, sw, sh);
  return c;
}

/* ─────────────────────── EFFECTS ─────────────────────── */
function fxMarble(a, b, out, W, H, t, p, swirl) {
  const cx = W / 2, cy = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i  = (y * W + x) * 4;
      const nx = (x - cx) / W, ny = (y - cy) / H;
      const r  = Math.sqrt((x-cx)**2 + (y-cy)**2);
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
      const spiralMask  = Math.sin(a0 * 5 + r * 0.03 - t * 1.8);
      const blendMask   = clamp(p * 0.6 + (wavePattern + spiralMask) * 0.35 + 0.15, 0, 1);
      const r_ = lerp(a[si],   b[si],   blendMask);
      const g_ = lerp(a[si+1], b[si+1], blendMask);
      const b_ = lerp(a[si+2], b[si+2], blendMask);
      const glow = (1 - Math.abs(blendMask - 0.5) * 2) * 25 * Math.sin(t * 2);
      out[i]   = clamp(r_ + glow, 0, 255)|0;
      out[i+1] = clamp(g_ + glow, 0, 255)|0;
      out[i+2] = clamp(b_ + glow, 0, 255)|0;
      out[i+3] = 255;
    }
  }
}

function fxSwirl(a, b, out, W, H, t, p, swirl) {
  const cx = W/2, cy = H/2;
  const maxR = Math.sqrt(cx*cx + cy*cy);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i  = (y*W+x)*4;
      const dx = x-cx, dy = y-cy;
      const r  = Math.sqrt(dx*dx + dy*dy);
      const ang = Math.atan2(dy,dx);
      const normR = r / maxR;
      const swirlAng = swirl * 8 * Math.pow(1 - normR, 1.5) * p + t * 0.05;
      const na  = ang + swirlAng;
      const sx = clamp(Math.round(cx + r*Math.cos(na)), 0, W-1);
      const sy = clamp(Math.round(cy + r*Math.sin(na)), 0, H-1);
      const si = (sy*W+sx)*4;
      const band = Math.sin(ang * 6 + r / maxR * Math.PI * 5 - t * 2) * .5 + .5;
      const alpha = clamp(p * band + p * (1-normR)*0.5, 0, 1);
      let r_ = lerp(a[si],   b[si],   alpha);
      let g_ = lerp(a[si+1], b[si+1], alpha);
      let b_ = lerp(a[si+2], b[si+2], alpha);
      const centerGlow = Math.max(0, 1 - normR * 2) * 30 * p;
      out[i]   = clamp(r_ + centerGlow, 0, 255)|0;
      out[i+1] = clamp(g_ + centerGlow, 0, 255)|0;
      out[i+2] = clamp(b_ + centerGlow, 0, 255)|0;
      out[i+3] = 255;
    }
  }
}

function fxWave(a, b, out, W, H, t, p, swirl) {
  const cx = W/2, cy = H/2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i  = (y*W+x)*4;
      const nx = x/W, ny = y/H;
      const dx = (x-cx)/W, dy = (y-cy)/H;
      const r  = Math.sqrt(dx*dx + dy*dy);
      const ripple = Math.sin(r * Math.PI * 10 - t * 2) * swirl * 40 * p;
      const wx = Math.sin(ny*Math.PI*10 + t*1.3) * swirl * 40 + Math.cos(r*8-t) * ripple;
      const wy = Math.cos(nx*Math.PI*10 + t*0.9) * swirl * 35 + Math.sin(r*8-t) * ripple;
      const sx = clamp(Math.round(x+wx), 0, W-1);
      const sy = clamp(Math.round(y+wy), 0, H-1);
      const si = (sy*W+sx)*4;
      const waveFront = clamp(1 - Math.abs(r - p * 0.9) / 0.35, 0, 1);
      const base = smoothstep(0, 0.6, p);
      const alpha = clamp(base * 0.5 + waveFront * 0.8, 0, 1);
      let r_ = lerp(a[si],   b[si],   alpha);
      let g_ = lerp(a[si+1], b[si+1], alpha);
      let b_ = lerp(a[si+2], b[si+2], alpha);
      const shimmer = waveFront * 25;
      out[i]   = clamp(r_ + shimmer * 0.8, 0, 255)|0;
      out[i+1] = clamp(g_ + shimmer * 0.3, 0, 255)|0;
      out[i+2] = clamp(b_ + shimmer,        0, 255)|0;
      out[i+3] = 255;
    }
  }
}

function fxDissolve(a, b, out, W, H, t, p) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i   = (y*W+x)*4;
      const nx  = x/W, ny = y/H;
      const n   = fbm(nx*6, ny*6, t*.18);
      const thr = p * 1.5 - 0.25;
      const alpha = smoothstep(thr - 0.08, thr + 0.08, n);
      const edge = smoothstep(thr-0.12, thr, n) * smoothstep(thr+0.12, thr, n);
      let r_ = lerp(a[i],   b[i],   alpha);
      let g_ = lerp(a[i+1], b[i+1], alpha);
      let b_ = lerp(a[i+2], b[i+2], alpha);
      out[i]   = clamp(r_ + edge * 80,  0, 255)|0;
      out[i+1] = clamp(g_ + edge * 20,  0, 255)|0;
      out[i+2] = clamp(b_ + edge * 120, 0, 255)|0;
      out[i+3] = 255;
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
    const t    = Math.min(1, (now - start) / durMs);
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
  a.href     = S.lastResultImg.src;
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
  const n00 = hash2(xi,   yi),   n10 = hash2(xi+1, yi);
  const n01 = hash2(xi,   yi+1), n11 = hash2(xi+1, yi+1);
  const ux = xf*xf*(3-2*xf), uy = yf*yf*(3-2*yf);
  return lerp(lerp(n00,n10,ux), lerp(n01,n11,ux), uy)*2 - 1;
}

function hash2(x, y) {
  const n = Math.sin(x*127.1 + y*311.7) * 43758.5453;
  return n - Math.floor(n);
}

/* ─────────────────────── TOAST ─────────────────────── */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ─────────────────────── INIT ─────────────────────── */
// Attach file listeners for all default steps (0, 1, 2, 3)
[0, 1, 2, 3].forEach(idx => attachStepFileListeners(idx));

