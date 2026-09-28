/**
 * MarbleBlend v3 – Vertical / Light theme
 *
 * ANIMATION FLOW:
 *   Phase 1 – img1 slides in from TOP    (bay vào từ trên)
 *   Phase 2 – img2 slides in from BOTTOM (bay vào từ dưới)
 *   Phase 3 – canvas swirl blend effect
 *   Phase 4 – canvas fades, result image zooms in
 */

'use strict';

/* ─────────────────────── STATE ─────────────────────── */
const S = {
  imgs:    [null, null, null],
  style:   'marble',
  animId:  null,
  running: false,
  time:    0,
};

/* ─────────────────────── DOM ─────────────────────── */
const canvas      = document.getElementById('blend-canvas');
const ctx         = canvas.getContext('2d');
const theater     = document.getElementById('theater');
const fly1        = document.getElementById('fly-1');
const fly2        = document.getElementById('fly-2');
const flyImg1     = document.getElementById('fly-img-1');
const flyImg2     = document.getElementById('fly-img-2');
const resultWrap  = document.getElementById('result-reveal');
const resultImg   = document.getElementById('result-img');
const idleOverlay = document.getElementById('idle-overlay');
const toastEl     = document.getElementById('toast');

/* ─────────────────────── FILE UPLOAD ─────────────────────── */
function pickFile(n) {
  document.getElementById(`file-${n}`).click();
}

[1, 2, 3].forEach(n => {
  const inp  = document.getElementById(`file-${n}`);
  const card = document.getElementById(`card-${n}`);

  inp.addEventListener('change', e => {
    const f = e.target.files[0];
    if (f) loadSlot(n, f);
  });

  card.addEventListener('dragover',  e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', ()  => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) loadSlot(n, f);
  });
});

