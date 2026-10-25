(() => {
  'use strict';

  // ---------------------------------------------------------------- setup
  let canvas = document.getElementById('field');
  const form = document.getElementById('composer');
  const input = document.getElementById('word');
  const hint = document.getElementById('hint');
  const readout = document.querySelector('.readout');
  const roGrid = document.getElementById('ro-grid');
  const roWaves = document.getElementById('ro-waves');
  const roFps = document.getElementById('ro-fps');
  const roMs = document.getElementById('ro-ms');
  const swatches = Array.from(document.querySelectorAll('.swatch'));

  const UI = '"Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const TAU = Math.PI * 2;

  // The four face-button symbols. At rest they take the palette's colour;
  // on a wave crest each one flashes its own colour.
  const SYMBOL_COLORS = ['#4fd6b0', '#ff6b6b', '#7fa8ff', '#f58ad6']; // triangle, circle, cross, square
  const NG = SYMBOL_COLORS.length;
  const LEVELS = 24;               // brightness steps (the 2D-canvas fallback quantizes to these)

  // Wave physics. Everything is in seconds and CSS pixels, never per frame,
  // so the page moves the same on 60, 120 or 144 Hz displays.
  const SPEED = 360;               // px per second the wave front travels
  const K = TAU / 64;              // wavelength of 64px
  const DISP = 16;                 // how far a crest pushes the field, px
  const DECAY = 2.3;               // seconds for a click wave to fall to 1/e
  const TRAIL_DECAY = 1.2;         // drag-trail waves fade faster
  const REACH = 2.6;               // a wave packet is evaluated out to 2.6 sigma
  const MAX_RIPPLES = 32;
  const STAMP_HOLD = 3.2;          // seconds a written word stays lit
  const SHIMMER_RATE = 0.15;       // fraction of cells that swap symbol per second
  const AMBIENT_HZ = 15;           // full refreshes of the drifting clouds per second

  // cursor lens
  const LENS_R = 130;
  const LENS_R2 = LENS_R * LENS_R;

  // planet lighting: light from the upper left, mostly in front
  const LL = Math.hypot(-0.4, -0.5, 0.77);
  const LX = -0.4 / LL, LY = -0.5 / LL, LZ = 0.77 / LL;
  const TILT = 0.38;
  const cT = Math.cos(TILT), sT = Math.sin(TILT);

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const toGL = (c) => c.map((v) => v / 255);
  const SYMBOL_RGB = SYMBOL_COLORS.map(hexToRgb);
  const SYMBOL_GL = new Float32Array(SYMBOL_RGB.flatMap(toGL));

  const PALETTES = {
    slate: {
      bg: '#121316', lo: '#1d2127', hi: '#a9bde3',
      vars: { '--bg': '#121316', '--panel': 'rgba(27,29,34,.86)', '--chip': '#1b1e23', '--btn': '#262a31',
              '--line': '#2a2e36', '--line-strong': '#3b414c', '--accent': '#a9bde3' },
    },
    ember: {
      bg: '#14110f', lo: '#241e1a', hi: '#e3a877',
      vars: { '--bg': '#14110f', '--panel': 'rgba(33,28,24,.86)', '--chip': '#201b17', '--btn': '#2d2620',
              '--line': '#332b25', '--line-strong': '#4a3f36', '--accent': '#e3a877' },
    },
    moss: {
      bg: '#0f1311', lo: '#1b231e', hi: '#94cba5',
      vars: { '--bg': '#0f1311', '--panel': 'rgba(23,30,26,.86)', '--chip': '#18201b', '--btn': '#212b25',
              '--line': '#27312b', '--line-strong': '#3a473f', '--accent': '#94cba5' },
    },
  };
  for (const p of Object.values(PALETTES)) {
    p.rgb = { bg: hexToRgb(p.bg), lo: hexToRgb(p.lo), hi: hexToRgb(p.hi) };
    p.gl = { bg: toGL(p.rgb.bg), lo: toGL(p.rgb.lo), hi: toGL(p.rgb.hi) };
  }

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionQuery.matches;
  motionQuery.addEventListener?.('change', (e) => { reduceMotion = e.matches; });

  const clock = () => performance.now() / 1000;

  // Lookup tables, so the wave loop avoids Math.exp / sin / cos per cell.
  const EXP_MAX = (REACH * REACH) / 2 + 0.1;
  const EXP_N = 512, EXP_SCALE = EXP_N / EXP_MAX;
  const EXP_LUT = new Float32Array(EXP_N + 2);
  for (let q = 0; q < EXP_N + 2; q++) EXP_LUT[q] = Math.exp(-q / EXP_SCALE);
  const SIN_N = 1024, SIN_MASK = SIN_N - 1, SIN_QUARTER = SIN_N / 4, SIN_SCALE = SIN_N / TAU;
  const SIN_LUT = new Float32Array(SIN_N);
  for (let q = 0; q < SIN_N; q++) SIN_LUT[q] = Math.sin((q / SIN_N) * TAU);

  // ---------------------------------------------------------------- noise
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const PERM = new Uint8Array(512);
  const RND = new Float32Array(256);
  {
    const rng = mulberry32(20261015);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) { p[i] = i; RND[i] = rng(); }
    for (let i = 255; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  }

  // 3D value noise in [0, 1]
  function vnoise(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const X = xi & 255, Y = yi & 255, Z = zi & 255;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const w = zf * zf * (3 - 2 * zf);
    const a = PERM[X] + Y, aa = PERM[a] + Z, ab = PERM[a + 1] + Z;
    const b = PERM[X + 1] + Y, ba = PERM[b] + Z, bb = PERM[b + 1] + Z;
    const x1 = RND[PERM[aa]] + (RND[PERM[ba]] - RND[PERM[aa]]) * u;
    const x2 = RND[PERM[ab]] + (RND[PERM[bb]] - RND[PERM[ab]]) * u;
    const x3 = RND[PERM[aa + 1]] + (RND[PERM[ba + 1]] - RND[PERM[aa + 1]]) * u;
    const x4 = RND[PERM[ab + 1]] + (RND[PERM[bb + 1]] - RND[PERM[ab + 1]]) * u;
    const y1 = x1 + (x2 - x1) * v;
    const y2 = x3 + (x4 - x3) * v;
    return y1 + (y2 - y1) * w;
  }

  const smooth = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };

  // Planet surface: an equirectangular map sampled from 3D noise on the
  // unit sphere, so it wraps without a seam.
  const TW = 256, TH = 128, TWM = TW - 1;
  const TEX = new Float32Array(TW * TH);
  for (let v = 0; v < TH; v++) {
    const lat = (v / (TH - 1) - 0.5) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let u = 0; u < TW; u++) {
      const lon = (u / TW - 0.5) * TAU;
      const px = cl * Math.sin(lon), py = sl, pz = cl * Math.cos(lon);
      let f = 0, amp = 0.5, fr = 1.9, norm = 0;
      for (let o = 0; o < 5; o++) {
        f += amp * vnoise(px * fr + 11.3, py * fr + 4.7, pz * fr + 7.1);
        norm += amp; amp *= 0.5; fr *= 2.03;
      }
      f /= norm;
      TEX[v * TW + u] = smooth(0.46, 0.6, f) * 0.85 + f * 0.15;
    }
  }

  // ---------------------------------------------------------------- grid state
  let W = 0, H = 0, dpr = 1;
  let dcw = 11, dch = 11;          // cell size in device pixels
  let cw = 11, ch = 11;            // cell size in CSS pixels
  let cols = 0, rows = 0, cellCount = 0;
  let cx = 0, cy = 0, R = 1, invR = 1;

  let baseChar = new Uint8Array(0);   // resting symbol per cell
  let cellHash = new Float32Array(0); // fixed random value per cell

  // Planet and cloud values cached per cell. The rotation only shifts
  // longitude, so the per-cell trig runs once per resize, not every frame.
  let pKind = new Uint8Array(0);      // 1 = on the planet
  let pU = new Float32Array(0);       // longitude before rotation, in texture columns
  let pRow = new Int32Array(0);       // latitude row offset into TEX
  let pA = new Float32Array(0);       // ambient + rim light
  let pD = new Float32Array(0);       // diffuse light
  let pHalo = new Float32Array(0);    // thin glow just outside the planet
  let amb = new Float32Array(0);      // drifting clouds, refreshed a band at a time

  // per-frame output: x, y, symbol + heat, brightness for each visible cell
  let inst = new Float32Array(0);

  // per-row wave accumulators
  let aC = new Float32Array(0), aE = new Float32Array(0);
  let aX = new Float32Array(0), aY = new Float32Array(0);

  let palette = PALETTES.slate;
  let renderer = null;

  // ---------------------------------------------------------------- symbols
  // Draws the four symbols side by side, one per cell, with their top edge at `top`.
  function paintSymbols(a, top, colorFor) {
    const s = Math.min(dcw, dch) * 0.64;
    const r = s / 2;
    const lw = Math.max(1, 1.1 * dpr);
    const y = top + dch / 2;
    a.lineWidth = lw;
    a.lineCap = 'round';
    a.lineJoin = 'round';
    for (let g = 0; g < NG; g++) {
      const x = g * dcw + dcw / 2;
      a.strokeStyle = colorFor(g);
      a.beginPath();
      if (g === 0) {                 // triangle
        const h = s * 0.92, half = h / Math.sqrt(3);
        a.moveTo(x, y - h * 0.58);
        a.lineTo(x + half, y + h * 0.42);
        a.lineTo(x - half, y + h * 0.42);
        a.closePath();
      } else if (g === 1) {          // circle
        a.arc(x, y, r - lw / 2, 0, TAU);
      } else if (g === 2) {          // cross
        const q = r * 0.8;
        a.moveTo(x - q, y - q); a.lineTo(x + q, y + q);
        a.moveTo(x + q, y - q); a.lineTo(x - q, y + q);
      } else {                       // square
        const q = r * 0.8;
        a.rect(x - q, y - q, 2 * q, 2 * q);
      }
      a.stroke();
    }
  }

  function symbolCanvas(height) {
    const c = document.createElement('canvas');
    c.width = dcw * NG;
    c.height = height;
    return c;
  }

  // ---------------------------------------------------------------- WebGL2 renderer
  // One instanced draw call for the whole field: each visible cell is a quad
  // that samples a white symbol atlas and is coloured in the shader.
  const VERT = `#version 300 es
layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aCell;   // x, y (device px), symbol + heat, brightness
uniform vec2 uCanvas;
uniform vec2 uCell;
uniform vec3 uHi;
uniform vec3 uSym[${NG}];
out vec2 vUv;
out float vLight;
out vec3 vTop;
void main() {
  vec2 p = aCell.xy + aCorner * uCell;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
  float g = floor(aCell.z);
  float heat = clamp((aCell.z - g) / 0.999, 0.0, 1.0);
  vTop = mix(uHi, uSym[int(g)], heat);
  vLight = aCell.w;
  vUv = vec2((g + aCorner.x) / ${NG}.0, aCorner.y);
}`;

  const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
