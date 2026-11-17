(() => {
  const THEME_STORAGE_KEY = 'noircut-site-theme';
  const root = document.documentElement;

  const themeButtons = document.querySelectorAll('.theme-dot');
  const applyTheme = (theme) => {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    themeButtons.forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.theme === theme);
    });
  };

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'noir-green';
  applyTheme(savedTheme);

  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  // --- Interactive Darkroom Monitor & Scope Engine ---
  const monitorCanvas = document.getElementById('monitorCanvas');
  const scopeCanvas = document.getElementById('scopeCanvas');
  const monitorViewport = document.getElementById('monitorViewport');
  const wipeLine = document.getElementById('wipeLine');
  const wipeHandle = document.getElementById('wipeHandle');
  const timecodeEl = document.getElementById('timecodeDisplay');
  const activeModeBadge = document.getElementById('activeModeBadge');
  const playToggleBtn = document.getElementById('playToggleBtn');
  const wipeToggleBtn = document.getElementById('wipeToggleBtn');
  const safeFrameBtn = document.getElementById('safeFrameBtn');

  if (!monitorCanvas || !scopeCanvas) return;

  const mCtx = monitorCanvas.getContext('2d', { willReadFrequently: true });
  const sCtx = scopeCanvas.getContext('2d');

  const W = 480;
  const H = 270;
  monitorCanvas.width = W;
  monitorCanvas.height = H;
  scopeCanvas.width = 240;
  scopeCanvas.height = 76;

  // Offscreen base frame buffer (regenerated only per play frame if playing)
  const baseCanvas = document.createElement('canvas');
  baseCanvas.width = W;
  baseCanvas.height = H;
  const bCtx = baseCanvas.getContext('2d', { willReadFrequently: true });

  const LOOK_PRESETS = {
    raw: {
      name: 'Log / Ham Sinyal',
      exposure: 0,
      contrast: 0,
      grain: 0,
      halation: 0,
      temp: 0,
      sat: 1.0,
      lift: [0, 0, 0],
      gain: [1, 1, 1],
      monochrome: false
    },
    obsidian: {
      name: 'Obsidian Nocturne',
      exposure: -0.08,
      contrast: 32,
      grain: 24,
      halation: 36,
      temp: -18,
      sat: 0.78,
      lift: [-0.03, -0.01, 0.04],
      gain: [1.04, 1.0, 0.94],
      monochrome: false
    },
    vintage74: {
      name: 'Vintage 1974',
      exposure: 0.05,
      contrast: 18,
      grain: 38,
      halation: 48,
      temp: 26,
      sat: 0.86,
      lift: [0.04, 0.025, 0.01],
      gain: [1.08, 0.99, 0.84],
      monochrome: false
    },
    bleach: {
      name: 'Bleach Bypass',
      exposure: -0.04,
      contrast: 46,
      grain: 28,
      halation: 14,
      temp: -8,
      sat: 0.42,
      lift: [-0.02, -0.02, -0.01],
      gain: [1.05, 1.05, 1.04],
      monochrome: false
    },
    nordic: {
      name: 'Nordic Thriller',
      exposure: -0.05,
      contrast: 28,
      grain: 20,
      halation: 12,
      temp: -32,
      sat: 0.62,
      lift: [-0.02, 0.01, 0.05],
      gain: [0.92, 0.99, 1.08],
      monochrome: false
    },
    trix400: {
      name: 'Tri-X 400 Mono',
      exposure: 0.02,
      contrast: 42,
      grain: 46,
      halation: 22,
      temp: 0,
      sat: 0,
      lift: [0.01, 0.01, 0.01],
      gain: [1.06, 1.06, 1.06],
      monochrome: true
    }
  };

  const state = {
    preset: 'obsidian',
    workspace: 'GRADE',
    exposure: -0.08,
    contrast: 32,
    grain: 24,
    halation: 36,
    wipeEnabled: true,
    wipePos: 0.52,
    safeFrame: true,
    playing: true,
    frame: 296 // 00:00:12:08 @ 24fps
  };

  const exposureSlider = document.getElementById('ctrlExposure');
  const contrastSlider = document.getElementById('ctrlContrast');
  const grainSlider = document.getElementById('ctrlGrain');
  const halationSlider = document.getElementById('ctrlHalation');

  const exposureVal = document.getElementById('valExposure');
  const contrastVal = document.getElementById('valContrast');
  const grainVal = document.getElementById('valGrain');
  const halationVal = document.getElementById('valHalation');

  const syncSliders = () => {
    exposureSlider.value = state.exposure;
    contrastSlider.value = state.contrast;
    grainSlider.value = state.grain;
    halationSlider.value = state.halation;

    exposureVal.textContent = (state.exposure >= 0 ? '+' : '') + state.exposure.toFixed(2) + ' EV';
    contrastVal.textContent = (state.contrast >= 0 ? '+' : '') + Math.round(state.contrast);
    grainVal.textContent = Math.round(state.grain) + '%';
    halationVal.textContent = Math.round(state.halation) + '%';
  };

  // Precomputed rain streak coordinates
  const streaks = Array.from({ length: 42 }, (_, i) => ({
    x: ((i * 73) % W),
    y: ((i * 41) % H),
    len: 10 + (i % 16),
    speed: 1.8 + (i % 4) * 0.7
  }));

  function renderBaseScene(t) {
    // Sky + atmospheric fog backdrop
    const sky = bCtx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#131720');
    sky.addColorStop(0.55, '#1d2430');
    sky.addColorStop(0.7, '#272f3a');
    sky.addColorStop(1, '#0b0d11');
    bCtx.fillStyle = sky;
    bCtx.fillRect(0, 0, W, H);

    // Distant city haze & building silhouettes
    bCtx.fillStyle = '#11151c';
    const buildings = [
      [0, 68, 72, 118],
      [70, 42, 68, 144],
      [135, 86, 56, 100],
      [270, 56, 80, 130],
      [348, 34, 70, 152],
      [414, 74, 66, 112]
    ];
    for (const [bx, by, bw, bh] of buildings) {
      bCtx.fillRect(bx, by, bw, bh);
    }

    // Lit architectural windows (highlights for halation & rolloff testing)
    bCtx.fillStyle = 'rgba(244, 214, 158, 0.65)';
    const wins = [
      [84, 64, 7, 10],
      [96, 64, 7, 10],
      [84, 84, 7, 10],
      [362, 52, 8, 11],
      [376, 52, 8, 11],
      [362, 72, 8, 11],
      [288, 78, 9, 12]
    ];
    for (const [wx, wy, ww, wh] of wins) {
      bCtx.fillRect(wx, wy, ww, wh);
    }

    // Practical streetlamp glow & core highlight
    const lampX = 166 + Math.sin(t * 0.015) * 1.5;
    const lampY = 92;
    const halo = bCtx.createRadialGradient(lampX, lampY, 2, lampX, lampY, 128);
    halo.addColorStop(0, 'rgba(255, 240, 206, 0.98)');
    halo.addColorStop(0.12, 'rgba(245, 198, 130, 0.56)');
    halo.addColorStop(0.45, 'rgba(130, 112, 92, 0.16)');
    halo.addColorStop(1, 'rgba(20, 24, 30, 0)');
    bCtx.fillStyle = halo;
    bCtx.fillRect(0, 0, W, H);

    // Lamp pole
    bCtx.fillStyle = '#0a0b0e';
    bCtx.fillRect(162, 96, 4, 96);
    bCtx.fillRect(156, 92, 16, 4);

    // Wet asphalt reflection plane
    const roadGrad = bCtx.createLinearGradient(0, 184, 0, H);
    roadGrad.addColorStop(0, '#181e26');
    roadGrad.addColorStop(0.4, '#10141b');
    roadGrad.addColorStop(1, '#08090c');
    bCtx.fillStyle = roadGrad;
    bCtx.fillRect(0, 184, W, H - 184);

    // Lamp reflection smear on wet street
    for (let i = 0; i < 16; i++) {
      const ry = 188 + i * 5.2;
      const rw = 26 - i * 0.7 + Math.sin(t * 0.08 + i) * 6;
      const alpha = 0.28 - i * 0.014;
      bCtx.fillStyle = `rgba(246, 205, 146, ${Math.max(0.02, alpha)})`;
      bCtx.fillRect(lampX - rw / 2, ry, rw, 2.5);
    }

    // Cool neon storefront reflection on right side
    const cyanRef = bCtx.createRadialGradient(392, 168, 4, 392, 174, 78);
    cyanRef.addColorStop(0, 'rgba(142, 224, 242, 0.62)');
    cyanRef.addColorStop(0.35, 'rgba(64, 152, 184, 0.22)');
    cyanRef.addColorStop(1, 'rgba(12, 16, 22, 0)');
    bCtx.fillStyle = cyanRef;
    bCtx.fillRect(280, 96, 200, 170);

    // Foreground silhouette subject (trenchcoat edge / figure)
    bCtx.fillStyle = '#090b0f';
    bCtx.beginPath();
    bCtx.arc(246, 134, 11, 0, Math.PI * 2);
    bCtx.fill();
    bCtx.beginPath();
    bCtx.moveTo(226, 270);
    bCtx.lineTo(232, 154);
    bCtx.quadraticCurveTo(246, 144, 260, 154);
    bCtx.lineTo(268, 270);
    bCtx.closePath();
    bCtx.fill();

    // Rim highlight on shoulder from streetlamp
    bCtx.strokeStyle = 'rgba(248, 224, 184, 0.55)';
    bCtx.lineWidth = 1.6;
    bCtx.beginPath();
    bCtx.moveTo(232, 168);
    bCtx.lineTo(235, 154);
    bCtx.lineTo(244, 147);
    bCtx.stroke();

    // Subtle rain lines
    bCtx.strokeStyle = 'rgba(220, 232, 244, 0.14)';
    bCtx.lineWidth = 1;
    bCtx.beginPath();
    for (const s of streaks) {
      const y = (s.y + t * s.speed) % H;
      const x = (s.x + t * 0.45) % W;
      bCtx.moveTo(x, y);
      bCtx.lineTo(x - 2, y + s.len);
    }
    bCtx.stroke();
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function sCurve(v, strength) {
    // normalized 0..1 S-curve contrast
    const x = v - 0.5;
    const c = 1 + strength * 1.45;
    const out = 0.5 + (x * c) / (1 + Math.abs(x * (c - 1)) * 1.15);
    return out < 0 ? 0 : out > 1 ? 1 : out;
  }

  function processAndDraw() {
    renderBaseScene(state.frame);
    const srcImg = bCtx.getImageData(0, 0, W, H);
    const dstImg = mCtx.createImageData(W, H);
    const src = srcImg.data;
    const dst = dstImg.data;

    const p = LOOK_PRESETS[state.preset];
    const expMul = Math.pow(2, state.exposure);
    const contrastAmt = state.contrast / 50;
    const grainAmt = (state.grain / 100) * 34;
    const halAmt = state.halation / 100;
    const tempShift = p.temp / 255;
    const sat = p.sat;
    const wipeX = state.wipeEnabled ? Math.floor(state.wipePos * W) : 0;

    // 32 bin histogram for RGB parade / waveform
    const bins = 60;
    const histR = new Uint16Array(bins);
    const histG = new Uint16Array(bins);
    const histB = new Uint16Array(bins);

    // Deterministic fast PRNG for film grain
    let seed = (state.frame * 1664525 + 1013904223) >>> 0;

    for (let y = 0; y < H; y++) {
      const rowOffset = y * W;
      for (let x = 0; x < W; x++) {
        const idx = (rowOffset + x) * 4;
        const r0 = src[idx];
        const g0 = src[idx + 1];
        const b0 = src[idx + 2];

        if (state.wipeEnabled && x < wipeX) {
          dst[idx] = r0;
          dst[idx + 1] = g0;
          dst[idx + 2] = b0;
          dst[idx + 3] = 255;
          continue;
        }

        let r = (r0 / 255) * expMul;
        let g = (g0 / 255) * expMul;
        let b = (b0 / 255) * expMul;

        // Temperature & lift/gain
        r = (r + p.lift[0] + tempShift * 0.16) * p.gain[0];
        g = (g + p.lift[1]) * p.gain[1];
        b = (b + p.lift[2] - tempShift * 0.16) * p.gain[2];

        // Contrast curve
        r = sCurve(r, contrastAmt);
        g = sCurve(g, contrastAmt);
        b = sCurve(b, contrastAmt);

        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

        if (p.monochrome) {
          r = g = b = luma;
        } else {
          r = luma + (r - luma) * sat;
          g = luma + (g - luma) * sat;
          b = luma + (b - luma) * sat;
        }

        // Halation highlight bloom tint in warm reds around bright zones
        if (halAmt > 0.01 && luma > 0.42) {
          const hw = (luma - 0.42) * halAmt * 0.42;
          r += hw * 0.95;
          g += hw * 0.28;
        }

        // Organic film grain
        let gr = 0;
        if (grainAmt > 0.2) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          const rnd = ((seed >>> 16) / 65535 - 0.5) * grainAmt;
          // Luma-weighted midtone peak grain
          const midWeight = 0.55 + (1 - Math.abs(luma - 0.45)) * 0.45;
          gr = rnd * midWeight;
        }

        const rr = clamp255(r * 255 + gr);
        const gg = clamp255(g * 255 + gr * 0.95);
        const bb = clamp255(b * 255 + gr * 0.9);

        dst[idx] = rr;
        dst[idx + 1] = gg;
        dst[idx + 2] = bb;
        dst[idx + 3] = 255;

        if ((x & 1) === 0 && (y & 1) === 0) {
          histR[Math.min(bins - 1, (rr * bins) >> 8)]++;
          histG[Math.min(bins - 1, (gg * bins) >> 8)]++;
          histB[Math.min(bins - 1, (bb * bins) >> 8)]++;
        }
      }
    }

    mCtx.putImageData(dstImg, 0, 0);

    // Workspace / Safe Frame overlays on monitor
    if (state.safeFrame) {
      const barH = Math.round((H - W / 2.39) / 2);
      mCtx.fillStyle = 'rgba(0, 0, 0, 0.72)';
      mCtx.fillRect(0, 0, W, barH);
      mCtx.fillRect(0, H - barH, W, barH);
      mCtx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      mCtx.lineWidth = 1;
      mCtx.strokeRect(0.5, barH + 0.5, W - 1, H - barH * 2 - 1);
    }

    if (state.workspace === 'TEXT') {
      mCtx.save();
      mCtx.textAlign = 'center';
      mCtx.fillStyle = 'rgba(241, 242, 238, 0.92)';
      mCtx.font = '600 22px "Playfair Display", Georgia, serif';
      mCtx.fillText('GECE YARISI DOSYASI', W / 2, H / 2 - 4);
      mCtx.fillStyle = 'rgba(241, 242, 238, 0.65)';
      mCtx.font = '500 9px "JetBrains Mono", monospace';
      mCtx.fillText('BOLUM 03  /  2.39:1 ANAMORPHIC', W / 2, H / 2 + 16);
      mCtx.restore();
    } else if (state.workspace === 'AUDIO') {
      // Subtle translucent meter strip inside monitor corner
      mCtx.fillStyle = 'rgba(10, 11, 14, 0.72)';
      mCtx.fillRect(W - 52, H - 56, 38, 42);
      const lvl = 16 + Math.abs(Math.sin(state.frame * 0.18)) * 18;
      mCtx.fillStyle = '#b7e36a';
      mCtx.fillRect(W - 44, H - 18 - lvl, 6, lvl);
      mCtx.fillRect(W - 32, H - 18 - lvl * 0.85, 6, lvl * 0.85);
    }

    drawScope(histR, histG, histB, bins);
    updateTimecode();
    updateWipeVisual();
  }

  function drawScope(histR, histG, histB, bins) {
    const sw = scopeCanvas.width;
    const sh = scopeCanvas.height;
    sCtx.fillStyle = '#07080a';
    sCtx.fillRect(0, 0, sw, sh);

    // IRE reference lines (25%, 50%, 75%)
    sCtx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    sCtx.lineWidth = 1;
    for (const ratio of [0.25, 0.5, 0.75]) {
      const y = Math.round(sh * ratio) + 0.5;
      sCtx.beginPath();
      sCtx.moveTo(0, y);
      sCtx.lineTo(sw, y);
      sCtx.stroke();
    }

    let maxVal = 1;
    for (let i = 0; i < bins; i++) {
      if (histR[i] > maxVal) maxVal = histR[i];
      if (histG[i] > maxVal) maxVal = histG[i];
      if (histB[i] > maxVal) maxVal = histB[i];
    }

    const drawChannel = (arr, color) => {
      sCtx.strokeStyle = color;
      sCtx.lineWidth = 1.4;
      sCtx.beginPath();
      for (let i = 0; i < bins; i++) {
        const x = (i / (bins - 1)) * sw;
        const norm = Math.sqrt(arr[i] / maxVal);
        const y = sh - 4 - norm * (sh - 10);
        if (i === 0) sCtx.moveTo(x, y);
        else sCtx.lineTo(x, y);
      }
      sCtx.stroke();
    };

    sCtx.globalCompositeOperation = 'lighter';
    drawChannel(histR, 'rgba(244, 96, 96, 0.85)');
    drawChannel(histG, 'rgba(134, 239, 134, 0.85)');
    drawChannel(histB, 'rgba(96, 178, 250, 0.85)');
    sCtx.globalCompositeOperation = 'source-over';
  }

  function updateTimecode() {
    const fps = 24;
    const total = state.frame;
    const f = total % fps;
    const secTotal = Math.floor(total / fps);
    const s = secTotal % 60;
    const m = Math.floor(secTotal / 60) % 60;
    const pad = (n) => String(n).padStart(2, '0');
    timecodeEl.textContent = `00:${pad(m)}:${pad(s)}:${pad(f)}`;
  }

  function updateWipeVisual() {
    if (!wipeLine || !wipeHandle) return;
    if (!state.wipeEnabled) {
      wipeLine.style.display = 'none';
      wipeHandle.style.display = 'none';
      return;
    }
    const pct = `${(state.wipePos * 100).toFixed(1)}%`;
    wipeLine.style.display = 'block';
    wipeHandle.style.display = 'flex';
    wipeLine.style.left = pct;
    wipeHandle.style.left = pct;
  }

  // Controls binding
  document.querySelectorAll('.look-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const id = chip.dataset.preset;
      const p = LOOK_PRESETS[id];
      if (!p) return;
      state.preset = id;
      state.exposure = p.exposure;
      state.contrast = p.contrast;
      state.grain = p.grain;
      state.halation = p.halation;
      document.querySelectorAll('.look-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      activeModeBadge.textContent = `${p.name} · WebGL2`;
      syncSliders();
      processAndDraw();
    });
  });

  document.querySelectorAll('.console-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.workspace = tab.dataset.ws;
      document.querySelectorAll('.console-tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      processAndDraw();
    });
  });

  exposureSlider.addEventListener('input', (e) => {
    state.exposure = parseFloat(e.target.value);
    syncSliders();
    processAndDraw();
  });
  contrastSlider.addEventListener('input', (e) => {
    state.contrast = parseFloat(e.target.value);
    syncSliders();
    processAndDraw();
  });
  grainSlider.addEventListener('input', (e) => {
    state.grain = parseFloat(e.target.value);
    syncSliders();
    processAndDraw();
  });
  halationSlider.addEventListener('input', (e) => {
    state.halation = parseFloat(e.target.value);
    syncSliders();
    processAndDraw();
  });

  wipeToggleBtn.addEventListener('click', () => {
    state.wipeEnabled = !state.wipeEnabled;
    wipeToggleBtn.classList.toggle('is-on', state.wipeEnabled);
    processAndDraw();
  });

  safeFrameBtn.addEventListener('click', () => {
    state.safeFrame = !state.safeFrame;
    safeFrameBtn.classList.toggle('is-on', state.safeFrame);
    processAndDraw();
  });

  playToggleBtn.addEventListener('click', () => {
    state.playing = !state.playing;
    playToggleBtn.textContent = state.playing ? 'Durdur' : 'Oynat';
    playToggleBtn.classList.toggle('is-on', state.playing);
  });

  // Drag wipe divider on viewport
  let draggingWipe = false;
  const setWipeFromEvent = (e) => {
    if (!state.wipeEnabled) return;
    const rect = monitorViewport.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    state.wipePos = Math.max(0.08, Math.min(0.92, ratio));
    processAndDraw();
  };

  monitorViewport.addEventListener('pointerdown', (e) => {
    draggingWipe = true;
    monitorViewport.setPointerCapture(e.pointerId);
    setWipeFromEvent(e);
  });
  monitorViewport.addEventListener('pointermove', (e) => {
    if (draggingWipe) setWipeFromEvent(e);
  });
  monitorViewport.addEventListener('pointerup', () => {
    draggingWipe = false;
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.dataset.copyTarget;
      const el = document.getElementById(targetId);
      if (!el) return;
      try {
        await navigator.clipboard.writeText(el.textContent.trim());
        const prev = btn.textContent;
        btn.textContent = 'Kopyalandi';
        setTimeout(() => {
          btn.textContent = prev;
        }, 1400);
      } catch {
        // ignore clipboard denial
      }
    });
  });

  // Animation loop capped smoothly at ~24fps when playing
  syncSliders();
  processAndDraw();

  let lastTick = 0;
  function tick(ts) {
    if (state.playing && ts - lastTick > 84) {
      state.frame = (state.frame + 1) % (24 * 60);
      processAndDraw();
      lastTick = ts;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