function loadSlot(n, file) {
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      S.imgs[n - 1] = img;
      document.getElementById(`body-${n}`).style.display = 'none';
      const pv = document.getElementById(`prev-${n}`);
      pv.style.display = 'flex';
      document.getElementById(`pimg-${n}`).src = ev.target.result;
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

function clearSlot(n) {
  S.imgs[n - 1] = null;
  document.getElementById(`body-${n}`).style.display = 'flex';
  document.getElementById(`prev-${n}`).style.display  = 'none';
  document.getElementById(`file-${n}`).value           = '';
  resetAll();
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

/* ─────────────────────── PHASE INDICATOR ─────────────────────── */
function setPhase(p) {
  for (let i = 1; i <= 4; i++) {
    const step = document.getElementById(`ph-${i}`);
    step.classList.remove('active', 'done');
    if (i < p)       step.classList.add('done');
    else if (i === p) step.classList.add('active');
  }
  for (let i = 1; i <= 3; i++) {
    document.getElementById(`ph-line-${i}`)
      .classList.toggle('fill', i < p);
  }
}

/* ─────────────────────── RESET ─────────────────────── */
function resetAll() {
  if (S.animId) cancelAnimationFrame(S.animId);
  S.running = false; S.time = 0;

  // Reset fly images (offscreen)
  setFlyStyle(fly1, { top: '-60%', opacity: '0', bottom: 'auto' });
  setFlyStyle(fly2, { bottom: '-60%', opacity: '0', top: 'auto' });

  canvas.classList.remove('visible');
  canvas.style.opacity = '';
  canvas.style.transition = '';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  resultWrap.classList.remove('show');

  idleOverlay.classList.remove('hidden');

  document.getElementById('btn-blend').textContent = '🌀 Bắt đầu Blend';
  document.getElementById('btn-dl').style.display  = 'none';

  setPhase(0);
}

/* ─────────────────────── RUN ─────────────────────── */
function runBlend() {
  if (!S.imgs[0] || !S.imgs[1] || !S.imgs[2]) {
    toast('Vui lòng tải đủ 3 hình ảnh! 🖼️');
    return;
  }
  if (S.running) { resetAll(); return; }

  S.running = true;
  document.getElementById('btn-blend').textContent = '⏹ Dừng';

  const rect = theater.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;

  idleOverlay.classList.add('hidden');

  flyImg1.src = S.imgs[0].src;
  flyImg2.src = S.imgs[1].src;

  // Reset positions (offscreen)
  setFlyStyle(fly1, { top: '-60%', left: '50%', transform: 'translateX(-50%)', opacity: '0', bottom: 'auto', right: 'auto' });
  setFlyStyle(fly2, { bottom: '-60%', left: '50%', transform: 'translateX(-50%)', opacity: '0', top: 'auto', right: 'auto' });

  phase1();
}

/* ─────────────────────── SOUND SYNTHESIZER (Web Audio API) ─────────────────────── */
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

// SFX 1: Woosh fly-in sound
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

// SFX 2: Impact / Collision Flash Blast
function playSfxImpact() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    // Sub-bass thump
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

    // High sparkle shimmer
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

// SFX 3: Continuous Energy Swirl Drone
function playSfxSwirlDrone(durMs) {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const durSec = durMs / 1000;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.linearRampToValueAtTime(280, now + durSec);

    lfo.frequency.setValueAtTime(8, now);
    lfoGain.gain.setValueAtTime(40, now);
    lfo.connect(osc.frequency);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(400, now);
    filter.frequency.linearRampToValueAtTime(1400, now + durSec * 0.7);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.4);
    gain.gain.linearRampToValueAtTime(0.15, now + durSec - 0.4);
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

// SFX 4: Magic Chime / Sparkle Reveal
function playSfxReveal() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    const freqs = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6

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

/* ─────────────────────── PHASE 1 – img1 fly in from TOP ─────────────────────── */
function phase1() {
  setPhase(1);
  fly1.style.opacity = '1';
  playSfxSwoosh(false);

  // Faster fly in (550ms)
  animatePct(fly1, 'top', -60, 22, 550, () => {
    setTimeout(phase2, 200);
  });
}

/* ─────────────────────── PHASE 2 – img2 fly in from BOTTOM ─────────────────────── */
function phase2() {
  setPhase(2);
  fly2.style.opacity = '1';
  playSfxSwoosh(true);

  // Faster fly in (550ms)
  animatePct(fly2, 'bottom', -60, 22, 550, () => {
    setTimeout(phase3, 220);
  });
}

/* ─────────────────────── PHASE 3 – convergence + swirl ─────────────────────── */
function phase3() {
  setPhase(3);

  // Step A: both images fly toward center faster (350ms)
  const convergeMs = 350;
  let doneCount = 0;

  function onConverged() {
    doneCount++;
    if (doneCount < 2) return;
    // Both at center → flash collision
    doCollisionFlash();
  }

  // img1: top 22% → top 38%
  animatePct(fly1, 'top',    22, 38, convergeMs, onConverged);
  // img2: bottom 22% → bottom 38%
  animatePct(fly2, 'bottom', 22, 38, convergeMs, onConverged);
}

function doCollisionFlash() {
  playSfxImpact();

  // Flash overlay on theater
  const flash = document.createElement('div');
  flash.style.cssText = [
    'position:absolute', 'inset:0', 'z-index:20',
    'background:radial-gradient(ellipse 80% 60% at 50% 50%,',
    '  rgba(255,255,255,1) 0%, rgba(255,240,255,.8) 40%, transparent 80%)',
    'border-radius:inherit', 'pointer-events:none',
    'animation:flashOut .55s ease forwards',
  ].join(';');

  // Inject keyframe once
  if (!document.getElementById('flash-kf')) {
    const st = document.createElement('style');
    st.id = 'flash-kf';
    st.textContent = '@keyframes flashOut{0%{opacity:1}100%{opacity:0}}';
    document.head.appendChild(st);
  }

  theater.appendChild(flash);

  // Immediately hide fly images
  fly1.style.transition = 'opacity .2s';
  fly2.style.transition = 'opacity .2s';
  fly1.style.opacity = '0';
  fly2.style.opacity = '0';

  // Show canvas
  canvas.classList.add('visible');

  // Start swirl loop after short pause
  setTimeout(() => {
    flash.remove();
    fly1.style.transition = '';
    fly2.style.transition = '';
    startSwirlLoop();
  }, 300);
}

function startSwirlLoop() {
  S.time = 0;
  let elapsed  = 0;
  const totalMs = 1800; // Fast blend duration (1.8s instead of 3.8s)
  const speed   = parseFloat(document.getElementById('sl-speed').value);

  playSfxSwirlDrone(totalMs);

  function loop() {
    if (!S.running) return;
    const progress = Math.min(1, elapsed / totalMs);
    renderFrame(progress);
    S.time  += speed * 0.14; // Faster swirl motion step
    elapsed += 16 * (speed / 3.5);
    if (elapsed < totalMs) S.animId = requestAnimationFrame(loop);
    else phase4();
  }
  S.animId = requestAnimationFrame(loop);
}

/* ─────────────────────── PHASE 4 – reveal result ─────────────────────── */
function phase4() {
  setPhase(4);

  fly1.style.opacity = '0';
  fly2.style.opacity = '0';
  canvas.style.transition = 'opacity .5s ease';
  canvas.style.opacity = '0';

  setTimeout(() => {
    resultImg.src = S.imgs[2].src;
    resultWrap.classList.add('show');
    canvas.classList.remove('visible');
    canvas.style.transition = '';

    playSfxReveal();

    S.running = false;
    document.getElementById('btn-blend').textContent = '🌀 Bắt đầu Blend';
    document.getElementById('btn-dl').style.display  = 'inline-flex';
  }, 550);
}

/* ─────────────────────── RENDER ─────────────────────── */
function renderFrame(progress) {
  const W = canvas.width, H = canvas.height;

  const offA = drawToOff(S.imgs[0], W, H);
  const offB = drawToOff(S.imgs[1], W, H);
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

/**
 * MARBLE – Dramatic fluid paint pour swirl.
 * Uses multi-layer turbulence displacement + vivid color boost.
 */
function fxMarble(a, b, out, W, H, t, p, swirl) {
  const cx = W / 2, cy = H / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i  = (y * W + x) * 4;
      const nx = (x - cx) / W, ny = (y - cy) / H;
      const r  = Math.sqrt((x-cx)**2 + (y-cy)**2);
      const a0 = Math.atan2(ny, nx);

      // Multi-layer swirl deformation
      const s1 = Math.sin(r * 0.04 - t * 1.5 + a0 * 4) * swirl * 0.45;
      const s2 = Math.cos(r * 0.025 + t * 1.1 - a0 * 3) * swirl * 0.35;
      const vortex = Math.sin(a0 * 6 + t * 2) * (1 - r / maxR) * swirl * 0.25;

      const dx = Math.round((s1 + s2) * W * 0.08 + vortex * Math.cos(a0) * W * 0.05);
      const dy = Math.round((s2 + s1) * H * 0.08 + vortex * Math.sin(a0) * H * 0.05);

      const sx = clamp(x + dx, 0, W - 1);
      const sy = clamp(y + dy, 0, H - 1);
      const si = (sy * W + sx) * 4;

      // Interlocking organic blend mask (mixes both image A and image B textures together)
      const wavePattern = Math.sin(nx * 14 + s1 * 8 + t) * Math.cos(ny * 14 + s2 * 8 - t);
      const spiralMask  = Math.sin(a0 * 5 + r * 0.03 - t * 1.8);
      const blendMask   = clamp(p * 0.6 + (wavePattern + spiralMask) * 0.35 + 0.15, 0, 1);

      // Smooth color cross-blend
      const r_ = lerp(a[si],   b[si],   blendMask);
      const g_ = lerp(a[si+1], b[si+1], blendMask);
      const b_ = lerp(a[si+2], b[si+2], blendMask);

      // Soft color fusion & vibrant highlight
      const glow = (1 - Math.abs(blendMask - 0.5) * 2) * 25 * Math.sin(t * 2);
      out[i]   = clamp(r_ + glow, 0, 255)|0;
      out[i+1] = clamp(g_ + glow, 0, 255)|0;
      out[i+2] = clamp(b_ + glow, 0, 255)|0;
      out[i+3] = 255;
    }
  }
}

/**
 * SWIRL – Centrifugal rotation + color spiral bands.
 */
function fxSwirl(a, b, out, W, H, t, p, swirl) {
  const cx = W/2, cy = H/2;
  const maxR = Math.sqrt(cx*cx + cy*cy);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i  = (y*W+x)*4;
      const dx = x-cx, dy = y-cy;
      const r  = Math.sqrt(dx*dx + dy*dy);
      const ang = Math.atan2(dy,dx);

      // Progressive swirl angle – strongest near center, expands with p
      const normR = r / maxR;
      const swirlAng = swirl * 8 * Math.pow(1 - normR, 1.5) * p + t * 0.05;
      const na  = ang + swirlAng;

      const sx = clamp(Math.round(cx + r*Math.cos(na)), 0, W-1);
      const sy = clamp(Math.round(cy + r*Math.sin(na)), 0, H-1);
      const si = (sy*W+sx)*4;

      // Spiral banding: alternates A/B based on angle + radius
      const band = Math.sin(ang * 6 + r / maxR * Math.PI * 5 - t * 2) * .5 + .5;
      const alpha = clamp(p * band + p * (1-normR)*0.5, 0, 1);

      let r_ = lerp(a[si],   b[si],   alpha);
      let g_ = lerp(a[si+1], b[si+1], alpha);
      let b_ = lerp(a[si+2], b[si+2], alpha);

      // Highlight the swirl center
      const centerGlow = Math.max(0, 1 - normR * 2) * 30 * p;
      out[i]   = clamp(r_ + centerGlow, 0, 255)|0;
      out[i+1] = clamp(g_ + centerGlow, 0, 255)|0;
      out[i+2] = clamp(b_ + centerGlow, 0, 255)|0;
      out[i+3] = 255;
    }
  }
}