in float vLight;
in vec3 vTop;
uniform sampler2D uAtlas;
uniform vec3 uLo;
out vec4 outColor;
void main() {
  float a = texture(uAtlas, vUv).a;
  float e = pow(clamp((vLight * ${LEVELS}.0 - 2.0) / ${LEVELS - 3}.0, 0.0, 1.0), 1.15);
  vec3 c = mix(uLo, vTop, e);
  outColor = vec4(c * a, a);
}`;

  function makeGLRenderer(cv) {
    const gl = cv.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false,
    });
    if (!gl) return null;

    let prog, vao, instBuf, tex, lost = false;
    const loc = {};

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getShaderInfoLog(s) || 'shader did not compile');
      }
      return s;
    }

    function init() {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
        throw new Error(gl.getProgramInfoLog(prog) || 'program did not link');
      }
      for (const name of ['uCanvas', 'uCell', 'uHi', 'uSym', 'uAtlas', 'uLo']) {
        loc[name] = gl.getUniformLocation(prog, name);
      }

      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const corners = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, corners);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      instBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(1, 1);
      gl.bindVertexArray(null);

      tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    init();

    const api = {
      kind: 'WebGL2',
      resize() {
        gl.viewport(0, 0, cv.width, cv.height);
      },
      uploadAtlas() {
        const c = symbolCanvas(dch);
        paintSymbols(c.getContext('2d'), 0, () => '#fff');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      },
      setPalette() { /* colours are uniforms, read every frame */ },
      draw(data, n) {
        if (lost) return;
        const p = palette.gl;
        gl.clearColor(p.bg[0], p.bg[1], p.bg[2], 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (!n) return;
        gl.useProgram(prog);
        gl.uniform2f(loc.uCanvas, cv.width, cv.height);
        gl.uniform2f(loc.uCell, dcw, dch);
        gl.uniform3fv(loc.uLo, p.lo);
        gl.uniform3fv(loc.uHi, p.hi);
        gl.uniform3fv(loc.uSym, SYMBOL_GL);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(loc.uAtlas, 0);
        // re-specify the buffer each frame so the driver never waits on the GPU
        gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 4), gl.STREAM_DRAW);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
        gl.bindVertexArray(null);
      },
    };

    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    cv.addEventListener('webglcontextrestored', () => {
      init();
      api.resize();
      api.uploadAtlas();
      lost = false;
    });

    return api;
  }

  // ---------------------------------------------------------------- 2D canvas fallback
  function make2DRenderer(cv) {
    const ctx = cv.getContext('2d', { alpha: false });
    let atlas = null;
    const api = {
      kind: '2D canvas',
      resize() { ctx.imageSmoothingEnabled = false; },
      // every symbol pre-drawn at every brightness level, in two blocks:
      // the palette ramp, then each symbol's own colour ramp
      uploadAtlas() {
        const c = symbolCanvas(dch * LEVELS * 2);
        const a = c.getContext('2d');
        const lo = palette.rgb.lo;
        for (let r = 0; r < 2; r++) {
          for (let l = 0; l < LEVELS; l++) {
            const e = Math.pow(Math.max(0, (l - 2) / (LEVELS - 3)), 1.15);
            paintSymbols(a, (r * LEVELS + l) * dch, (g) => {
              const top = r ? SYMBOL_RGB[g] : palette.rgb.hi;
              const m = lo.map((v, k) => Math.round(v + (top[k] - v) * e));
              return `rgb(${m[0]},${m[1]},${m[2]})`;
            });
          }
        }
        atlas = c;
      },
      setPalette() { api.uploadAtlas(); },
      draw(data, n) {
        ctx.fillStyle = palette.bg;
        ctx.fillRect(0, 0, cv.width, cv.height);
        for (let q = 0; q < n; q++) {
          const o = q * 4;
          const z = data[o + 2];
          const g = z | 0;
          const hot = z - g > 0.5 ? 1 : 0;
          let lvl = (data[o + 3] * LEVELS) | 0;
          if (lvl < 2) continue;
          if (lvl >= LEVELS) lvl = LEVELS - 1;
          ctx.drawImage(atlas, g * dcw, (hot * LEVELS + lvl) * dch, dcw, dch,
            Math.round(data[o]), Math.round(data[o + 1]), dcw, dch);
        }
      },
    };
    return api;
  }

  function pickRenderer() {
    if (!/canvas2d/.test(location.hash)) {
      try {
        const r = makeGLRenderer(canvas);
        if (r) return r;
      } catch (err) {
        // the WebGL context is spent on this element, so start over on a fresh one
        console.warn('WebGL2 renderer unavailable, using 2D canvas:', err);
        const fresh = canvas.cloneNode(false);
        canvas.replaceWith(fresh);
        canvas = fresh;
      }
    }
    return make2DRenderer(canvas);
  }

  // ---------------------------------------------------------------- field caches
  function precomputePlanet() {
    for (let j = 0; j < rows; j++) {
      const ny = ((j + 0.5) * ch - cy) * invR;
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        const nx = ((i + 0.5) * cw - cx) * invR;
        const rr = nx * nx + ny * ny;
        if (rr < 1) {
          const nz = Math.sqrt(1 - rr);
          const y1 = ny * cT + nz * sT;
          const z1 = -ny * sT + nz * cT;
          pKind[k] = 1;
          pU[k] = (Math.atan2(nx, z1) / TAU + 0.5) * TW;
          const tv = ((Math.asin(Math.max(-1, Math.min(1, y1))) / Math.PI + 0.5) * (TH - 1)) | 0;
          pRow[k] = tv * TW;
          const diff = nx * LX + ny * LY + nz * LZ;
          pD[k] = diff > 0 ? diff : 0;
          const rim = 1 - nz;
          pA[k] = 0.1 + rim * rim * rim * 0.1;
          pHalo[k] = 0;
        } else {
          pKind[k] = 0;
          pHalo[k] = rr < 1.18 ? (1.18 - rr) * (cellHash[k] > 0.55 ? 0.75 : 0.3) : 0;
        }
      }
    }
  }

  function refreshAmbient(j0, count, t) {
    const tAmb = t * (reduceMotion ? 0.01 : 0.05);
    const drift = t * (reduceMotion ? 0.002 : 0.02);
    for (let q = 0; q < count; q++) {
      const j = (j0 + q) % rows;
      const y = (j + 0.5) * ch;
      const base = j * cols;
      for (let i = 0; i < cols; i++) {
        const k = base + i;
        if (pKind[k] === 1) continue;
        const x = (i + 0.5) * cw;
        const nb = vnoise(x * 0.0042 + drift, y * 0.0066, tAmb) * 0.62
                 + vnoise(x * 0.012, y * 0.019 + 9.7, tAmb * 1.7) * 0.38;
        amb[k] = nb > 0.63 ? (nb - 0.63) * 0.6 + 0.07 : 0;
      }
    }
  }

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const small = W < 640;
    const big = W * H > 2300000;
    dcw = dch = Math.max(6, Math.round((small ? 10 : big ? 12 : 11) * dpr));
    cw = dcw / dpr;
    ch = dch / dpr;

    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    cols = Math.ceil(canvas.width / dcw);
    rows = Math.ceil(canvas.height / dch);
    cellCount = cols * rows;
    baseChar = new Uint8Array(cellCount);
    cellHash = new Float32Array(cellCount);
    pKind = new Uint8Array(cellCount);
    pU = new Float32Array(cellCount);
    pRow = new Int32Array(cellCount);
    pA = new Float32Array(cellCount);
    pD = new Float32Array(cellCount);
    pHalo = new Float32Array(cellCount);
    amb = new Float32Array(cellCount);
    inst = new Float32Array(cellCount * 4);
    aC = new Float32Array(cols); aE = new Float32Array(cols);
    aX = new Float32Array(cols); aY = new Float32Array(cols);

    const rng = mulberry32(cols * 7919 + rows);
    for (let k = 0; k < cellCount; k++) {
      cellHash[k] = rng();
      baseChar[k] = (rng() * NG) | 0;
    }

    cx = W * 0.5;
    cy = H * (small ? 0.4 : 0.43);
    R = Math.min(W * 0.4, H * 0.36);
    invR = 1 / R;

    precomputePlanet();
    refreshAmbient(0, rows, clock());
    renderer.resize();
    renderer.uploadAtlas();
    if (stamp) stamp = makeStamp(stamp.text, stamp.t0);
    roGrid.textContent = `${cols} × ${rows}`;
  }

  // ---------------------------------------------------------------- ripples
  const ripples = [];
  const rX = new Float64Array(MAX_RIPPLES), rY = new Float64Array(MAX_RIPPLES);
  const rF = new Float64Array(MAX_RIPPLES), rA = new Float64Array(MAX_RIPPLES);
  const rI = new Float64Array(MAX_RIPPLES), rP = new Float64Array(MAX_RIPPLES);
  const rLo2 = new Float64Array(MAX_RIPPLES), rHi2 = new Float64Array(MAX_RIPPLES);

  function addRipple(x, y, strength, delay = 0, decay = DECAY) {
    ripples.push({ x, y, s: strength, t0: clock() + delay, decay });
    if (ripples.length > MAX_RIPPLES) ripples.shift();
  }

  // ---------------------------------------------------------------- written words
  let stamp = null;  // { mask, x, y, t0, text }

  function makeStamp(text, t0) {
    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    const o = off.getContext('2d', { willReadFrequently: true });
    let size = Math.min(H * 0.3, W * 0.32, 280);
    o.font = `800 ${size}px ${UI}`;
    const w = o.measureText(text).width;
    const maxW = W * 0.86;
    if (w > maxW) size *= maxW / w;
    // draw in CSS pixel space, scaled down so one canvas pixel = one cell
    o.setTransform(1 / cw, 0, 0, 1 / ch, 0, 0);
    o.font = `800 ${size}px ${UI}`;
    o.textAlign = 'center';
    o.textBaseline = 'middle';
    o.fillStyle = '#fff';
    o.fillText(text, cx, cy);
    const data = o.getImageData(0, 0, cols, rows).data;
    const mask = new Uint8Array(cols * rows);
    for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3] > 110 ? 1 : 0;
    return { mask, x: cx, y: cy, t0, text };
  }

  // ---------------------------------------------------------------- input
  let mx = -1e4, my = -1e4, lensAmt = 0, lensTarget = 0;
  let dragging = false, lastDX = 0, lastDY = 0, lastDT = 0;
  let lastInteract = clock();
  let nextIdle = clock() + 10;

  function dismissHint() {
    hint.classList.add('gone');
  }

  function bindPointer(cv) {
    cv.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      try { cv.setPointerCapture(e.pointerId); } catch (_) { /* capture is optional */ }
      dragging = true;
      lastDX = e.clientX; lastDY = e.clientY; lastDT = clock();
      addRipple(e.clientX, e.clientY, 1);
      lastInteract = clock();
      dismissHint();
    });

    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        mx = e.clientX; my = e.clientY; lensTarget = 1;
      }
      if (!dragging) return;
      const t = clock();
      const ddx = e.clientX - lastDX, ddy = e.clientY - lastDY;
      if (ddx * ddx + ddy * ddy > 26 * 26 && t - lastDT > 0.03) {
        addRipple(e.clientX, e.clientY, 0.42, 0, TRAIL_DECAY);
        lastDX = e.clientX; lastDY = e.clientY; lastDT = t;
        lastInteract = t;
      }
    });

    const endDrag = () => { dragging = false; };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener('pointerleave', () => { lensTarget = 0; });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON' || tag === 'TEXTAREA') return;
    e.preventDefault();
    addRipple(cx, cy, 1.35);
    lastInteract = clock();
    dismissHint();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim().slice(0, 24);
    if (!text) {
      form.classList.remove('nudge');
      void form.offsetWidth;  // restart the animation
      form.classList.add('nudge');
      input.focus();
      return;
    }
    const t0 = clock() + 0.05;
    stamp = makeStamp(text, t0);
    addRipple(cx, cy, 1.25);
    input.value = '';
    lastInteract = clock();
    dismissHint();
  });
  form.addEventListener('animationend', () => form.classList.remove('nudge'));

  function applyPalette(name) {
    if (!PALETTES[name]) name = 'slate';
    palette = PALETTES[name];
    const root = document.documentElement.style;
    for (const [k, v] of Object.entries(palette.vars)) root.setProperty(k, v);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', palette.bg);
    swatches.forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.palette === name)));
    if (renderer && cellCount) renderer.setPalette();
    try { localStorage.setItem('glyphtide.palette', name); } catch (_) { /* storage is optional */ }
  }

  swatches.forEach((s) => s.addEventListener('click', () => {
    applyPalette(s.dataset.palette);
    addRipple(cx, cy, 0.8);
  }));

  // ---------------------------------------------------------------- frame
  let rot = 0;
  let lastFrame = performance.now();
  let fpsT = lastFrame, frames = 0, workSum = 0;
  let shimmerAcc = 0, ambientAcc = 0, ambCursor = 0;

  function frame(now) {
    const work0 = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
    lastFrame = now;
    const t = now / 1000;
    const tick = (t * 20) | 0;

    rot = (rot + dt * (reduceMotion ? 0.012 : 0.07)) % TAU;
    const rotU = (rot / TAU) * TW;
    lensAmt += (lensTarget - lensAmt) * (1 - Math.exp(-dt * 8));
    const lensOn = lensAmt > 0.01;

    // an occasional gentle wave when nobody is touching the page
    if (!reduceMotion && t - lastInteract > 9 && t > nextIdle) {
      addRipple(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.6), 0.5);
      nextIdle = t + 5 + Math.random() * 5;
    }

    // pack the live ripples into flat arrays for the inner loop
    let nR = 0;
    for (let q = ripples.length - 1; q >= 0; q--) {
      const r = ripples[q];
      const age = t - r.t0;
      if (age < 0) continue;
      const amp = r.s * Math.exp(-age / r.decay);
      if (amp < 0.02 || age > 8) { ripples.splice(q, 1); continue; }
      const front = age * SPEED;
      const sigma = 36 + age * 26;
      const lo = front - REACH * sigma, hi = front + REACH * sigma;
      rX[nR] = r.x; rY[nR] = r.y; rF[nR] = front;
      rA[nR] = amp * Math.min(1, 0.4 + age * 5);
      rI[nR] = 1 / (2 * sigma * sigma);
      rP[nR] = age * 2.4;
      rLo2[nR] = lo > 0 ? lo * lo : -1;
      rHi2[nR] = hi * hi;
      nR++;
    }

    // shimmer: a steady number of cells per second swap symbol
    if (!reduceMotion) {
      shimmerAcc += cellCount * SHIMMER_RATE * dt;
      const m = shimmerAcc | 0;
      shimmerAcc -= m;
      for (let q = 0; q < m; q++) baseChar[(Math.random() * cellCount) | 0] = (Math.random() * NG) | 0;
    }

    // clouds drift slowly, so refresh them a band of rows at a time
    ambientAcc += rows * AMBIENT_HZ * dt;
    const ambRows = Math.min(rows, ambientAcc | 0);
    ambientAcc -= ambientAcc | 0;
    if (ambRows) {
      refreshAmbient(ambCursor, ambRows, t);
      ambCursor = (ambCursor + ambRows) % rows;
    }

    const st = stamp;
    if (st && t > st.t0 + STAMP_HOLD + 2.2) stamp = null;
    const mask = st ? st.mask : null;

    let n = 0;
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * ch;
      const rowBase = j * cols;

      // 1. waves: each ripple adds itself only to the cells of this row its ring covers
      let tMin = cols, tMax = -1;
      for (let k = 0; k < nR; k++) {
        const oy = y - rY[k], oy2 = oy * oy;
        const hi2 = rHi2[k];
        if (oy2 > hi2) continue;
        const lo2 = rLo2[k];
        const rx = rX[k];
        const outer = Math.sqrt(hi2 - oy2);
        let i0 = Math.floor((rx - outer) / cw - 0.5);
        let i1 = Math.ceil((rx + outer) / cw - 0.5);
        if (i0 < 0) i0 = 0;
        if (i1 > cols - 1) i1 = cols - 1;
        if (i0 > i1) continue;
        let h0 = cols, h1 = -1;    // cells inside the ring's hole, skipped
        if (lo2 > oy2) {
          const inner = Math.sqrt(lo2 - oy2);
          h0 = Math.ceil((rx - inner) / cw - 0.5) + 1;
          h1 = Math.floor((rx + inner) / cw - 0.5) - 1;
        }
        if (i0 < tMin) tMin = i0;
        if (i1 > tMax) tMax = i1;
        const f = rF[k], ik = rI[k], amp = rA[k], ph0 = rP[k];
        for (let i = i0; i <= i1; i++) {
          if (i >= h0 && i <= h1) { i = h1; continue; }
          const ox = (i + 0.5) * cw - rx;
          const d2 = ox * ox + oy2;
          if (d2 > hi2 || d2 < lo2) continue;
          const d = Math.sqrt(d2) + 0.001;
          const delta = d - f;
          const env = amp * EXP_LUT[(delta * delta * ik * EXP_SCALE) | 0] / (1 + d * 0.0009);
          const pi = ((delta * K + ph0) * SIN_SCALE) | 0;
          const sn = SIN_LUT[pi & SIN_MASK];
          const cs = SIN_LUT[(pi + SIN_QUARTER) & SIN_MASK];
          aC[i] += env * cs;
          aE[i] += env;
          const push = env * sn * DISP / d;
          aX[i] += ox * push;
          aY[i] += oy * push;
        }
      }

      const lensRow = lensOn && Math.abs(y - my) < LENS_R + DISP;

      for (let i = 0; i < cols; i++) {
        const idx = rowBase + i;
        let crest = 0, energy = 0, dx = 0, dy = 0;
        if (i >= tMin && i <= tMax) { crest = aC[i]; energy = aE[i]; dx = aX[i]; dy = aY[i]; }

        // 2. sample the scene at the wave-displaced position
        let sx = (i + 0.5) * cw - dx, sy = y - dy;
        let glow = 0;
        if (lensRow) {
          const lx = sx - mx, ly = sy - my;
          const ld2 = lx * lx + ly * ly;
          if (ld2 < LENS_R2) {
            const f = 1 - Math.sqrt(ld2) / LENS_R;
            const sc = 1 - 0.34 * f * f * lensAmt;
            sx = mx + lx * sc;
            sy = my + ly * sc;
            glow = f * f * 0.2 * lensAmt;
          }
        }
        let si = Math.floor(sx / cw), sj = Math.floor(sy / ch);
        if (si < 0) si = 0; else if (si >= cols) si = cols - 1;
        if (sj < 0) sj = 0; else if (sj >= rows) sj = rows - 1;
        const s = sj * cols + si;
        const hc = cellHash[idx];

        // 3. planet, or halo and clouds, from the per-cell caches
        let b, heat = 0;
        if (pKind[s] === 1) {
          const uf = pU[s] + rotU;
          const u0 = uf | 0;
          const row = pRow[s];
          const l0 = TEX[row + (u0 & TWM)];
          const land = l0 + (TEX[row + ((u0 + 1) & TWM)] - l0) * (uf - u0);
          b = pA[s] + 0.1 * land + pD[s] * (0.08 + 0.3 * land);
          if (land < 0.3 && hc < 0.45) b *= 0.4;
        } else {
          b = amb[s];
          if (pHalo[s] > b) b = pHalo[s];
          if (hc > 0.993 && b < 0.11) b = 0.11;
        }

        // 4. light the crests, darken the troughs
        if (crest !== 0) {
          b += crest * 0.5;
          const c = crest * 0.6;
          if (c > b) b = c;
          if (crest > 0.18) {
            heat = crest > 0.43 ? 1 : (crest - 0.18) * 4;
            b += heat * 0.14;          // coloured crests read a little brighter
          }
        }
        b += glow * (b > 0.06 ? 1 : 0.35);

        // 5. a written word, revealed by its own wave front, then dissolving
        let scramble = energy > 0.2;
        if (mask && mask[s]) {
          const ex = si * cw - st.x, ey = sj * ch - st.y;
          let lin = (t - (st.t0 + Math.sqrt(ex * ex + ey * ey) / 650)) * 5;
          lin = lin < 0 ? 0 : lin > 1 ? 1 : lin;
          let lout = 1 - (t - (st.t0 + STAMP_HOLD + cellHash[s] * 1.5)) * 2.2;
          lout = lout < 0 ? 0 : lout > 1 ? 1 : lout;
          const life = lin * lout;
          if (life > 0) {
            const v = 0.3 + 0.66 * life;
            if (v > b) b = v;
            if (life > 0.2) {
              const hw = life > 0.45 ? 1 : (life - 0.2) * 4;
              if (hw > heat) heat = hw;
            }
            if (life < 0.97) scramble = true;
          }
        }

        if (b < 0.083) continue;
        const g = scramble
          ? (Math.imul(idx + tick * 7919, 2654435761) >>> 16) % NG
          : baseChar[idx];
        const o = n << 2;
        inst[o] = i * dcw + dx * 0.3 * dpr;
        inst[o + 1] = j * dch + dy * 0.3 * dpr;
        inst[o + 2] = g + heat * 0.999;
        inst[o + 3] = b;
        n++;
      }

      if (tMax >= tMin) {
        aC.fill(0, tMin, tMax + 1);
        aE.fill(0, tMin, tMax + 1);
        aX.fill(0, tMin, tMax + 1);
        aY.fill(0, tMin, tMax + 1);
      }
    }

    renderer.draw(inst, n);

    workSum += performance.now() - work0;
    frames++;
    if (now - fpsT > 500) {
      roFps.textContent = `${Math.round((frames * 1000) / (now - fpsT))} fps`;
      roMs.textContent = `${(workSum / frames).toFixed(1)} ms`;
      roWaves.textContent = `${nR} wave${nR === 1 ? '' : 's'}`;
      frames = 0;
      workSum = 0;
      fpsT = now;
    }

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------- boot
  let saved = 'slate';
  try { saved = localStorage.getItem('glyphtide.palette') || 'slate'; } catch (_) { /* storage is optional */ }
  applyPalette(saved);

  renderer = pickRenderer();
  readout.title = `Drawn with ${renderer.kind}. ms = script time per frame.`;
  bindPointer(canvas);
  resize();

  let resizeQueued = false;
  window.addEventListener('resize', () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => { resizeQueued = false; resize(); });
  });

  if (!reduceMotion) addRipple(cx, cy, 0.9, 0.6);
  requestAnimationFrame(frame);
})();