/**
 * WAVE – Horizontal + vertical ripple explosion.
 */
function fxWave(a, b, out, W, H, t, p, swirl) {
  const cx = W/2, cy = H/2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i  = (y*W+x)*4;
      const nx = x/W, ny = y/H;
      const dx = (x-cx)/W, dy = (y-cy)/H;
      const r  = Math.sqrt(dx*dx + dy*dy);

      // Ripple outward from center
      const ripple = Math.sin(r * Math.PI * 10 - t * 2) * swirl * 40 * p;
      const wx = Math.sin(ny*Math.PI*10 + t*1.3) * swirl * 40 + Math.cos(r*8-t) * ripple;
      const wy = Math.cos(nx*Math.PI*10 + t*0.9) * swirl * 35 + Math.sin(r*8-t) * ripple;

      const sx = clamp(Math.round(x+wx), 0, W-1);
      const sy = clamp(Math.round(y+wy), 0, H-1);
      const si = (sy*W+sx)*4;

      // Wave front that expands outward
      const waveFront = clamp(1 - Math.abs(r - p * 0.9) / 0.35, 0, 1);
      const base = smoothstep(0, 0.6, p);
      const alpha = clamp(base * 0.5 + waveFront * 0.8, 0, 1);

      let r_ = lerp(a[si],   b[si],   alpha);
      let g_ = lerp(a[si+1], b[si+1], alpha);
      let b_ = lerp(a[si+2], b[si+2], alpha);

      // Iridescent shimmer on wave peaks
      const shimmer = waveFront * 25;
      out[i]   = clamp(r_ + shimmer * 0.8, 0, 255)|0;
      out[i+1] = clamp(g_ + shimmer * 0.3, 0, 255)|0;
      out[i+2] = clamp(b_ + shimmer,        0, 255)|0;
      out[i+3] = 255;
    }
  }
}

/**
 * DISSOLVE – FBM noise threshold with color glow on edges.
 */
function fxDissolve(a, b, out, W, H, t, p) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i   = (y*W+x)*4;
      const nx  = x/W, ny = y/H;
      const n   = fbm(nx*6, ny*6, t*.18);
      const thr = p * 1.5 - 0.25;
      const alpha = smoothstep(thr - 0.08, thr + 0.08, n);
      // Edge glow: bright line where threshold crosses
      const edge = smoothstep(thr-0.12, thr, n) * smoothstep(thr+0.12, thr, n);

      let r_ = lerp(a[i],   b[i],   alpha);
      let g_ = lerp(a[i+1], b[i+1], alpha);
      let b_ = lerp(a[i+2], b[i+2], alpha);

      // Purple/magenta glow on dissolve edge
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

/**
 * Animate a CSS property (top/bottom) using % values.
 * from / to are percentage numbers (e.g. -60 = '-60%', 22 = '22%')
 */
function animatePct(el, prop, from, to, durMs, onDone) {
  const other = prop === 'top' ? 'bottom' : 'top';
  el.style[other] = 'auto';
  el.style[prop]  = from + '%';
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
  const a = document.createElement('a');
  a.download = `marble-blend-${Date.now()}.png`;
  a.href     = S.imgs[2].src;
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
