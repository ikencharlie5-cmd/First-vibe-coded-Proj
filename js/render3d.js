// 3D renderer for Ironhold, built on three.js. It reads game state every frame and talks back
// to the game through frameMove(), clickWorld(), setBuildCursor() and state.camYaw.
'use strict';

const Render3D = (() => {
  const C = THREE;
  let renderer, scene, camera, sun, view;
  const raycaster = new C.Raycaster();
  let zoom = 12, pitch = 0.45, camX = 0, camY = 0, camZ = 0;
  let lastFrame = 0, lastNodeScan = 0, lastStructScan = 0;
  let streamX = -999, streamY = -999;
  let player = null, waterTex = null, ghost = null, ghostKey = '';
  let interactMark, targetMark;
  const monObjs = new Map();
  const structObjs = new Map();
  const pickables = [];
  const nodeMeshes = {};   // res -> [{ im, part }]
  const nodeSlots = new Map(); // node idx -> { res, k, active, base }
  let stumpMesh, rubbleMesh, ringMesh;
  const fishSlots = [];
  const floaters = [];
  const smoke = [];
  const flames = [];
  const actors = [];
  const SKY = 0xa9cfe9;
  const QUALITY = {
    low:    { shadows: false, shadowSize: 1024, pixel: 1,    clutter: 0.3, clutterR: 18, fog: 0.8,  wildlife: 0.4, folk: 0.5 },
    medium: { shadows: true,  shadowSize: 1024, pixel: 1.25, clutter: 0.65, clutterR: 26, fog: 1,   wildlife: 0.7, folk: 0.8 },
    high:   { shadows: true,  shadowSize: 2048, pixel: 2,    clutter: 1,   clutterR: 36, fog: 1.35, wildlife: 1,   folk: 1 },
  };
  let Q = QUALITY[settings.quality] || QUALITY.medium;
  let hemi, lantern, stars, rain, clouds = [];
  let rainAmt = 0, fogAmt = 0, cloudAmt = 0, stepPhase = 0, underAmt = 0;
  const glows = [];          // additive glow sprites: { sp, base, night } (night-only ones fade with daylight)
  const townGroups = [];     // { g, x, y } so faraway towns can be hidden
  const walkers = [];        // townsfolk, guards, dogs and penned animals
  const critters = [];       // deer and rabbits
  const flocks = [];         // birds overhead
  const carriers = new Map(); // settlement workers walking to the storehouse
  const poiObjs = [];
  let windowMat, waterMesh, groundGeo, baseCol, iceMesh = null;
  const npcObjs = [], boardObjs = [], runeObjs = [], seedObjs = [], cairnObjs = [];
  let forgeFx = null;
  const STREAM_R = 64;
  const TIER_COLORS = [0x8a8a8a, 0xc77a3a, 0x9c9c9c, 0xd2dae4, 0x8f7bff];

  // ------------------------------------------------------------ helpers
  const HIDE = new C.Matrix4().makeTranslation(0, -1000, 0);
  const rnd = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  const gh = (x, y) => groundHeight(x, y);
  // Afloat you ride on the water; on frozen lakes you walk on the ice.
  const playerY = () => state.sailing ? -0.02 : iceAt(Math.round(state.px), Math.round(state.py)) ? Math.max(0.04, gh(state.px, state.py)) : gh(state.px, state.py);
  const matCache = new Map();
  function mat(color, extra) {
    const key = color + (extra ? JSON.stringify(extra) : '');
    if (!matCache.has(key)) matCache.set(key, new C.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 0 }, extra)));
    return matCache.get(key);
  }
  const glow = color => mat(color, { emissive: color, emissiveIntensity: 1 });
  const geoCache = new Map();
  function geo(kind, ...args) {
    const key = kind + args.join(',');
    if (!geoCache.has(key)) geoCache.set(key, new C[kind](...args));
    return geoCache.get(key);
  }
  function mesh(g, m, x = 0, y = 0, z = 0, shadow = true) {
    const o = new C.Mesh(g, m);
    o.position.set(x, y, z);
    o.castShadow = shadow;
    return o;
  }
  const box = (w, h, d, color, x, y, z) => mesh(geo('BoxGeometry', w, h, d), mat(color), x, y, z);
  const cyl = (rt, rb, h, color, x, y, z, seg = 7) => mesh(geo('CylinderGeometry', rt, rb, h, seg), mat(color), x, y, z);
  const cone = (r, h, color, x, y, z, seg = 6) => mesh(geo('ConeGeometry', r, h, seg), mat(color), x, y, z);

  function makeLabel(text, o = {}) {
    const fs = o.size || 40;
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d');
    const font = `bold ${fs}px system-ui, sans-serif`;
    g.font = font;
    const w = Math.ceil(g.measureText(text).width + fs * 0.9);
    cv.width = w; cv.height = Math.ceil(fs * 1.5);
    g.font = font;
    if (o.bg) {
      g.fillStyle = o.bg;
      if (g.roundRect) { g.beginPath(); g.roundRect(0, 0, w, cv.height, fs * 0.35); g.fill(); } else g.fillRect(0, 0, w, cv.height);
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = fs * 0.16; g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.strokeText(text, w / 2, cv.height / 2 + 1);
    g.fillStyle = o.color || '#fff';
    g.fillText(text, w / 2, cv.height / 2 + 1);
    const tex = new C.CanvasTexture(cv);
    tex.minFilter = C.LinearFilter;
    const sp = new C.Sprite(new C.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
    const h = o.h || 0.4;
    sp.scale.set(h * w / cv.height, h, 1);
    sp.renderOrder = 10;
    return sp;
  }
  function disposeSprite(sp) { if (sp.material.map) sp.material.map.dispose(); sp.material.dispose(); }

  // Soft additive halo used for lamps, fires and shrines.
  let glowTex = null;
  function glowSprite(color, size, nightOnly = true) {
    if (!glowTex) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      glowTex = new C.CanvasTexture(cv);
    }
    const sp = new C.Sprite(new C.SpriteMaterial({ map: glowTex, color, blending: C.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    sp.scale.set(size, size, 1);
    glows.push({ sp, nightOnly });
    return sp;
  }

  // ------------------------------------------------------------ terrain & water
  function buildTerrain() {
    const VW = W + 1, VH = H + 1;
    const pos = new Float32Array(VW * VH * 3), col = new Float32Array(VW * VH * 3);
    for (let cy = 0; cy < VH; cy++) for (let cx = 0; cx < VW; cx++) {
      const v = cy * VW + cx;
      pos[v * 3] = cx - 0.5; pos[v * 3 + 1] = cornerH[v]; pos[v * 3 + 2] = cy - 0.5;
      let r = 0, g = 0, b = 0, n = 0;
      for (const [tx, ty] of [[cx - 1, cy - 1], [cx, cy - 1], [cx - 1, cy], [cx, cy]]) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const i = idx(tx, ty) * 3;
        r += tileRGB[i]; g += tileRGB[i + 1]; b += tileRGB[i + 2]; n++;
      }
      col[v * 3] = r / n; col[v * 3 + 1] = g / n; col[v * 3 + 2] = b / n;
    }
    const index = new Uint32Array(W * H * 6);
    let k = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const a = y * VW + x, b = a + 1, c = a + VW, d = c + 1;
      index[k++] = a; index[k++] = c; index[k++] = b;
      index[k++] = b; index[k++] = c; index[k++] = d;
    }
    const g = new C.BufferGeometry();
    g.setAttribute('position', new C.BufferAttribute(pos, 3));
    g.setAttribute('color', new C.BufferAttribute(col, 3));
    g.setIndex(new C.BufferAttribute(index, 1));
    g.computeVertexNormals();
    const groundMat = new C.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0 });
    // High ground cuts through the fog, so the mountains stay visible from far away.
    groundMat.onBeforeCompile = sh => {
      sh.vertexShader = 'varying float vWorldY;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
      sh.fragmentShader = 'varying float vWorldY;\n' + sh.fragmentShader.replace('#include <fog_fragment>', `#ifdef USE_FOG
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth) * (1.0 - 0.8 * smoothstep(5.0, 28.0, vWorldY));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
      #endif`);
    };
    groundGeo = g;
    baseCol = col.slice();
    const ground = new C.Mesh(g, groundMat);
    ground.receiveShadow = true;
    scene.add(ground);

    waterTex = waterTexture();
    waterTex.repeat.set(W / 3, H / 3);
    const wg = new C.PlaneGeometry(W + 40, H + 40);
    wg.rotateX(-Math.PI / 2);
    const water = new C.Mesh(wg, new C.MeshPhongMaterial({ color: 0x4f9fd9, map: waterTex, transparent: true, opacity: 0.82, shininess: 80, specular: 0x88bbee }));
    water.position.set(W / 2 - 0.5, -0.04, H / 2 - 0.5);
    water.receiveShadow = true;
    waterMesh = water;
    scene.add(water);

    // Town walls and gate towers.
    const walls = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (terrain[idx(x, y)] === T.WALL && townAt(x, y) === 'ironhold') walls.push([x, y]);
    }
    const wall = new C.InstancedMesh(geo('BoxGeometry', 1, 2.8, 1), mat(0x9a948a), walls.length);
    const cren = new C.InstancedMesh(geo('BoxGeometry', 0.5, 0.45, 1.1), mat(0x8a847a), walls.length);
    walls.forEach(([x, y], k) => {
      const h = tileH[idx(x, y)];
      wall.setMatrixAt(k, new C.Matrix4().makeTranslation(x, h + 1.3, y));
      cren.setMatrixAt(k, (x + y) % 2 ? new C.Matrix4().makeTranslation(x, h + 2.9, y) : HIDE);
    });
    wall.castShadow = cren.castShadow = wall.receiveShadow = true;
    scene.add(wall, cren);
    const d = TOWN_DEFS.ironhold;
    for (const [x, y] of [[d.x - d.hw, d.y - d.hh], [d.x + d.hw, d.y - d.hh], [d.x - d.hw, d.y + d.hh], [d.x + d.hw, d.y + d.hh]]) {
      const h = tileH[idx(x, y)];
      scene.add(cyl(1.3, 1.45, 4.4, 0x8a8478, x, h + 2.2, y, 10), cyl(1.5, 1.5, 0.4, 0x7a746a, x, h + 4.5, y, 10), cone(1.6, 2.0, 0x7a3530, x, h + 5.7, y, 10));
    }
    for (const b of bridges) scene.add(bake(bridgeModel(b)));
  }

  // ------------------------------------------------------------ bridges
  // The deck is one smooth surface following the bridge's height; railings run along every edge over water.
  const BRIDGE_STYLE = {
    stone:  { deck: [0xb0a898, 0x9e968a], side: 0x8a847a, thick: 0.55, rail: 0x9a948a, cap: 0xc4bcae },
    timber: { deck: [0x9a7040, 0x84602e], side: 0x5a3a20, thick: 0.18, rail: 0x6b4a2b, cap: 0x7a5432 },
    rope:   { deck: [0xa88a58, 0x8a6e40], side: 0x6a5030, thick: 0.1, rail: 0x6b4a2b, cap: 0xc8b088 },
  };
  function bridgeModel(b) {
    const g = new C.Group(), st = BRIDGE_STYLE[b.style];
    const top = [], col = [], sides = [];
    const H_ = (x, y) => bridgeDeck(b, x, y);
    const tri = (arr, ...pts) => { for (const p of pts) arr.push(p[0], p[1], p[2]); };
    const shade = new C.Color();
    const inBridge = (x, y) => bridgeOf[idx(x, y)] === b.id;
    const pillarEvery = b.style === 'stone' ? 4 : b.style === 'timber' ? 2 : 0;
    const dx = b.x1 - b.x0, dy = b.y1 - b.y0, l2 = dx * dx + dy * dy || 1;
    const along = (x, y) => clamp(((x - b.x0) * dx + (y - b.y0) * dy) / l2, 0, 1) * b.len;
    for (const c of b.tiles) {
      const x = c % W, y = (c - x) / W;
      const cs = [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]].map(([px, py]) => [px, H_(px, py), py]);
      // Planks: alternating shades across the walking direction, with gaps on rope bridges.
      const k = Math.floor(along(x, y));
      if (b.style === 'rope' && (k + x + y) % 5 === 0) {
        // a missing plank
      } else {
        tri(top, cs[0], cs[3], cs[1], cs[1], cs[3], cs[2]);
        shade.setHex(st.deck[k % 2]).offsetHSL(0, 0, (rnd(c, 3) - 0.5) * 0.04);
        for (let n = 0; n < 6; n++) col.push(shade.r, shade.g, shade.b);
      }
      // Thick sides and railings along each edge that isn't bridge or a bank.
      const edges = [[1, 0, cs[1], cs[2]], [-1, 0, cs[3], cs[0]], [0, 1, cs[2], cs[3]], [0, -1, cs[0], cs[1]]];
      for (const [ex, ey, A, B] of edges) {
        const n = idx(x + ex, y + ey);
        if (inBridge(x + ex, y + ey) || (WALKABLE.has(terrain[n]) && terrain[n] !== T.BRIDGE)) continue;
        const A2 = [A[0], A[1] - st.thick, A[2]], B2 = [B[0], B[1] - st.thick, B[2]];
        tri(sides, A, B, B2, A, B2, A2);
        railing(g, b.style, st, A, B, rnd(c, ex * 3 + ey + 5));
      }
      // Pillars or posts down into the water at intervals.
      const bed = Math.min(-0.4, (b.bed && b.bed[c]) != null ? b.bed[c] : -0.6) - 0.3, dh = H_(x, y);
      if (pillarEvery && !b.pier && k % pillarEvery === 0 && k > 0 && k < b.len - 1 && rnd(c, 9) < (b.style === 'stone' ? 0.45 : 0.35)) {
        const ph = dh - st.thick - bed;
        if (b.style === 'stone') { g.add(box(0.9, ph, 0.9, st.side, x, bed + ph / 2, y)); g.add(cone(0.5, 0.5, st.side, x, bed + 0.4, y, 4)); }
        else { g.add(cyl(0.11, 0.13, ph, 0x4a3018, x, bed + ph / 2, y, 6)); const br = box(0.06, ph * 0.9, 0.06, 0x4a3018, x, bed + ph / 2, y); br.rotation.z = 0.5; g.add(br); }
      }
      if (b.pier && rnd(c, 4) < 0.5) g.add(cyl(0.1, 0.12, dh - bed, 0x4a3018, x + 0.4, bed + (dh - bed) / 2, y + 0.4, 6));
    }
    // Ramps onto each bank, with stone or timber footings where the deck stands proud of the ground.
    for (const c of b.approach) {
      const x = c % W, y = (c - x) / W;
      const cs = [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]].map(([px, py]) => [px, groundHeight(px, py) + 0.02, py]);
      tri(top, cs[0], cs[3], cs[1], cs[1], cs[3], cs[2]);
      shade.setHex(st.deck[(x + y) % 2]).offsetHSL(0, 0, -0.03);
      for (let n = 0; n < 6; n++) col.push(shade.r, shade.g, shade.b);
      const lo = Math.min(...[[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]].map(([px, py]) => terrainHeight(px, py)));
      const hi = Math.min(...cs.map(p => p[1]));
      if (hi - lo > 0.06) {
        const h = hi - lo + 0.3;
        if (b.style === 'stone') g.add(box(1.0, h, 1.0, st.side, x, lo - 0.3 + h / 2, y));
        else g.add(box(0.9, h, 0.9, 0x5a3a20, x, lo - 0.3 + h / 2, y));
      }
    }
    const tg = new C.BufferGeometry();
    tg.setAttribute('position', new C.Float32BufferAttribute(top, 3));
    tg.setAttribute('color', new C.Float32BufferAttribute(col, 3));
    tg.computeVertexNormals();
    const deck = new C.Mesh(tg, new C.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0, side: C.DoubleSide }));
    deck.position.y = 0.02;
    deck.receiveShadow = deck.castShadow = true;
    deck.userData.noBake = true;
    const sg = new C.BufferGeometry();
    sg.setAttribute('position', new C.Float32BufferAttribute(sides, 3));
    sg.computeVertexNormals();
    const side = new C.Mesh(sg, new C.MeshPhongMaterial({ color: st.side, flatShading: true, shininess: 0, side: C.DoubleSide }));
    side.userData.noBake = true;
    side.castShadow = true;
    g.add(deck, side);
    // Lamps or tall posts mark each end.
    for (const [ex, ey] of [[b.x0, b.y0], [b.x1, b.y1]]) {
      if (b.pier && ex === b.x1) continue;
      const nx = -(b.y1 - b.y0), ny = b.x1 - b.x0, nl = Math.hypot(nx, ny) || 1, half = 1.6;
      for (const sgn of [-1, 1]) {
        const px = ex + nx / nl * half * sgn, py = ey + ny / nl * half * sgn, ph = H_(px, py);
        if (b.style === 'stone') {
          g.add(box(0.45, 1.4, 0.45, st.side, px, ph + 0.7, py), box(0.55, 0.12, 0.55, st.cap, px, ph + 1.45, py));
          g.add(mesh(geo('BoxGeometry', 0.2, 0.25, 0.2), windowMat, px, ph + 1.65, py, false));
          const gl = glowSprite(0xffc870, 2.2); gl.position.set(px, ph + 1.65, py); g.add(gl);
        } else if (b.style === 'rope') g.add(cyl(0.1, 0.12, 2.0, 0x5a3a20, px, ph + 0.9, py, 6), cone(0.12, 0.2, 0x5a3a20, px, ph + 2.0, py, 6));
        else g.add(cyl(0.1, 0.12, 1.3, 0x5a3a20, px, ph + 0.6, py, 6));
      }
    }
    return g;
  }
  // One railing segment from corner A to corner B of a deck tile.
  function railing(g, style, st, A, B, r) {
    const mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2, my = (A[1] + B[1]) / 2;
    const len = Math.hypot(B[0] - A[0], B[2] - A[2]), yaw = Math.atan2(B[0] - A[0], B[2] - A[2]), tilt = Math.atan2(B[1] - A[1], len);
    const seg = (w, h, d, color, y) => { const m = box(w, h, d, color, mx, my + y, mz); m.rotation.order = 'YXZ'; m.rotation.y = yaw; m.rotation.x = -tilt; g.add(m); return m; };
    if (style === 'stone') {
      seg(0.28, 0.6, len + 0.02, st.rail, 0.3);
      seg(0.36, 0.1, len + 0.04, st.cap, 0.64);
    } else if (style === 'timber') {
      g.add(box(0.11, 0.85, 0.11, st.rail, A[0], A[1] + 0.42, A[2]));
      seg(0.08, 0.08, len + 0.05, st.cap, 0.8);
      seg(0.06, 0.06, len + 0.05, st.cap, 0.45);
    } else {
      if (r < 0.5) g.add(box(0.07, 0.95, 0.07, st.rail, A[0], A[1] + 0.47, A[2]));
      seg(0.035, 0.035, len + 0.05, st.cap, 0.85);
      seg(0.03, 0.03, len + 0.05, st.cap, 0.5);
    }
  }

  function waterTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    g.fillStyle = '#c4d9ea';
    g.fillRect(0, 0, 128, 128);
    for (let k = 0; k < 70; k++) {
      g.strokeStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
      g.lineWidth = 1 + Math.random() * 1.5;
      const x = Math.random() * 118, y = Math.random() * 124, l = 5 + Math.random() * 12;
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + l / 2, y - 3, x + l, y); g.stroke();
    }
    const t = new C.CanvasTexture(cv);
    t.wrapS = t.wrapT = C.RepeatWrapping;
    return t;
  }

  // ------------------------------------------------------------ the Long Winter
  // Snow creeps south over the land as the story goes on; in deep winter the northern lakes freeze.
  const snowEdge = cx => winterLine() + Math.sin(cx * 0.13) * 2.5 + Math.sin(cx * 0.041 + 1) * 5;
  function setWinter() {
    const col = groundGeo.attributes.color.array, VW = W + 1;
    for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) {
      const v = cy * VW + cx, k = v * 3;
      const amt = cornerH[v] < -0.05 ? 0 : clamp((snowEdge(cx) - cy) / 6, 0, 1) * 0.85;
      col[k] = lerp(baseCol[k], 0.93, amt); col[k + 1] = lerp(baseCol[k + 1], 0.96, amt); col[k + 2] = lerp(baseCol[k + 2], 0.99, amt);
    }
    groundGeo.attributes.color.needsUpdate = true;
    if (iceMesh) { scene.remove(iceMesh); iceMesh.dispose(); iceMesh = null; }
    const ice = [];
    for (let y = 0; y < winterLine(); y++) for (let x = 0; x < W; x++) if (iceAt(x, y)) ice.push([x, y]);
    if (ice.length) {
      iceMesh = new C.InstancedMesh(geo('BoxGeometry', 1.02, 0.08, 1.02), new C.MeshPhongMaterial({ color: 0xd8ecf8, shininess: 70, specular: 0xffffff, flatShading: true }), ice.length);
      ice.forEach(([x, y], k) => iceMesh.setMatrixAt(k, new C.Matrix4().makeTranslation(x, 0.0, y)));
      iceMesh.receiveShadow = true;
      iceMesh.frustumCulled = false;
      scene.add(iceMesh);
    }
    streamX = streamY = -999;
    clutterX = -999;
  }
  const snowyAt = (x, y) => y < snowEdge(x) - 2;

  // ------------------------------------------------------------ resource nodes (streamed around the player)
  const SNOW_TINT = new C.Color(0xf2f8fc);
  const AUTUMN = [0xd8702a, 0xc0402a, 0xe0a030, 0xa85a2a].map(h => new C.Color(h)), BLOSSOM = new C.Color(0xf4b8d0), tmpC = new C.Color();
  // Leaves turn with the seasons: blossom in spring, gold and red in autumn, frost in winter.
  function seasonTint(c, res, i) {
    const s = seasonIdx(), leafy = res === 'oak';
    if (s === 0 && leafy && rnd(i, 31) < 0.3) c.lerp(BLOSSOM, 0.6);
    else if (s === 2 && leafy) c.lerp(AUTUMN[Math.floor(rnd(i, 32) * 4)], 0.75);
    else if (s === 2) c.lerp(tmpC.setHex(0x8a7a3a), 0.15);
    else if (s === 3) c.lerp(SNOW_TINT, leafy ? 0.45 : 0.3);
  }
  const ORE = { copper: [0x8a6f5a, 0xff8c3a], iron: [0x7d7570, 0xeadbcc], coal: [0x55524e, 0x141416], bogiron: [0x5a5242, 0xb8622a], gold: [0x8a7f68, 0xffd23a] };
  function nodeParts(res) {
    switch (res) {
      case 'pine': return [
        { g: geo('CylinderGeometry', 0.08, 0.12, 0.6, 5), c: 0x6b4a2b, y: 0.3 },
        { g: geo('ConeGeometry', 0.6, 1.1, 7), c: 0x2f6b35, y: 1.0, vary: 1 },
        { g: geo('ConeGeometry', 0.45, 0.9, 7), c: 0x3a8442, y: 1.55, vary: 1 }];
      case 'oak': return [
        { g: geo('CylinderGeometry', 0.13, 0.19, 0.9, 6), c: 0x5e4026, y: 0.45 },
        { g: geo('IcosahedronGeometry', 0.75, 0), c: 0x66a83d, y: 1.35, sy: 0.85, vary: 1 }];
      case 'ironwood': return [
        { g: geo('CylinderGeometry', 0.13, 0.2, 1.2, 6), c: 0x3b3030, y: 0.6 },
        { g: geo('ConeGeometry', 0.6, 2.3, 5), c: 0x25a888, y: 2.0, vary: 1 }];
      case 'copper': case 'iron': case 'coal': case 'bogiron': case 'gold': return [
        { g: geo('DodecahedronGeometry', 0.45, 0), c: ORE[res][0], y: 0.22, sy: 0.75, vary: 1 },
        { g: geo('OctahedronGeometry', 0.12, 0), c: ORE[res][1], y: 0.42, x: 0.16, z: 0.12 },
        { g: geo('OctahedronGeometry', 0.1, 0), c: ORE[res][1], y: 0.34, x: -0.2, z: -0.05 }];
      case 'frostwood': return [
        { g: geo('CylinderGeometry', 0.1, 0.15, 0.8, 5), c: 0x8a8e96, y: 0.4 },
        { g: geo('ConeGeometry', 0.68, 1.2, 7), c: 0xa8c8d8, y: 1.15, vary: 1 },
        { g: geo('ConeGeometry', 0.5, 1.0, 7), c: 0xd8eaf2, y: 1.75, vary: 1 },
        { g: geo('ConeGeometry', 0.3, 0.7, 7), c: 0xf4fbff, y: 2.3, vary: 1 }];
      case 'bush': return [
        { g: geo('IcosahedronGeometry', 0.34, 0), c: 0x3d7a35, y: 0.28, sy: 0.8, vary: 1 },
        { g: geo('IcosahedronGeometry', 0.05, 0), c: 0xc2342a, y: 0.42, x: 0.15, z: 0.18 },
        { g: geo('IcosahedronGeometry', 0.05, 0), c: 0xc2342a, y: 0.36, x: -0.2, z: 0.1 }];
      case 'starrock': return [
        { g: geo('DodecahedronGeometry', 0.5, 0), c: 0x3a3f5a, y: 0.25, sy: 0.8, vary: 1 },
        { g: geo('OctahedronGeometry', 0.16, 0), c: 0xc8a8ff, y: 0.6, x: 0.1, glow: 0x7a4aff },
        { g: geo('OctahedronGeometry', 0.12, 0), c: 0xc8a8ff, y: 0.48, x: -0.22, z: 0.1, glow: 0x7a4aff }];
      case 'pebbles': return [
        { g: geo('DodecahedronGeometry', 0.13, 0), c: 0x8d8780, y: 0.07, x: 0.1 },
        { g: geo('DodecahedronGeometry', 0.1, 0), c: 0x7a746d, y: 0.05, x: -0.12, z: 0.08 },
        { g: geo('DodecahedronGeometry', 0.09, 0), c: 0x9a948c, y: 0.05, z: -0.15 }];
    }
    return [];
  }

  function buildNodeMeshes() {
    const counts = {};
    let trees = 0, rocks = 0, fish = 0;
    for (const n of nodes.values()) {
      counts[n.res] = (counts[n.res] || 0) + 1;
      const sk = RESOURCES[n.res].skill;
      if (sk === 'woodcutting') trees++; else if (sk === 'mining') rocks++; else if (sk === 'fishing') fish++;
    }
    for (const res in counts) {
      if (RESOURCES[res].skill === 'fishing') continue;
      nodeMeshes[res] = nodeParts(res).map(p => {
        const im = new C.InstancedMesh(p.g, new C.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0, emissive: p.glow || 0 }), counts[res]);
        // Colours must exist before the first render, or the shader is built without them.
        im.instanceColor = new C.InstancedBufferAttribute(new Float32Array(counts[res] * 3).fill(1), 3);
        im.castShadow = res !== 'pebbles';
        im.count = 0;
        im.frustumCulled = false;
        im.userData.tiles = [];
        scene.add(im);
        pickables.push(im);
        return { im, p };
      });
    }
    stumpMesh = new C.InstancedMesh(geo('CylinderGeometry', 0.16, 0.2, 0.2, 6), mat(0x6b4a2b), trees);
    rubbleMesh = new C.InstancedMesh(geo('DodecahedronGeometry', 0.3, 0), mat(0x5d5852), rocks);
    const ringGeo = new C.RingGeometry(0.16, 0.24, 20);
    ringGeo.rotateX(-Math.PI / 2);
    ringMesh = new C.InstancedMesh(ringGeo, new C.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), fish * 2);
    ringMesh.instanceColor = new C.InstancedBufferAttribute(new Float32Array(fish * 2 * 3).fill(1), 3);
    for (const m of [stumpMesh, rubbleMesh, ringMesh]) { m.count = 0; m.frustumCulled = false; scene.add(m); }
    stumpMesh.castShadow = true;
    ringMesh.userData.tiles = [];
    pickables.push(ringMesh);
  }

  // Refill the instanced meshes with every node near the player.
  function streamNodes(now) {
    streamX = Math.round(player.vx); streamY = Math.round(player.vz);
    for (const res in nodeMeshes) for (const { im } of nodeMeshes[res]) { im.count = 0; im.userData.tiles.length = 0; }
    stumpMesh.count = rubbleMesh.count = ringMesh.count = 0;
    ringMesh.userData.tiles.length = 0;
    nodeSlots.clear();
    fishSlots.length = 0;
    const tmp = new C.Matrix4(), local = new C.Matrix4(), q = new C.Quaternion(), e = new C.Euler(), v = new C.Vector3(), sc = new C.Vector3();
    const tint = { minnow: 0xe8f6ff, trout: 0x8ff0ff, pike: 0xc4a8ff };
    for (const [i, n] of nodes) {
      const x = i % W, y = (i - x) / W;
      if (Math.abs(x - streamX) > STREAM_R || Math.abs(y - streamY) > STREAM_R) continue;
      const r = RESOURCES[n.res];
      if (r.skill === 'fishing') {
        for (let k = 0; k < 2; k++) {
          const slot = ringMesh.count++;
          ringMesh.setColorAt(slot, new C.Color(tint[n.res]));
          ringMesh.userData.tiles[slot] = i;
          fishSlots.push({ x, y, slot, phase: k * 0.5 + rnd(i, 11), n });
        }
        continue;
      }
      const tree = r.skill === 'woodcutting', rock = r.skill === 'mining';
      const s = tree ? 0.85 + rnd(i, 6) * 0.45 : 0.85 + rnd(i, 6) * 0.3;
      const base = new C.Matrix4().compose(
        v.set(x + (rnd(i, 8) - 0.5) * 0.2, gh(x, y), y + (rnd(i, 9) - 0.5) * 0.2),
        q.setFromEuler(e.set(0, rnd(i, 7) * Math.PI * 2, 0)), sc.set(s, s, s));
      const slotK = nodeMeshes[n.res][0].im.count;
      nodeMeshes[n.res].forEach(({ im, p }) => {
        local.compose(v.set(p.x || 0, p.y, p.z || 0), q.identity(), sc.set(1, p.sy || 1, 1));
        im.setMatrixAt(im.count, tmp.copy(base).multiply(local));
        const c = new C.Color(p.c).offsetHSL(0, 0, p.vary ? (rnd(i, 10) - 0.5) * 0.1 : 0);
        if (p.vary && snowyAt(x, y)) c.lerp(SNOW_TINT, 0.55);
        else if (p.vary && tree) seasonTint(c, n.res, i);
        im.setColorAt(im.count, c);
        im.userData.tiles[im.count] = i;
        im.count++;
      });
      const slot = { res: n.res, k: slotK, base, active: true, n, alt: null };
      if (tree) { slot.alt = { im: stumpMesh, k: stumpMesh.count++ }; stumpMesh.setMatrixAt(slot.alt.k, HIDE); }
      if (rock) { slot.alt = { im: rubbleMesh, k: rubbleMesh.count++ }; rubbleMesh.setMatrixAt(slot.alt.k, HIDE); }
      nodeSlots.set(i, slot);
    }
    for (const res in nodeMeshes) for (const { im } of nodeMeshes[res]) {
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    for (const m of [stumpMesh, rubbleMesh, ringMesh]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    for (const s of nodeSlots.values()) s.active = true;
    scanNodes(now);
  }

  // Swap depleted trees and rocks for stumps and rubble.
  function scanNodes(now) {
    const local = new C.Matrix4(), v = new C.Vector3(), q = new C.Quaternion(), sc = new C.Vector3();
    const dirty = new Set();
    for (const s of nodeSlots.values()) {
      const active = s.n.until <= now;
      if (active === s.active) continue;
      s.active = active;
      nodeMeshes[s.res].forEach(({ im, p }) => {
        if (active) {
          local.compose(v.set(p.x || 0, p.y, p.z || 0), q.identity(), sc.set(1, p.sy || 1, 1));
          im.setMatrixAt(s.k, new C.Matrix4().copy(s.base).multiply(local));
        } else im.setMatrixAt(s.k, HIDE);
        dirty.add(im);
      });
      if (s.alt) {
        const m = s.alt.im === stumpMesh ? new C.Matrix4().makeTranslation(0, 0.1, 0) : new C.Matrix4().compose(v.set(0, 0.05, 0), q.identity(), sc.set(1, 0.35, 1));
        s.alt.im.setMatrixAt(s.alt.k, active ? HIDE : new C.Matrix4().copy(s.base).multiply(m));
        dirty.add(s.alt.im);
      }
    }
    for (const im of dirty) im.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------ characters
  function limb(w, h, color) {
    const pivot = new C.Group();
    pivot.add(mesh(geo('BoxGeometry', w, h, w), mat(color), 0, -h / 2, 0));
    return pivot;
  }

  function humanoid(o) {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const a = { g, inner, kind: 'human', height: 1.4 * (o.scale || 1) };
    a.body = mesh(geo('BoxGeometry', 0.42, 0.5, 0.26), mat(o.tunic), 0, 0.75, 0);
    a.head = mesh(geo('BoxGeometry', 0.3, 0.3, 0.3), mat(o.skin), 0, 1.18, 0);
    for (const s of [-1, 1]) a.head.add(mesh(geo('BoxGeometry', 0.05, 0.06, 0.02), mat(0x1a1a1a), s * 0.07, 0.02, 0.155, false));
    a.legL = limb(0.15, 0.5, o.legs); a.legL.position.set(-0.11, 0.5, 0);
    a.legR = limb(0.15, 0.5, o.legs); a.legR.position.set(0.11, 0.5, 0);
    a.armL = limb(0.12, 0.46, o.sleeve || o.tunic); a.armL.position.set(-0.28, 0.98, 0);
    a.armR = limb(0.12, 0.46, o.sleeve || o.tunic); a.armR.position.set(0.28, 0.98, 0);
    a.hand = new C.Group(); a.hand.position.y = -0.44; a.armR.add(a.hand);
    inner.add(a.body, a.head, a.legL, a.legR, a.armL, a.armR);
    inner.scale.setScalar(o.scale || 1);
    return a;
  }

  function wolf() {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const fur = 0x8f8f96;
    inner.add(box(0.34, 0.32, 0.78, fur, 0, 0.5, 0), box(0.28, 0.27, 0.3, fur, 0, 0.64, 0.48), box(0.14, 0.12, 0.2, 0x6f6f76, 0, 0.58, 0.7));
    inner.add(cone(0.06, 0.14, fur, -0.08, 0.83, 0.45, 4), cone(0.06, 0.14, fur, 0.08, 0.83, 0.45, 4));
    for (const s of [-1, 1]) inner.add(box(0.05, 0.05, 0.02, 0xffd23a, s * 0.08, 0.68, 0.635));
    const tail = box(0.1, 0.1, 0.4, fur, 0, 0.6, -0.5);
    tail.rotation.x = -0.6;
    inner.add(tail);
    const legs = [];
    for (const [x, z] of [[-0.11, 0.26], [0.11, 0.26], [-0.11, -0.26], [0.11, -0.26]]) {
      const l = limb(0.1, 0.36, 0x77777e);
      l.position.set(x, 0.38, z);
      inner.add(l); legs.push(l);
    }
    return { g, inner, kind: 'wolf', legs, height: 0.9 };
  }

  function drake() {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const skin = 0xa8d8f0, dark = 0x5a8ab0;
    inner.add(box(0.9, 0.7, 1.8, skin, 0, 1.0, 0), box(0.4, 0.5, 0.7, skin, 0, 1.45, 1.0), box(0.45, 0.35, 0.6, skin, 0, 1.75, 1.45));
    inner.add(box(0.3, 0.12, 0.3, dark, 0, 1.62, 1.75));
    for (const s of [-1, 1]) {
      inner.add(cone(0.06, 0.4, 0xf2f6ff, s * 0.15, 2.05, 1.3, 4), box(0.07, 0.07, 0.02, 0xff5a3a, s * 0.14, 1.82, 1.76));
    }
    for (let k = 0; k < 5; k++) inner.add(cone(0.08, 0.25, dark, 0, 1.45, 0.7 - k * 0.35, 4));
    const tail = box(0.3, 0.25, 1.4, skin, 0, 0.9, -1.5);
    tail.rotation.x = 0.25;
    inner.add(tail);
    const wings = [];
    for (const s of [-1, 1]) {
      const pivot = new C.Group();
      pivot.position.set(s * 0.45, 1.3, 0.2);
      const w = box(1.6, 0.05, 1.1, dark, s * 0.8, 0, 0);
      pivot.add(w);
      inner.add(pivot);
      wings.push({ pivot, s });
    }
    const legs = [];
    for (const [x, z] of [[-0.35, 0.6], [0.35, 0.6], [-0.35, -0.6], [0.35, -0.6]]) {
      const l = limb(0.22, 0.7, dark);
      l.position.set(x, 0.7, z);
      inner.add(l); legs.push(l);
    }
    inner.scale.setScalar(1.25);
    return { g, inner, kind: 'wolf', legs, wings, height: 2.8 };
  }

  function tool(kind, tier) {
    const g = new C.Group(), metal = TIER_COLORS[tier] || 0x9c9c9c, wood = 0x6b4a2b;
    const handle = len => { const h = cyl(0.025, 0.025, len, wood, 0, 0, len / 2 - 0.05, 5); h.rotation.x = Math.PI / 2; return h; };
    if (kind === 'axe') g.add(handle(0.55), box(0.04, 0.2, 0.14, metal, 0, 0.06, 0.45));
    if (kind === 'pickaxe') g.add(handle(0.55), box(0.04, 0.42, 0.06, metal, 0, 0, 0.47));
    if (kind === 'hammer') g.add(handle(0.4), box(0.1, 0.1, 0.18, 0x55555c, 0, 0, 0.36));
    if (kind === 'sword') g.add(box(0.05, 0.04, 0.12, wood, 0, 0, 0.02), box(0.18, 0.04, 0.04, metal, 0, 0, 0.09), box(0.06, 0.03, 0.62, metal, 0, 0, 0.42));
    if (kind === 'club') { const c = cyl(0.05, 0.11, 0.7, 0x6b4a2b, 0, 0, 0.35, 6); c.rotation.x = Math.PI / 2; g.add(c); }
    if (kind === 'bigclub') { const c = cyl(0.06, 0.14, 0.85, 0x5a3e24, 0, 0, 0.42, 6); c.rotation.x = Math.PI / 2; g.add(c); }
    if (kind === 'dagger') g.add(box(0.04, 0.03, 0.3, 0xaaaaaa, 0, 0, 0.18));
    if (kind === 'spear') { const s = cyl(0.025, 0.025, 1.4, wood, 0, 0.4, 0, 5); g.add(s, cone(0.05, 0.16, 0xb0b0b8, 0, 1.18, 0, 4)); }
    if (kind === 'rod') {
      const r = cyl(0.015, 0.025, 1.3, 0x8a6a3a, 0, 0.3, 0.55, 5);
      r.rotation.x = Math.PI / 2 - 0.5;
      g.add(r);
    }
    return g;
  }

  function buildPlayer() {
    const a = humanoid({ tunic: 0x2f5d9e, skin: 0xe2b48c, legs: 0x5b4630, scale: 0.85 });
    a.hair = box(0.32, 0.1, 0.32, 0x5a3a1e, 0, 1.36, -0.01);
    a.helm = box(0.34, 0.16, 0.34, 0x9c9c9c, 0, 1.36, 0);
    a.shield = box(0.06, 0.42, 0.34, 0x9c9c9c, -0.09, -0.26, 0.05);
    a.inner.add(a.hair, a.helm);
    a.armL.add(a.shield);
    a.equipKey = '';
    a.vx = state.px; a.vz = state.py; a.rot = state.face;
    a.boat = sailboatModel();
    a.boat.visible = false;
    a.g.add(a.boat);
    a.horse = animal('horse');
    a.horse.g.visible = false;
    a.g.add(a.horse.g);
    a.bar = hpBar();
    a.bar.g.position.y = a.height + 0.3;
    a.g.add(a.bar.g);
    scene.add(a.g);
    return a;
  }

  // A covered wagon with its horse and driver; guards walk alongside.
  function caravanModel(guards) {
    const g = new C.Group();
    g.add(box(0.8, 0.3, 1.5, 0x7a5232, 0, 0.55, 0));
    const cover = new C.Mesh(geo('CylinderGeometry', 0.5, 0.5, 1.4, 10, 1, false, 0, Math.PI), mat(0xeee6d0));
    cover.rotation.z = Math.PI / 2; cover.rotation.y = Math.PI / 2; cover.position.set(0, 0.7, 0);
    g.add(cover);
    for (const [x, z] of [[-0.45, -0.5], [0.45, -0.5], [-0.45, 0.5], [0.45, 0.5]]) { const w = cyl(0.28, 0.28, 0.07, 0x4a3220, x, 0.28, z, 10); w.rotation.z = Math.PI / 2; g.add(w); }
    g.add(box(0.06, 0.06, 0.9, 0x6b4a2b, -0.18, 0.45, 1.1), box(0.06, 0.06, 0.9, 0x6b4a2b, 0.18, 0.45, 1.1));
    const horse = new C.Group();
    horse.add(box(0.3, 0.32, 0.7, 0x7a4a2a, 0, 0.62, 0), box(0.18, 0.32, 0.18, 0x7a4a2a, 0, 0.9, 0.38), box(0.16, 0.14, 0.26, 0x6a3a1a, 0, 0.98, 0.52));
    for (const [lx, lz] of [[-0.1, 0.25], [0.1, 0.25], [-0.1, -0.25], [0.1, -0.25]]) horse.add(box(0.08, 0.46, 0.08, 0x5a3a1a, lx, 0.23, lz));
    horse.position.z = 1.65;
    g.add(horse);
    const driver = townsfolk(0x6a4a8a);
    driver.g.position.set(0, 0.5, 0.75); driver.g.scale.setScalar(0.9);
    g.add(driver.g);
    for (let k = 0; k < guards; k++) {
      const a = worker(0x5a5f6a, 'spear');
      a.g.position.set(k % 2 ? 0.75 : -0.75, 0, -0.3 + Math.floor(k / 2) * 0.9);
      g.add(a.g);
      g.userData.walkers = (g.userData.walkers || []).concat(a);
    }
    g.userData.horse = horse;
    return g;
  }

  // Your sailboat: the player stands amidships.
  function sailboatModel() {
    const g = new C.Group();
    g.add(box(0.95, 0.32, 2.0, 0x7a5232, 0, 0.06, 0), box(0.75, 0.08, 1.7, 0x5a3a20, 0, 0.2, 0), box(0.1, 0.36, 2.0, 0x8a6338, 0.47, 0.12, 0), box(0.1, 0.36, 2.0, 0x8a6338, -0.47, 0.12, 0));
    const prow = cone(0.48, 0.7, 0x7a5232, 0, 0.1, 1.3, 4); prow.rotation.x = Math.PI / 2; prow.rotation.y = Math.PI / 4; prow.scale.set(1, 1, 0.5); g.add(prow);
    g.add(cyl(0.045, 0.05, 2.6, 0x5a3a1e, 0, 1.45, 0.35, 5), box(1.4, 0.06, 0.06, 0x5a3a1e, 0, 2.5, 0.35), box(1.4, 0.06, 0.06, 0x5a3a1e, 0, 0.8, 0.35));
    const sail = new C.Mesh(geo('PlaneGeometry', 1.25, 1.7), new C.MeshLambertMaterial({ color: 0xeee6d0, side: C.DoubleSide }));
    sail.position.set(0, 1.65, 0.3);
    g.add(sail);
    g.add(box(0.05, 0.4, 0.6, 0xb0302a, 0, 2.55, 0.35));
    g.userData.sail = sail;
    return g;
  }

  function setPlayerTool(kind, tier) {
    const key = kind ? `${kind}:${tier}` : '';
    if (player.toolKey === key) return;
    player.toolKey = key;
    player.hand.clear();
    if (kind) player.hand.add(tool(kind, tier));
  }

  // Armour you can see: helmets, breastplates and shoulder guards, leg armour and boots, in each set's colour.
  const shadeHex = (c, k) => new C.Color(c).offsetHSL(0, 0, k).getHex();
  function updatePlayerGear() {
    const eq = state.equip, key = JSON.stringify(eq);
    if (key === player.equipKey) return;
    player.equipKey = key;
    for (const m of player.armor || []) if (m.parent) m.parent.remove(m);
    player.armor = [];
    const add = (parent, o) => { parent.add(o); player.armor.push(o); return o; };
    const look = id => { const it = ITEMS[id]; return { c: it.color != null ? it.color : TIER_COLORS[it.tier] || 0x9c9c9c, fam: it.family, tier: it.tier, metal: it.color == null }; };
    const furry = f => f === 'bearfur' || f === 'leather' || f === 'lurker';
    const scaly = f => f === 'drake' || f === 'wurm';

    if (eq.body) {
      const L = look(eq.body), dark = shadeHex(L.c, -0.18), light = shadeHex(L.c, 0.15);
      player.body.material = mat(L.c);
      add(player.body, box(0.45, 0.07, 0.29, 0x3a2614, 0, -0.17, 0));
      if (L.metal) add(player.body, box(0.06, 0.38, 0.02, light, 0, 0.04, 0.135));
      if (L.fam === 'bearfur') add(player.body, box(0.5, 0.11, 0.34, 0xf4f6f8, 0, 0.23, 0));
      for (const arm of [player.armL, player.armR]) {
        if (furry(L.fam)) add(arm, mesh(geo('IcosahedronGeometry', 0.13, 0), mat(L.c), 0, -0.02, 0));
        else add(arm, box(0.21, 0.12, 0.23, dark, 0, -0.01, 0));
        if (scaly(L.fam) || L.fam === 'troll') { const sp = cone(0.04, 0.16, light, 0, 0.1, 0, 4); add(arm, sp); }
        arm.children[0].material = mat(furry(L.fam) ? L.c : dark);
      }
    } else {
      player.body.material = mat(0x2f5d9e);
      for (const arm of [player.armL, player.armR]) arm.children[0].material = mat(0x2f5d9e);
    }

    player.hair.visible = !eq.head;
    player.helm.visible = false;
    if (eq.head) {
      const L = look(eq.head), light = shadeHex(L.c, 0.15), h = player.head;
      if (L.metal) {
        add(h, box(0.34, 0.17, 0.34, L.c, 0, 0.1, 0));
        add(h, box(0.05, 0.16, 0.03, L.c, 0, -0.02, 0.165));
        if (L.tier >= 3) add(h, box(0.04, 0.12, 0.3, L.tier >= 4 ? 0x8f7bff : 0xb0302a, 0, 0.24, -0.02));
      } else if (furry(L.fam)) {
        add(h, box(0.36, 0.2, 0.36, L.c, 0, 0.1, -0.01));
        add(h, box(0.32, 0.28, 0.07, L.c, 0, -0.04, -0.17));
        if (L.fam === 'bearfur') add(h, box(0.38, 0.06, 0.38, 0xf4f6f8, 0, 0.02, 0));
      } else {
        add(h, box(0.35, 0.18, 0.35, L.c, 0, 0.1, 0));
        add(h, box(0.05, 0.14, 0.03, L.c, 0, -0.02, 0.165));
        for (const sx of [-1, 1]) {
          const horn = cone(0.05, L.fam === 'troll' ? 0.14 : 0.26, light, sx * 0.17, 0.22, 0, 5);
          horn.rotation.z = -sx * 0.5;
          add(h, horn);
        }
        if (L.fam === 'wurm') for (let k = 0; k < 3; k++) add(h, cone(0.03, 0.14, 0x9adfff, -0.08 + k * 0.08, 0.26, 0.12, 4));
      }
    }

    for (const leg of [player.legL, player.legR]) {
      if (eq.legs) {
        const L = look(eq.legs);
        leg.children[0].material = mat(L.c);
        if (L.metal || scaly(L.fam)) add(leg, box(0.17, 0.1, 0.05, shadeHex(L.c, 0.15), 0, -0.22, 0.08));
      } else leg.children[0].material = mat(0x5b4630);
      if (eq.feet) {
        const L = look(eq.feet);
        add(leg, box(0.18, 0.14, 0.25, L.c, 0, -0.47, 0.03));
        if (furry(L.fam)) add(leg, box(0.2, 0.05, 0.2, shadeHex(L.c, 0.2), 0, -0.38, 0));
      }
    }

    player.shield.visible = !!eq.shield;
    if (eq.shield) player.shield.material = mat(TIER_COLORS[ITEMS[eq.shield].tier] || 0x9c9c9c);
  }

  function hpBar() {
    const g = new C.Group();
    const bg = new C.Sprite(new C.SpriteMaterial({ color: 0x3a0a08, depthTest: false, fog: false }));
    const fg = new C.Sprite(new C.SpriteMaterial({ color: 0x4fc23a, depthTest: false, fog: false }));
    bg.scale.set(0.8, 0.1, 1); fg.scale.set(0.8, 0.1, 1);
    bg.renderOrder = 11; fg.renderOrder = 12;
    fg.center.set(0, 0.5); fg.position.x = -0.4;
    g.add(bg, fg);
    g.visible = false;
    return { g, fg };
  }
  function setBar(bar, ratio, show) {
    bar.g.visible = show;
    bar.fg.scale.x = 0.8 * clamp(ratio, 0, 1);
    bar.fg.material.color.setHex(ratio > 0.5 ? 0x4fc23a : ratio > 0.25 ? 0xe0b23a : 0xd8402f);
  }

  // Generic four-legged beast built from a few boxes.
  function beast(o) {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const [bw, bh, bd] = o.body, y = o.legH + bh / 2 - 0.05;
    inner.add(box(bw, bh, bd, o.color, 0, y, 0), box(bw * 0.7, bh * 0.75, bd * 0.35, o.color, 0, y + bh * 0.15, bd * 0.6));
    for (const sx of [-1, 1]) inner.add(box(0.06, 0.06, 0.02, o.eye || 0x1a1a1a, sx * bw * 0.2, y + bh * 0.25, bd * 0.78));
    const legs = [];
    for (const [x, z] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const l = limb(o.legW, o.legH + 0.05, o.leg || o.color);
      l.position.set(x * (bw / 2 - o.legW / 2), o.legH, z * (bd / 2 - o.legW));
      inner.add(l); legs.push(l);
    }
    return { g, inner, kind: 'wolf', legs, height: o.legH + bh + 0.2 };
  }

  function skeletonBody(scale, robe) {
    const a = humanoid({ tunic: robe || 0xd8d2bc, skin: 0xe8e2cc, legs: 0xd8d2bc, sleeve: 0xe8e2cc, scale });
    a.body.scale.set(0.7, 1, 0.7);
    for (const sx of [-1, 1]) a.head.add(box(0.09, 0.08, 0.02, 0x0a0a0a, sx * 0.07, 0.03, 0.155));
    a.head.add(box(0.2, 0.05, 0.02, 0x2a2a24, 0, -0.09, 0.155));
    for (let k = 0; k < 3; k++) a.body.add(box(0.5, 0.04, 0.3, 0xe8e2cc, 0, 0.12 - k * 0.12, 0));
    return a;
  }

  function wurm() {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const skin = 0xb8d8e8, belly = 0xe8f2f8, spine = 0x5a7a9a;
    for (let k = 0; k < 7; k++) {
      const s = 1 - k * 0.09, z = -k * 0.75, y = 0.5 + Math.sin(k * 0.9) * 0.18;
      inner.add(box(1.1 * s, 0.9 * s, 0.8, skin, 0, y, z), box(0.9 * s, 0.2, 0.7, belly, 0, y - 0.45 * s, z), cone(0.12, 0.35 * s, spine, 0, y + 0.55 * s, z, 4));
    }
    inner.add(box(1.2, 0.8, 0.9, skin, 0, 1.1, 0.7), box(1.0, 0.25, 0.7, belly, 0, 0.75, 0.95));
    for (const sx of [-1, 1]) {
      inner.add(mesh(geo('BoxGeometry', 0.12, 0.1, 0.04), glow(0x5ad0ff), sx * 0.32, 1.25, 1.16, false));
      const fang = cone(0.06, 0.28, 0xf8f8f0, sx * 0.25, 0.62, 1.2, 4); fang.rotation.x = Math.PI; inner.add(fang);
      const horn = cone(0.1, 0.6, 0xe8f0f8, sx * 0.4, 1.65, 0.5, 5); horn.rotation.x = -0.6; inner.add(horn);
    }
    inner.scale.setScalar(1.3);
    return { g, inner, kind: 'wolf', legs: [], height: 2.4 };
  }

  function scorpion() {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const c = 0x9a6a2a, d = 0x6a4418;
    inner.add(box(0.6, 0.25, 0.75, c, 0, 0.32, 0), box(0.45, 0.2, 0.3, c, 0, 0.32, 0.48));
    for (const sx of [-1, 1]) {
      const arm = box(0.1, 0.08, 0.45, d, sx * 0.32, 0.35, 0.75); arm.rotation.y = -sx * 0.4; inner.add(arm);
      inner.add(box(0.2, 0.12, 0.22, c, sx * 0.45, 0.35, 1.02), box(0.05, 0.05, 0.02, 0x1a1a1a, sx * 0.08, 0.44, 0.64));
    }
    let y = 0.4, z = -0.4;
    for (let k = 0; k < 5; k++) {
      const seg = box(0.16 - k * 0.015, 0.16, 0.22, k % 2 ? d : c, 0, y, z);
      inner.add(seg);
      y += 0.18; z -= 0.12 - k * 0.07;
    }
    const sting = cone(0.06, 0.25, 0x2a1a0a, 0, y, z + 0.12, 4); sting.rotation.x = 1.9; inner.add(sting);
    const legs = [];
    for (const [x, zz] of [[-0.35, 0.2], [0.35, 0.2], [-0.35, -0.15], [0.35, -0.15]]) {
      const l = limb(0.06, 0.3, d);
      l.position.set(x, 0.3, zz); l.rotation.z = x < 0 ? -0.6 : 0.6;
      inner.add(l); legs.push(l);
    }
    return { g, inner, kind: 'wolf', legs, height: 1.0 };
  }

  function makeMonster(m) {
    let a;
    if (m.type === 'wolf') a = wolf();
    else if (m.type === 'lurker') {
      a = beast({ body: [0.7, 0.45, 1.0], color: 0x4a5a3a, leg: 0x3a4a2a, legW: 0.14, legH: 0.28, eye: 0xe8e03a });
      for (let k = 0; k < 4; k++) a.inner.add(cone(0.07, 0.22, 0x2a3a1a, 0, 0.78, 0.3 - k * 0.25, 4));
      for (let k = 0; k < 3; k++) a.inner.add(box(0.75, 0.04, 0.08, 0x6a7a3a, 0, 0.75, 0.2 - k * 0.3));
    } else if (m.type === 'scorpion') a = scorpion();
    else if (m.type === 'bear') {
      a = beast({ body: [0.8, 0.75, 1.3], color: 0xeef2f4, leg: 0xd8dee2, legW: 0.22, legH: 0.42 });
      a.inner.add(box(0.2, 0.14, 0.2, 0x2a2a2a, 0, 0.98, 1.22));
      for (const sx of [-1, 1]) a.inner.add(box(0.12, 0.12, 0.08, 0xd8dee2, sx * 0.2, 1.28, 0.85));
      a.inner.scale.setScalar(1.15);
      a.height = 1.6;
    } else if (m.type === 'pirate') {
      a = humanoid({ tunic: 0xe8e0d0, skin: 0xc8946a, legs: 0x2a2a3a, sleeve: 0xe8e0d0, scale: 0.88 });
      a.body.add(box(0.44, 0.08, 0.28, 0x2a2a2a, 0, -0.1, 0), box(0.1, 0.5, 0.28, 0x8a2020, 0.1, 0, 0.01));
      a.head.add(box(0.31, 0.1, 0.31, 0xa02a2a, 0, 0.12, 0), box(0.5, 0.05, 0.38, 0x1a1a1a, 0, 0.2, 0), cone(0.22, 0.14, 0x1a1a1a, 0, 0.29, 0, 3));
      a.head.add(box(0.1, 0.08, 0.02, 0x0a0a0a, 0.07, 0.02, 0.16), box(0.3, 0.1, 0.06, 0x3a2414, 0, -0.12, 0.14));
      a.hand.add(tool('sword', 1));
    } else if (m.type === 'skeleton') {
      a = skeletonBody(0.88);
      a.armL.add(box(0.06, 0.38, 0.32, 0x6a5a3a, -0.08, -0.25, 0.05));
      a.hand.add(tool('sword', 2));
    } else if (m.type === 'cryptlord') {
      a = skeletonBody(1.45, 0x3a2a4a);
      a.body.add(box(0.52, 0.9, 0.34, 0x3a2a4a, 0, -0.4, 0));
      a.head.add(box(0.36, 0.08, 0.36, 0xe8c547, 0, 0.18, 0));
      for (let k = 0; k < 5; k++) a.head.add(cone(0.035, 0.12, 0xe8c547, -0.14 + k * 0.07, 0.27, 0.16, 4));
      for (const sx of [-1, 1]) a.head.add(mesh(geo('BoxGeometry', 0.07, 0.05, 0.03), glow(0x9a5aff), sx * 0.07, 0.03, 0.16, false));
      a.hand.add(tool('spear'));
    } else if (m.type === 'troll') {
      a = humanoid({ tunic: 0x5a4a32, skin: 0x7a8a7a, legs: 0x4a4030, sleeve: 0x7a8a7a, scale: 1.55 });
      a.body.scale.set(1.25, 1, 1.2);
      a.head.add(box(0.14, 0.12, 0.12, 0x6a7a6a, 0, -0.02, 0.18), box(0.34, 0.08, 0.06, 0x5a6a5a, 0, 0.12, 0.13));
      for (const sx of [-1, 1]) a.head.add(cone(0.04, 0.1, 0xf2ead0, sx * 0.09, -0.13, 0.15, 4));
      a.hand.add(tool('bigclub'));
    } else if (m.type === 'wurm') a = wurm();
    else if (m.type === 'banditking') {
      a = npcModel('king');
      a.g.children.slice(1).forEach(o => { if (!o.isSprite) a.g.remove(o); });
      a.inner.scale.setScalar(1.25);
      a.height = 1.75;
    }
    else if (m.type === 'goblin') {
      a = humanoid({ tunic: 0x6b4f2a, skin: 0x6fae4a, legs: 0x4a3a22, sleeve: 0x6fae4a, scale: 0.62 });
      const l = cone(0.07, 0.2, 0x6fae4a, -0.19, 0.04, 0, 4), r = cone(0.07, 0.2, 0x6fae4a, 0.19, 0.04, 0, 4);
      l.rotation.z = Math.PI / 2; r.rotation.z = -Math.PI / 2;
      a.head.add(l, r);
      a.hand.add(tool('dagger'));
    } else if (m.type === 'bandit') {
      a = humanoid({ tunic: 0x7a2222, skin: 0xd9a77a, legs: 0x2b2b2b, sleeve: 0x4a1a1a, scale: 0.85 });
      a.head.add(box(0.34, 0.2, 0.34, 0x4a1414, 0, 0.1, -0.02), box(0.31, 0.08, 0.02, 0x2a0a0a, 0, -0.06, 0.155));
      a.hand.add(tool('sword', 2));
    } else if (m.type === 'drake') {
      a = drake();
    } else {
      a = humanoid({ tunic: 0x5a4630, skin: 0x8b6fa3, legs: 0x4a3a2a, sleeve: 0x8b6fa3, scale: 1.35 });
      a.head.add(box(0.06, 0.08, 0.04, 0xf2ead0, -0.08, -0.12, 0.16), box(0.06, 0.08, 0.04, 0xf2ead0, 0.08, -0.12, 0.16));
      a.hand.add(tool('bigclub'));
    }
    a.vx = m.x; a.vz = m.y; a.rot = Math.random() * 6; a.lunge = 0;
    a.bar = hpBar();
    a.bar.g.position.y = a.height + 0.25;
    a.alert = makeLabel('!', { color: '#ff4a3a', size: 56, h: 0.45 });
    a.alert.position.y = a.height + 0.6;
    a.alert.visible = false;
    a.g.add(a.bar.g, a.alert);
    a.g.traverse(o => { o.userData.monsterId = m.id; });
    scene.add(a.g);
    pickables.push(a.g);
    return a;
  }

  function lerpAngle(a, b, t) {
    const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }

  function animateLimbs(a, moving, acting, dt, t, speed = 13) {
    a.walk = (a.walk || 0) + (moving ? dt * speed : 0);
    const sw = moving ? Math.sin(a.walk) * 0.7 : 0;
    a.inner.position.y = moving ? Math.abs(Math.sin(a.walk)) * 0.05 : 0;
    if (a.wings) a.wings.forEach(w => { w.pivot.rotation.z = w.s * (0.3 + Math.sin(t * 2.2) * 0.25); });
    if (a.kind === 'wolf') { a.legs.forEach((l, k) => { l.rotation.x = (k === 0 || k === 3 ? sw : -sw); }); return; }
    a.legL.rotation.x = sw; a.legR.rotation.x = -sw;
    a.armL.rotation.x = -sw * 0.6;
    a.armR.rotation.x = acting ? -1.3 + Math.sin(t * 9) * 0.9 : (a.lunge > 0 ? -1.5 * a.lunge : sw * 0.6);
  }

  // Monsters move tile to tile; glide them smoothly between tiles.
  function animateMonster(a, m, dt, t) {
    const dx = m.x - a.vx, dz = m.y - a.vz, dist = Math.hypot(dx, dz);
    if (dist > 3) { a.vx = m.x; a.vz = m.y; }
    else { const k = Math.min(1, dt * 9); a.vx += dx * k; a.vz += dz * k; }
    const moving = dist > 0.04;
    const pd = Math.hypot(state.px - a.vx, state.py - a.vz);
    let face = moving ? Math.atan2(dx, dz) : null;
    if (!moving && m.aggro && pd < 3) face = Math.atan2(state.px - a.vx, state.py - a.vz);
    if (face != null) a.rot = lerpAngle(a.rot, face, Math.min(1, dt * 12));
    a.g.rotation.y = a.rot;
    const l = a.lunge || 0;
    a.g.position.set(a.vx + Math.sin(a.rot) * l * 0.35, gh(a.vx, a.vz), a.vz + Math.cos(a.rot) * l * 0.35);
    if (a.lunge) a.lunge = Math.max(0, a.lunge - dt * 5);
    animateLimbs(a, moving, false, dt, t);
  }

  // ------------------------------------------------------------ building kit
  // Roof made of two sloped slabs over a gable wall, ridge running front to back (+z).
  function gableGeo(w, d, h) {
    const key = `gable${w},${d},${h}`;
    if (!geoCache.has(key)) {
      const sh = new C.Shape();
      sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.lineTo(-w / 2, 0);
      const g = new C.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false });
      g.translate(0, 0, -d / 2);
      geoCache.set(key, g);
    }
    return geoCache.get(key);
  }
  function roof(g, w, d, h, y, color, wallColor, opts = {}) {
    const over = opts.over == null ? 0.25 : opts.over, thick = opts.thick || 0.12;
    if (wallColor != null) g.add(mesh(gableGeo(w, d, h), mat(wallColor), 0, y, 0));
    const half = w / 2 + over, slant = Math.hypot(half, h + over * h / (w / 2)), ang = Math.atan2(h, w / 2);
    for (const sgn of [-1, 1]) {
      const slab = box(slant, thick, d + over * 2, color, sgn * half / 2 - sgn * over / 2 + sgn * 0.02, y + h / 2 + thick / 2 - 0.02, 0);
      slab.rotation.z = -sgn * ang;
      g.add(slab);
    }
    g.add(box(0.16, 0.16, d + over * 2 + 0.02, opts.ridge || color, 0, y + h + 0.04, 0));
  }
  function win(g, x, y, z, ry, o = {}) {
    const pane = mesh(geo('BoxGeometry', o.w || 0.42, o.h || 0.5, 0.05), windowMat, 0, 0, 0, false);
    const grp = new C.Group();
    grp.add(pane, box((o.w || 0.42) + 0.12, 0.07, 0.12, o.frame || 0x4a3220, 0, -(o.h || 0.5) / 2 - 0.03, 0.04));
    grp.add(box(0.05, o.h || 0.5, 0.06, o.frame || 0x4a3220, 0, 0, 0.02), box((o.w || 0.42), 0.05, 0.06, o.frame || 0x4a3220, 0, 0, 0.02));
    if (o.shutter != null) for (const sx of [-1, 1]) grp.add(box(0.2, (o.h || 0.5) + 0.04, 0.04, o.shutter, sx * ((o.w || 0.42) / 2 + 0.11), 0, 0.02));
    if (o.flowers) {
      grp.add(box((o.w || 0.42) + 0.1, 0.12, 0.16, 0x7a5232, 0, -(o.h || 0.5) / 2 - 0.1, 0.1));
      for (let k = 0; k < 3; k++) grp.add(mesh(geo('IcosahedronGeometry', 0.06, 0), mat([0xe04a6a, 0xf0d040, 0xffffff][k]), -0.12 + k * 0.12, -(o.h || 0.5) / 2 - 0.02, 0.12));
    }
    grp.position.set(x, y, z);
    grp.rotation.y = ry;
    g.add(grp);
  }
  function door(g, z, o = {}) {
    const w = o.w || 0.62, h = o.h || 1.1;
    g.add(box(w + 0.16, h + 0.1, 0.06, o.frame || 0x3a2614, 0, h / 2 + (o.y || 0.12), z + 0.01));
    g.add(box(w, h, 0.07, o.color || 0x6a4424, 0, h / 2 + (o.y || 0.12), z + 0.03));
    if (o.bands) for (const yy of [0.3, 0.8]) g.add(box(w + 0.02, 0.06, 0.09, 0x2a2a2e, 0, yy + (o.y || 0.12), z + 0.04));
    g.add(box(w + 0.4, 0.12, 0.4, o.step || 0x8a847a, 0, 0.06, z + 0.22));
  }
  // Timber frame: posts and rails standing proud of a wall face.
  function timbers(g, w, d, y0, h, color, braces) {
    const t = 0.09;
    for (const sz of [-1, 1]) {
      const z = sz * (d / 2 + 0.02);
      for (const x of [-w / 2 + t / 2, -w / 6, w / 6, w / 2 - t / 2]) g.add(box(t, h, t, color, x, y0 + h / 2, z));
      g.add(box(w, t, t, color, 0, y0 + h - t / 2, z), box(w, t, t, color, 0, y0 + t / 2, z));
      if (braces) for (const sx of [-1, 1]) { const b = box(t, h * 0.9, t * 0.8, color, sx * w / 3, y0 + h / 2, z); b.rotation.z = sx * 0.55; g.add(b); }
    }
    for (const sx of [-1, 1]) {
      const x = sx * (w / 2 + 0.02);
      g.add(box(t, h, t, color, x, y0 + h / 2, 0), box(t, t, d, color, x, y0 + h - t / 2, 0));
    }
  }
  const choose = (arr, r) => arr[Math.floor(r * arr.length) % arr.length];

  // ------------------------------------------------------------ town house styles (front faces +z)
  const HOUSES = {
    ironhold: (g, r) => {
      const w = 2.5, d = 2.3, wall = choose([0xe8dcc0, 0xf0e6cc, 0xd8c8a0, 0xe6d6b4, 0xcfc2a6], r), beam = 0x46301c;
      const roofC = choose([0x8a3a2a, 0x7a4a32, 0x5e4c46, 0x9a5a3a], r * 7), shut = choose([0x3a5a7a, 0x6a3a2a, 0x3a6a3a, 0x7a6a2a], r * 13);
      const tall = r > 0.35;
      g.add(box(w + 0.12, 0.3, d + 0.12, 0x7a746a, 0, 0.15, 0));
      g.add(box(w, 1.5, d, r > 0.7 ? 0x9a948a : wall, 0, 1.05, 0));
      timbers(g, w, d, 0.3, 1.5, beam, false);
      door(g, d / 2, { color: 0x5a3a20 });
      win(g, -0.8, 1.15, d / 2 + 0.03, 0, { shutter: shut });
      win(g, 0.8, 1.15, d / 2 + 0.03, 0, { shutter: shut });
      win(g, w / 2 + 0.03, 1.15, 0, Math.PI / 2, { shutter: shut });
      let top = 1.8, rw = w, rd = d;
      if (tall) {
        rw = w + 0.3; rd = d + 0.3;
        g.add(box(rw, 0.14, rd, beam, 0, top + 0.07, 0), box(rw, 1.35, rd, wall, 0, top + 0.14 + 0.675, 0));
        timbers(g, rw, rd, top + 0.14, 1.35, beam, true);
        for (const x of [-0.75, 0, 0.75]) win(g, x, top + 0.85, rd / 2 + 0.03, 0, { shutter: shut, flowers: r > 0.6 && x === 0 });
        win(g, -rw / 2 - 0.03, top + 0.85, 0, -Math.PI / 2, { shutter: shut });
        top += 1.49;
      }
      roof(g, rw, rd, 1.35, top, roofC, wall, { over: 0.3 });
      g.add(box(0.07, 1.2, 0.07, beam, 0, top + 0.55, rd / 2 + 0.02));
      g.add(box(0.42, 1.5, 0.42, 0x8a7a6a, w * 0.25, top + 0.9, -d * 0.18), box(0.5, 0.1, 0.5, 0x6a5a4a, w * 0.25, top + 1.68, -d * 0.18));
      if (r < 0.25) { g.add(cyl(0.025, 0.025, 0.7, 0x2a2a2a, 0.75, 1.9, d / 2 + 0.35, 4)); const sg = box(0.5, 0.35, 0.04, choose([0xb08850, 0x8a3a2a, 0x3a5a7a], r * 31), 0.75, 1.6, d / 2 + 0.6); sg.rotation.y = Math.PI / 2; g.add(sg); }
    },
    stonedeep: (g, r) => {
      const w = 2.7, d = 2.4, shades = [0x8a857c, 0x7e7970, 0x948f86], slate = choose([0x3a4250, 0x2e3440, 0x44404a], r);
      for (let k = 0; k < 5; k++) g.add(box(w + (k % 2 ? 0.05 : 0), 0.42, d + (k % 2 ? 0.05 : 0), shades[(k + Math.floor(r * 3)) % 3], 0, 0.21 + k * 0.42, 0));
      for (const [qx, qz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) for (let k = 0; k < 5; k++) {
        g.add(box(0.32 + (k % 2) * 0.12, 0.4, 0.32 + ((k + 1) % 2) * 0.12, 0xa8a398, qx * (w / 2 - 0.1), 0.21 + k * 0.42, qz * (d / 2 - 0.1)));
      }
      door(g, d / 2 + 0.02, { color: 0x4a3018, bands: true, w: 0.7, h: 1.15, step: 0x6a655e });
      g.add(box(1.0, 0.25, 0.3, 0xa8a398, 0, 1.42, d / 2 + 0.1));
      win(g, -0.85, 1.25, d / 2 + 0.04, 0, { w: 0.34, h: 0.4, frame: 0x5a554e });
      win(g, 0.85, 1.25, d / 2 + 0.04, 0, { w: 0.34, h: 0.4, frame: 0x5a554e });
      roof(g, w, d, 1.6, 2.1, slate, 0x8a857c, { over: 0.2, thick: 0.16, ridge: 0x2a2e36 });
      g.add(box(0.7, 4.0, 0.7, 0x7e7970, -w / 2 - 0.25, 2.0, -0.3), box(0.8, 0.15, 0.8, 0x6a655e, -w / 2 - 0.25, 4.05, -0.3));
    },
    saltmere: (g, r) => {
      const w = 2.5, d = 2.2, wall = choose([0xf4f1ea, 0xeef0f2, 0xd6e4ec, 0xf2ead8], r), blue = choose([0x2a5a9a, 0x2a7a9a, 0x3a4a8a], r * 5);
      g.add(box(w + 0.1, 0.25, d + 0.1, 0x9a948a, 0, 0.12, 0), box(w, 1.6, d, wall, 0, 1.05, 0));
      door(g, d / 2, { color: blue, frame: 0xf8f8f8 });
      win(g, -0.8, 1.2, d / 2 + 0.03, 0, { shutter: blue, frame: 0xf8f8f8, flowers: true });
      win(g, 0.8, 1.2, d / 2 + 0.03, 0, { shutter: blue, frame: 0xf8f8f8 });
      win(g, w / 2 + 0.03, 1.2, 0, Math.PI / 2, { shutter: blue, frame: 0xf8f8f8 });
      roof(g, w, d, 1.3, 1.85, 0xc8a860, wall, { over: 0.35, thick: 0.28, ridge: 0xa88a48 });
      g.add(box(w, 0.1, 0.9, 0x9a7444, 0, 0.3, d / 2 + 0.55));
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1]) g.add(box(0.1, 1.5, 0.1, 0x7a5232, x, 1.0, d / 2 + 0.95));
      const canopy = box(w + 0.2, 0.08, 1.0, blue, 0, 1.8, d / 2 + 0.5); canopy.rotation.x = 0.25; g.add(canopy);
      g.add(box(0.7, 0.25, 0.3, 0x7a5232, 0.7, 0.48, d / 2 + 0.75));
      if (r > 0.5) { g.add(cyl(0.18, 0.22, 0.35, 0x8a6a3a, -w / 2 - 0.3, 0.18, 0.4, 6), cyl(0.18, 0.22, 0.35, 0x8a6a3a, -w / 2 - 0.35, 0.18, -0.1, 6)); }
    },
    thornwood: (g, r) => {
      const w = 2.6, d = 2.4, log = choose([0x8a6038, 0x7a5430, 0x946a40], r), rad = 0.13;
      for (let k = 0; k < 7; k++) {
        const y = rad + k * rad * 2;
        for (const sz of [-1, 1]) { const l = cyl(rad, rad, w + 0.45, log, 0, y, sz * d / 2, 6); l.rotation.z = Math.PI / 2; g.add(l); }
        for (const sx of [-1, 1]) { const l = cyl(rad, rad, d + 0.45, log, sx * w / 2, y + rad, 0, 6); l.rotation.x = Math.PI / 2; g.add(l); }
      }
      g.add(box(w - 0.1, 1.8, d - 0.1, 0x5a3e24, 0, 0.9, 0));
      door(g, d / 2 + 0.08, { color: 0x5a3a20, h: 1.15 });
      win(g, 0.85, 1.15, d / 2 + 0.12, 0, { frame: 0x3a2614 });
      win(g, -0.85, 1.15, d / 2 + 0.12, 0, { frame: 0x3a2614 });
      roof(g, w + 0.3, d + 0.3, 1.25, 1.95, 0x4a3a2a, log, { over: 0.35, thick: 0.18 });
      for (let k = 0; k < 5; k++) g.add(mesh(geo('IcosahedronGeometry', 0.28, 0), mat(0x4a7a2a), (k % 2 ? -1 : 1) * (0.5 + (k % 3) * 0.2), 2.5 + (k % 2) * 0.2, -0.8 + k * 0.4));
      g.add(box(0.5, 3.6, 0.5, 0x7a746a, w / 2 + 0.2, 1.8, -0.5));
      for (const sx of [-1, 1]) { const ant = cyl(0.03, 0.04, 0.45, 0xe8dcc0, sx * 0.2, 1.65, d / 2 + 0.2, 4); ant.rotation.z = sx * 0.7; g.add(ant); }
      g.add(box(w + 0.4, 0.1, 0.9, 0x7a5432, 0, 0.12, d / 2 + 0.6));
      for (const x of [-w / 2, w / 2]) g.add(cyl(0.08, 0.08, 1.8, log, x, 0.9, d / 2 + 1.0, 6));
      const pr = box(w + 0.6, 0.1, 1.1, 0x4a3a2a, 0, 1.85, d / 2 + 0.6); pr.rotation.x = 0.22; g.add(pr);
    },
    ratsnest: (g, r) => {
      const w = 2.3, d = 2.1, browns = [0x5a4632, 0x4a3a2a, 0x6a523a, 0x3e3022];
      // A lean-to: tall front wall, low back wall, one sloping roof resting on both.
      const back = 1.55, front = 2.05, slope = Math.atan2(front - back, d);
      for (let k = 0; k < 6; k++) { const h = front + ((k * 37 + Math.floor(r * 10)) % 3) * 0.04; g.add(box(w / 6 + 0.02, h, 0.1, browns[k % 4], -w / 2 + w / 12 + k * w / 6, h / 2, d / 2)); }
      g.add(box(w, back, d - 0.1, 0x3e3022, 0, back / 2, -0.05));
      const sh = new C.Shape();
      sh.moveTo(-d / 2, 0); sh.lineTo(d / 2, 0); sh.lineTo(d / 2, front - back); sh.lineTo(-d / 2, 0);
      const wedge = new C.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
      wedge.translate(0, 0, -w / 2); wedge.rotateY(-Math.PI / 2);
      g.add(mesh(wedge, mat(0x3e3022), 0, back, 0));
      const dr = box(0.6, 1.05, 0.06, 0x2a2016, 0.3, 0.55, d / 2 + 0.07); dr.rotation.z = 0.05; g.add(dr);
      const len = Math.hypot(d, front - back) + 0.6;
      const rf = box(w + 0.5, 0.1, len, 0x4a4036, 0, (front + back) / 2 + 0.07, 0); rf.rotation.x = -slope; g.add(rf);
      const patch = box(0.9, 0.06, 0.8, choose([0x8a3a2a, 0x3a6a4a, 0x4a5a8a, 0x8a7a3a], r), -0.4, (front + back) / 2 + 0.07 + Math.tan(slope) * 0.3 + 0.07, 0.3);
      patch.rotation.x = -slope; g.add(patch);
      g.add(box(0.5, 0.45, 0.5, 0x7a5a3a, w / 2 + 0.4, 0.23, d / 2 - 0.2), cyl(0.24, 0.24, 0.55, 0x5a3a20, -w / 2 - 0.35, 0.28, d / 2 - 0.3, 7));
      g.add(cyl(0.02, 0.02, 0.3, 0x1a1a1a, -0.7, 1.55, d / 2 + 0.25, 4), mesh(geo('BoxGeometry', 0.14, 0.18, 0.14), windowMat, -0.7, 1.35, d / 2 + 0.25, false));
      const gl = glowSprite(0xffb050, 1.6); gl.position.set(-0.7, 1.35, d / 2 + 0.3); g.add(gl);
    },
    gloomwater: (g, r) => {
      // Stilt houses: a plank deck on posts above the bog, reached by a short stair.
      const w = 2.4, d = 2.2, up = 0.9, wood = choose([0x5a5040, 0x4e4636, 0x625844], r), post = 0x3a3022;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1]]) g.add(cyl(0.08, 0.1, up + 0.2, post, sx * (w / 2 - 0.05), (up + 0.2) / 2 - 0.1, sz * (d / 2 + 0.2), 5));
      g.add(box(w + 0.3, 0.12, d + 0.8, 0x6a5a40, 0, up, 0.2));
      g.add(box(w, 1.45, d, wood, 0, up + 0.78, 0));
      for (let k = 0; k < 5; k++) g.add(box(0.06, 1.45, 0.04, 0x3e3628, -w / 2 + 0.25 + k * (w - 0.5) / 4, up + 0.78, d / 2 + 0.02));
      g.add(box(0.6, 1.0, 0.06, 0x2e281e, 0.3, up + 0.56, d / 2 + 0.04));
      win(g, -0.6, up + 0.95, d / 2 + 0.05, 0, { w: 0.36, h: 0.36, frame: 0x3a3022 });
      win(g, w / 2 + 0.03, up + 0.95, 0, Math.PI / 2, { w: 0.36, h: 0.36, frame: 0x3a3022 });
      roof(g, w, d, 1.3, up + 1.5, choose([0x5a5a32, 0x4a4a2a, 0x625a36], r * 5), wood, { over: 0.4, thick: 0.26, ridge: 0x3a3a22 });
      for (let k = 0; k < 4; k++) g.add(box(0.5, 0.08, 0.32, 0x6a5a40, 0.3, up - 0.18 - k * 0.22, d / 2 + 0.75 + k * 0.28));
      for (const x of [-w / 2 - 0.1, w / 2 + 0.1]) g.add(box(0.05, 0.6, 0.05, post, x, up + 0.35, d / 2 + 0.55));
      g.add(box(w + 0.2, 0.05, 0.05, post, 0, up + 0.62, d / 2 + 0.58));
      g.add(cyl(0.02, 0.02, 0.4, 0x1a1a1a, -w / 2 - 0.05, up + 1.3, d / 2 + 0.5, 4), mesh(geo('BoxGeometry', 0.14, 0.18, 0.14), windowMat, -w / 2 - 0.05, up + 1.05, d / 2 + 0.5, false));
      const gl = glowSprite(0xc8ff8a, 1.6); gl.position.set(-w / 2 - 0.05, up + 1.05, d / 2 + 0.5); g.add(gl);
      if (r > 0.4) for (let k = 0; k < 3; k++) g.add(box(0.06, 0.3, 0.12, 0x8aa0a0, w / 2 + 0.25, up + 0.9 - k * 0.05, -0.5 + k * 0.4));
      if (r < 0.5) g.add(box(0.5, 0.15, 1.3, 0x5a4630, -w / 2 - 0.7, 0.05, 0.2));
    },
    amberreach: (g, r) => {
      // Flat-roofed adobe with jutting roof beams, some crowned with a little dome.
      const w = 2.6, d = 2.4, h = choose([1.9, 2.2, 2.6], r), clay = choose([0xd8b07a, 0xe0bc88, 0xccA070, 0xe8caa0], r * 3);
      const cloth = choose([0xb03a2a, 0x2a6a9a, 0xd08a2a, 0x7a3a8a], r * 11);
      g.add(box(w, h, d, clay, 0, h / 2, 0), box(w + 0.1, 0.2, d + 0.1, clay, 0, h + 0.1, 0));
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.25, 0.2, 0.25, clay, sx * (w / 2 - 0.08), h + 0.3, sz * (d / 2 - 0.08)));
      for (let k = 0; k < 4; k++) g.add(cyl(0.06, 0.06, 0.4, 0x6a4a2a, -w / 2 + 0.4 + k * (w - 0.8) / 3, h - 0.25, d / 2 + 0.15, 5).rotateX(Math.PI / 2));
      g.add(box(0.7, 1.15, 0.06, 0x3a2414, 0, 0.6, d / 2 + 0.02), cyl(0.35, 0.35, 0.06, 0x3a2414, 0, 1.18, d / 2 + 0.02, 10).rotateX(Math.PI / 2));
      win(g, -0.85, 1.25, d / 2 + 0.03, 0, { w: 0.3, h: 0.36, frame: 0x8a6a4a });
      win(g, 0.85, 1.25, d / 2 + 0.03, 0, { w: 0.3, h: 0.36, frame: 0x8a6a4a });
      win(g, w / 2 + 0.03, 1.3, 0, Math.PI / 2, { w: 0.3, h: 0.36, frame: 0x8a6a4a });
      const aw = box(1.4, 0.05, 0.8, cloth, 0, 1.5, d / 2 + 0.38); aw.rotation.x = 0.25; g.add(aw);
      for (const x of [-0.68, 0.68]) g.add(box(0.05, 1.5, 0.05, 0x6a4a2a, x, 0.75, d / 2 + 0.75));
      if (r > 0.6) { g.add(cyl(0.6, 0.65, 0.3, clay, 0.4, h + 0.35, -0.3, 10), mesh(geo('SphereGeometry', 0.6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(choose([0xe8e0d0, 0x3a7a9a, 0xd8a04a], r * 17)), 0.4, h + 0.5, -0.3)); }
      else { g.add(box(0.9, 0.06, 0.9, cloth, -0.5, h + 0.75, -0.4)); for (const [x, z] of [[-0.9, -0.8], [-0.1, -0.8], [-0.9, 0], [-0.1, 0]]) g.add(box(0.05, 0.6, 0.05, 0x6a4a2a, x, h + 0.45, z)); }
      for (const x of [-w / 2 - 0.25, w / 2 + 0.25]) if (rnd(x * 7 + r * 99, 3) > 0.4) g.add(cyl(0.16, 0.12, 0.35, 0xb0583a, x, 0.18, d / 2 - 0.2, 7));
    },
    frosthollow: (g, r) => {
      // Dark timber on a stone footing, steep snow-laden roof and a smoking chimney.
      const w = 2.5, d = 2.4, wood = choose([0x5a4030, 0x4e382a, 0x664a36], r), snow = 0xf2f8fc, stone = 0x8a8a8e;
      g.add(box(w + 0.15, 0.5, d + 0.15, stone, 0, 0.25, 0), box(w, 1.5, d, wood, 0, 1.25, 0));
      timbers(g, w, d, 0.5, 1.5, 0x3a2a1e, r > 0.5);
      door(g, d / 2, { color: 0x6a3a22, bands: true, step: stone, y: 0.5 });
      win(g, -0.8, 1.35, d / 2 + 0.03, 0, { shutter: choose([0x2a4a6a, 0x7a2a2a, 0x2a5a3a], r * 7) });
      win(g, 0.8, 1.35, d / 2 + 0.03, 0, { shutter: choose([0x2a4a6a, 0x7a2a2a, 0x2a5a3a], r * 7) });
      win(g, -w / 2 - 0.03, 1.35, 0, -Math.PI / 2, {});
      roof(g, w, d, 1.9, 2.0, snow, wood, { over: 0.4, thick: 0.2, ridge: 0xe0eaf0 });
      for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) g.add(cone(0.035, 0.22, 0xd8f0ff, sx * (w / 2 + 0.38), 1.88, -d / 2 - 0.2 + k * (d + 0.4) / 4, 4).rotateX(Math.PI));
      g.add(box(0.5, 2.4, 0.5, stone, w * 0.25, 3.0, -0.4), box(0.6, 0.12, 0.6, snow, w * 0.25, 4.25, -0.4));
      addSmoke(g, w * 0.25, 4.4, -0.4);
      g.add(box(0.9, 0.5, 0.5, 0x8a6338, -w / 2 - 0.5, 0.25, 0.5), box(0.92, 0.1, 0.52, snow, -w / 2 - 0.5, 0.55, 0.5));
    },
  };

  // ------------------------------------------------------------ landmarks
  const LANDMARK_MODELS = {
    keep: (g, w, d) => {
      const stone = 0x9a948a, dark = 0x7a746a;
      g.add(box(w - 1.2, 6.5, d - 1.2, stone, 0, 3.25, 0), box(w - 1.0, 0.3, d - 1.0, dark, 0, 1.0, 0), box(w - 1.0, 0.3, d - 1.0, dark, 0, 4.0, 0));
      for (let k = 0; k < 14; k++) {
        const side = k % 4, f = Math.floor(k / 4) / 3 - 0.33;
        const x = side < 2 ? (side ? 1 : -1) * (w - 1.2) / 2 : f * (w - 1.2), z = side >= 2 ? (side === 2 ? 1 : -1) * (d - 1.2) / 2 : f * (d - 1.2);
        g.add(box(0.45, 0.5, 0.45, stone, x, 6.75, z));
      }
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = sx * (w / 2 - 0.7), z = sz * (d / 2 - 0.7);
        g.add(cyl(0.75, 0.85, 8, stone, x, 4, z, 10), cyl(0.9, 0.9, 0.3, dark, x, 8.1, z, 10), cone(1.0, 1.8, 0x5a3a44, x, 9.15, z, 10));
        for (const y of [2.5, 5]) win(g, x + sx * 0.02, y, z + sz * 0.8, sz > 0 ? 0 : Math.PI, { w: 0.18, h: 0.5, frame: dark });
      }
      g.add(box(1.5, 2.2, 0.3, 0x2a2018, 0, 1.1, d / 2 - 0.55), box(1.9, 0.35, 0.4, dark, 0, 2.35, d / 2 - 0.5));
      for (let k = 0; k < 5; k++) g.add(box(0.06, 2.0, 0.06, 0x2a2a2e, -0.6 + k * 0.3, 1.1, d / 2 - 0.38));
      for (const x of [-1.6, 1.6]) g.add(box(0.7, 1.8, 0.05, 0xb0302a, x, 4.6, d / 2 - 0.58), box(0.72, 0.15, 0.06, 0xe8c547, x, 3.75, d / 2 - 0.57));
      for (const x of [-1.2, 0, 1.2]) win(g, x, 5.4, d / 2 - 0.58, 0, { w: 0.3, h: 0.6, frame: dark });
      g.add(cyl(0.05, 0.05, 2.5, 0x3a2a1a, 0, 8.2, 0, 5), box(0.05, 0.7, 1.1, 0xb0302a, 0, 9.0, 0.57));
      g.add(box(2.4, 0.15, 1.6, 0x8a847a, 0, 0.08, d / 2 + 0.4));
    },
    mine: (g, w, d) => {
      g.add(box(w, 2.8, d - 0.6, 0x6a655e, 0, 1.4, -0.4));
      g.add(box(2.2, 2.0, 0.3, 0x0e0c0a, 0, 1.0, d / 2 - 0.65));
      for (const x of [-1.25, 1.25]) g.add(box(0.3, 2.6, 0.3, 0x6b4a2b, x, 1.3, d / 2 - 0.5));
      g.add(box(3.0, 0.35, 0.4, 0x6b4a2b, 0, 2.6, d / 2 - 0.5), box(2.0, 0.4, 0.06, 0x3a2614, 0, 3.0, d / 2 - 0.3));
      for (let k = 0; k < 6; k++) g.add(box(1.6, 0.06, 0.12, 0x5a3a20, 0, 0.04, d / 2 - 0.5 + k * 0.35));
      for (const x of [-0.45, 0.45]) g.add(box(0.06, 0.06, 2.2, 0x55555c, x, 0.1, d / 2 + 0.3));
      g.add(box(0.8, 0.5, 1.0, 0x55555c, 0, 0.45, d / 2 + 0.6), cone(0.42, 0.35, 0xb07a4a, 0, 0.85, d / 2 + 0.6, 6));
      const frame = new C.Group();
      for (const sx of [-1, 1]) { const leg = box(0.15, 3.2, 0.15, 0x6b4a2b, sx * 0.7, 1.5, 0); leg.rotation.z = sx * 0.22; frame.add(leg); }
      const wheel = cyl(0.55, 0.55, 0.1, 0x4a3220, 0, 3.0, 0, 12); wheel.rotation.x = Math.PI / 2;
      frame.add(wheel);
      frame.position.set(w / 2 - 0.5, 0, d / 2 - 0.2);
      g.add(frame);
      for (const x of [-1.6, 1.6]) { g.add(box(0.08, 1.6, 0.08, 0x2a2a2a, x, 0.8, d / 2 - 0.3), mesh(geo('BoxGeometry', 0.18, 0.22, 0.18), windowMat, x, 1.65, d / 2 - 0.3, false)); const gl = glowSprite(0xffc870, 2); gl.position.set(x, 1.65, d / 2 - 0.3); g.add(gl); }
    },
    lighthouse: g => {
      for (let k = 0; k < 6; k++) g.add(cyl(1.0 - k * 0.08, 1.04 - k * 0.08, 1.2, k % 2 ? 0xc0302a : 0xf4f1ea, 0, 0.6 + k * 1.2, 0, 12));
      g.add(cyl(0.95, 0.95, 0.15, 0x3a3a40, 0, 7.3, 0, 12));
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; g.add(box(0.05, 0.5, 0.05, 0x2a2a2e, Math.cos(a) * 0.9, 7.6, Math.sin(a) * 0.9)); }
      g.add(mesh(geo('CylinderGeometry', 0.55, 0.55, 0.9, 10), windowMat, 0, 7.85, 0, false), cone(0.75, 0.9, 0xc0302a, 0, 8.75, 0, 10));
      const gl = glowSprite(0xfff0b0, 7); gl.position.y = 7.85; g.add(gl);
      g.add(box(1.4, 1.3, 1.2, 0xf4f1ea, 1.3, 0.65, 0.4));
      roof(g, 1.4, 1.2, 0.6, 1.3, 0x2a5a9a, 0xf4f1ea, { over: 0.15 });
      door(g, 1.0, { color: 0x2a5a9a, frame: 0xf8f8f8 });
    },
    lodge: (g, w, d) => {
      const log = 0x7a5430, rad = 0.15;
      for (let k = 0; k < 9; k++) {
        const y = rad + k * rad * 2;
        for (const sz of [-1, 1]) { const l = cyl(rad, rad, w + 0.4, log, 0, y, sz * (d / 2 - 0.3), 6); l.rotation.z = Math.PI / 2; g.add(l); }
        for (const sx of [-1, 1]) { const l = cyl(rad, rad, d - 0.2, log, sx * (w / 2 - 0.3), y + rad, 0, 6); l.rotation.x = Math.PI / 2; g.add(l); }
      }
      g.add(box(w - 0.7, 2.6, d - 0.7, 0x5a3e24, 0, 1.3, 0));
      const rg = new C.Group(); roof(rg, d - 0.4, w - 0.4, 2.0, 0, 0x3e3020, log, { over: 0.45, thick: 0.22 }); rg.rotation.y = Math.PI / 2; rg.position.y = 2.7; g.add(rg);
      g.add(box(1.4, 1.6, 0.1, 0x4a3018, 0, 0.92, d / 2 - 0.22), box(0.08, 1.6, 0.12, 0x2a1a0a, 0, 0.92, d / 2 - 0.18));
      for (const x of [-2.6, -1.4, 1.4, 2.6]) win(g, x, 1.4, d / 2 - 0.2, 0, { frame: 0x3a2614 });
      for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) { const a = cyl(0.03, 0.04, 0.5, 0xe8dcc0, sx * (0.25 + k * 0.12), 2.8 + k * 0.1, d / 2 - 0.15, 4); a.rotation.z = sx * (0.6 + k * 0.3); g.add(a); }
      for (const x of [-w / 2 + 1.2, w / 2 - 1.2]) g.add(box(0.6, 4.6, 0.6, 0x7a746a, x, 2.3, -d / 2 + 0.6));
      g.add(box(w, 0.12, 1.0, 0x6a4a2a, 0, 0.1, d / 2 + 0.25));
    },
    den: (g, w, d) => {
      g.add(box(w - 0.4, 2.4, d - 0.4, 0x3e3022, 0, 1.2, 0));
      for (let k = 0; k < 10; k++) g.add(box((w - 0.4) / 10 + 0.02, 2.3 + (k % 3) * 0.12, 0.1, [0x4a3a2a, 0x3a2e20, 0x5a4632][k % 3], -w / 2 + 0.2 + (k + 0.5) * (w - 0.4) / 10, 1.2, d / 2 - 0.15));
      const rf = new C.Group(); roof(rf, d - 0.2, w - 0.2, 1.1, 0, 0x2e2822, 0x3e3022, { over: 0.3 }); rf.rotation.y = Math.PI / 2; rf.position.y = 2.4; g.add(rf);
      g.add(box(1.2, 1.5, 0.1, 0x1a1410, 0, 0.75, d / 2 - 0.08));
      const aw = box(w - 0.6, 0.08, 1.2, 0x5a2a2a, 0, 2.0, d / 2 + 0.35); aw.rotation.x = 0.3; g.add(aw);
      for (const x of [-w / 2 + 0.5, -0.9, 0.9, w / 2 - 0.5]) { g.add(mesh(geo('BoxGeometry', 0.16, 0.2, 0.16), windowMat, x, 1.75, d / 2 + 0.1, false)); const gl = glowSprite(0xff9a50, 1.8); gl.position.set(x, 1.75, d / 2 + 0.15); g.add(gl); }
      for (let k = 0; k < 4; k++) g.add(cyl(0.25, 0.25, 0.6, 0x5a3a20, w / 2 + 0.1, 0.3, -1 + k * 0.6, 7));
      g.add(box(0.05, 2.6, 0.05, 0x2a2a2a, -w / 2 - 0.3, 1.3, d / 2), box(0.05, 0.8, 0.5, 0x1a1a1a, -w / 2 - 0.3, 2.3, d / 2 + 0.26));
    },
  };

  Object.assign(LANDMARK_MODELS, {
    stilthall: (g, w, d) => {
      const up = 1.0, wood = 0x524a3a, post = 0x3a3022;
      for (let k = 0; k <= 6; k++) for (const sz of [-1, 1]) g.add(cyl(0.12, 0.14, up + 0.3, post, -w / 2 + 0.5 + k * (w - 1) / 6, (up + 0.3) / 2 - 0.15, sz * (d / 2 - 0.2), 6));
      g.add(box(w, 0.16, d + 0.6, 0x6a5a40, 0, up, 0.3), box(w - 1.0, 2.3, d - 0.8, wood, 0, up + 1.23, 0));
      for (let k = 0; k < 9; k++) g.add(box(0.08, 2.3, 0.05, 0x3e3628, -w / 2 + 0.6 + k * (w - 1.2) / 8, up + 1.23, d / 2 - 0.38));
      const rg = new C.Group(); roof(rg, d - 0.6, w - 0.8, 1.9, 0, 0x4a4a2a, wood, { over: 0.5, thick: 0.3, ridge: 0x32321e }); rg.rotation.y = Math.PI / 2; rg.position.y = up + 2.35; g.add(rg);
      g.add(box(1.2, 1.6, 0.08, 0x2a241a, 0, up + 0.9, d / 2 - 0.36));
      for (const x of [-2.4, -1.3, 1.3, 2.4]) win(g, x, up + 1.4, d / 2 - 0.35, 0, { frame: post });
      for (let k = 0; k < 4; k++) g.add(box(1.2, 0.1, 0.3, 0x6a5a40, 0, up - 0.2 - k * 0.25, d / 2 + 0.75 + k * 0.3));
      for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) { g.add(cyl(0.05, 0.06, 2.6, post, x, up + 1.3, d / 2 + 0.45, 5), box(0.2, 0.25, 0.2, 0x2a2a2a, x, up + 2.7, d / 2 + 0.45)); const gl = glowSprite(0xc8ff8a, 2.4); gl.position.set(x, up + 2.7, d / 2 + 0.45); g.add(gl); }
      for (let k = 0; k < 6; k++) g.add(box(0.6, 0.08, 0.1, 0x8aa0a0, -2 + k * 0.8, up + 2.1, d / 2 - 0.3));
    },
    sunspire: (g, w, d) => {
      const clay = 0xe0bc88, trim = 0xc89858, blue = 0x2a6a9a;
      g.add(box(w - 0.6, 3.2, d - 0.6, clay, 0, 1.6, 0), box(w - 0.4, 0.25, d - 0.4, trim, 0, 3.3, 0));
      for (let k = 0; k < 3; k++) g.add(box(2.0 - k * 0.45, 2.0, 2.0 - k * 0.45, k % 2 ? trim : clay, 0, 4.4 + k * 2.0, 0));
      g.add(cyl(0.55, 0.55, 0.4, clay, 0, 10.6, 0, 10), mesh(geo('SphereGeometry', 0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat(blue), 0, 10.8, 0), cone(0.1, 0.9, 0xe8c547, 0, 11.9, 0, 6));
      for (let k = 0; k < 3; k++) for (const s of [-1, 1]) win(g, s * 0.3, 4.6 + k * 2.0, (2.0 - k * 0.45) / 2 + 0.03, 0, { w: 0.18, h: 0.5, frame: trim });
      g.add(box(1.4, 2.0, 0.08, 0x3a2414, 0, 1.0, d / 2 - 0.27), cyl(0.7, 0.7, 0.08, 0x3a2414, 0, 2.0, d / 2 - 0.27, 12).rotateX(Math.PI / 2));
      for (const x of [-1.5, 1.5]) { g.add(box(0.06, 1.8, 0.06, 0x6a4a2a, x, 0.9, d / 2 + 0.6)); const aw = box(1.4, 0.05, 1.0, x < 0 ? 0xb03a2a : 0xd08a2a, x, 1.8, d / 2 + 0.2); aw.rotation.x = 0.2; g.add(aw); }
      for (let k = 0; k < 6; k++) g.add(cyl(0.06, 0.06, 0.45, 0x6a4a2a, -1.8 + k * 0.72, 3.0, d / 2 - 0.1, 5).rotateX(Math.PI / 2));
      const gl = glowSprite(0xffd890, 4); gl.position.y = 10.9; g.add(gl);
    },
    hearthhall: (g, w, d) => {
      const wood = 0x4e382a, stone = 0x8a8a8e, snow = 0xf2f8fc;
      g.add(box(w - 0.5, 0.7, d - 0.5, stone, 0, 0.35, 0), box(w - 0.8, 2.5, d - 0.8, wood, 0, 1.95, 0));
      timbers(g, w - 0.8, d - 0.8, 0.7, 2.5, 0x2e2018, true);
      const rg = new C.Group(); roof(rg, d - 0.6, w - 0.6, 2.6, 0, snow, wood, { over: 0.55, thick: 0.25, ridge: 0xe0eaf0 }); rg.rotation.y = Math.PI / 2; rg.position.y = 3.2; g.add(rg);
      for (const sx of [-1, 1]) { const horn = cone(0.12, 1.1, 0x4e382a, sx * (w / 2 - 0.5), 6.1, d / 2 - 0.2, 5); horn.rotation.z = -sx * 0.5; g.add(horn); }
      g.add(box(1.6, 1.9, 0.1, 0x5a3220, 0, 1.65, d / 2 - 0.35));
      for (const yy of [1.1, 1.9]) g.add(box(1.62, 0.08, 0.12, 0x2a2a2e, 0, yy, d / 2 - 0.33));
      for (const x of [-2.5, -1.5, 1.5, 2.5]) win(g, x, 2.1, d / 2 - 0.38, 0, { shutter: 0x2a4a6a });
      for (const x of [-w / 2 + 1.0, w / 2 - 1.0]) { g.add(box(0.7, 5.6, 0.7, stone, x, 2.8, -d / 2 + 0.8), box(0.8, 0.15, 0.8, snow, x, 5.65, -d / 2 + 0.8)); addSmoke(g, x, 5.8, -d / 2 + 0.8); }
      for (const x of [-1.4, 1.4]) { g.add(box(0.1, 1.6, 0.1, 0x2a2a2a, x, 0.8, d / 2 + 0.4)); flame(g, x, 1.75, d / 2 + 0.4, 0.8); const gl = glowSprite(0xff9a3a, 2.2); gl.position.set(x, 1.8, d / 2 + 0.4); g.add(gl); }
      g.add(box(2.4, 0.15, 1.0, stone, 0, 0.08, d / 2 + 0.3));
    },
  });

  // Merge a static group into one mesh per material: hundreds of parts, a handful of draw calls.
  function bake(src) {
    src.updateMatrixWorld(true);
    const byMat = new Map(), keep = [];
    src.traverse(o => {
      if (o === src) return;
      if (o.isMesh && !o.isInstancedMesh && !o.userData.noBake && !o.material.transparent) {
        const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
        if (!byMat.has(o.material)) byMat.set(o.material, []);
        byMat.get(o.material).push(g.attributes.position.array);
        g.dispose();
      } else if (o.isSprite || o.isMesh) keep.push(o);
    });
    const out = new C.Group();
    for (const [m, arrs] of byMat) {
      let n = 0;
      for (const a of arrs) n += a.length;
      const pos = new Float32Array(n);
      let off = 0;
      for (const a of arrs) { pos.set(a, off); off += a.length; }
      const g = new C.BufferGeometry();
      g.setAttribute('position', new C.BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const ms = new C.Mesh(g, m);
      ms.castShadow = ms.receiveShadow = true;
      out.add(ms);
    }
    for (const o of keep) out.attach(o);
    // Smoke drifts from its own position, which is now in world space.
    for (const sm of smoke) if (keep.includes(sm.p)) { sm.x = sm.p.position.x; sm.y = sm.p.position.y; sm.z = sm.p.position.z; }
    return out;
  }

  // Stonedeep's terrace retaining walls and the stairway up the middle.
  function buildTerraces(group) {
    const d = TOWN_DEFS.stonedeep;
    for (let y = d.y - d.hh; y <= d.y + d.hh; y++) for (let x = d.x - d.hw; x <= d.x + d.hw; x++) {
      if (terrain[idx(x, y)] !== T.WALL) continue;
      const k = y * (W + 1) + x;
      const lo = Math.min(cornerH[k], cornerH[k + 1], cornerH[k + W + 1], cornerH[k + W + 2]);
      const hi = Math.max(cornerH[k], cornerH[k + 1], cornerH[k + W + 1], cornerH[k + W + 2]);
      const h = hi - lo + 0.45;
      group.add(box(1.02, h, 1.02, (x + y) % 3 ? 0x8a857c : 0x7e7970, x, lo + h / 2 - 0.05, y));
      if ((x + y) % 2) group.add(box(0.5, 0.2, 1.04, 0x6a655e, x, hi + 0.5, y));
    }
    const rowD = (2 * d.hh + 1) / d.terraces.length;
    for (let yy = d.y - d.hh; yy <= d.y + d.hh; yy += 0.33) {
      const h0 = groundHeight(d.x, yy), h1 = groundHeight(d.x, yy + 0.33);
      if (Math.abs(h1 - h0) < 0.05) continue;
      group.add(box(3.1, 0.18, 0.36, 0x9a958c, d.x, Math.max(h0, h1) + 0.02, yy + 0.16));
    }
    void rowD;
  }

  function townsfolk(color) {
    const a = humanoid({ tunic: color, skin: 0xe0b08a, legs: 0x4a3a2a, scale: 0.8 });
    a.idle = true;
    return a;
  }

  // The people of the story, each with a '!' or '?' over their head when they have something to say.
  function npcModel(npc) {
    let a;
    if (npc === 'herald') {
      a = humanoid({ tunic: 0xb0302a, skin: 0xe0b08a, legs: 0xe8c547, sleeve: 0xe8c547, scale: 0.85 });
      a.head.add(box(0.36, 0.08, 0.36, 0x2a2a2a, 0, 0.17, 0), box(0.22, 0.14, 0.22, 0x2a2a2a, 0, 0.27, 0), box(0.04, 0.2, 0.04, 0xf2f2f2, 0.1, 0.38, 0));
      a.body.add(box(0.44, 0.06, 0.28, 0xe8c547, 0, 0.1, 0));
      const sc = cyl(0.04, 0.04, 0.32, 0xf2ead8, 0, 0, 0.1, 6); sc.rotation.z = Math.PI / 2; a.hand.add(sc);
      a.armR.rotation.x = -0.9;
    } else if (npc === 'elder') {
      a = humanoid({ tunic: 0x8a8a92, skin: 0xe8c8a8, legs: 0x8a8a92, sleeve: 0x7a7a82, scale: 0.8 });
      a.body.add(box(0.5, 0.75, 0.32, 0x8a8a92, 0, -0.35, 0), box(0.6, 0.2, 0.4, 0xd8d0c0, 0, 0.22, 0));
      a.head.add(box(0.34, 0.12, 0.34, 0xf2f2f2, 0, 0.15, -0.02), box(0.2, 0.18, 0.06, 0xf2f2f2, 0, -0.16, 0.14));
      a.hand.add(cyl(0.03, 0.035, 1.5, 0x6b4a2b, 0, 0.3, 0, 5), mesh(geo('OctahedronGeometry', 0.08, 0), glow(0x9adfff), 0, 1.08, 0, false));
    } else {
      a = humanoid({ tunic: 0x3a1a1a, skin: 0xd9a77a, legs: 0x2b2b2b, sleeve: 0x5a1a1a, scale: 1.0 });
      a.body.add(box(0.5, 0.75, 0.06, 0x8a1a1a, 0, -0.15, -0.17));
      a.head.add(box(0.34, 0.07, 0.34, 0xe8c547, 0, 0.17, 0));
      for (let k = 0; k < 4; k++) a.head.add(cone(0.035, 0.12, 0xe8c547, -0.12 + k * 0.08, 0.26, 0.16, 4));
      a.head.add(box(0.3, 0.1, 0.06, 0x2a1a0a, 0, -0.12, 0.14));
      a.hand.add(tool('sword', 3));
      a.g.add(box(0.9, 0.5, 0.7, 0x7a5a3a, 0, 0.25, -0.6), box(0.9, 0.9, 0.15, 0x6a4a2a, 0, 0.7, -0.95));
    }
    a.idle = true;
    return a;
  }

  function buildTowns() {
    // Every town's houses and landmark are baked together into a few meshes.
    for (const id in TOWN_DEFS) {
      const tg = new C.Group();
      for (const h of townHouses.filter(h => h.town === id)) {
        const g = new C.Group();
        HOUSES[id](g, h.seed);
        g.position.set(h.x + 1, tileH[idx(h.x + 1, h.y + 1)], h.y + 1);
        g.rotation.y = h.rot;
        tg.add(g);
      }
      for (const lm of townLandmarks.filter(l => l.town === id)) {
        const g = new C.Group();
        LANDMARK_MODELS[lm.kind](g, lm.w, lm.h);
        const cx = lm.x + (lm.w - 1) / 2, cy = lm.y + (lm.h - 1) / 2;
        g.position.set(cx, tileH[idx(Math.round(cx), Math.round(cy))], cy);
        tg.add(g);
      }
      if (id === 'stonedeep') buildTerraces(tg);
      scene.add(bake(tg));
    }
    for (const [i, svc] of services) {
      if (svc.type === 'board') {
        const x = i % W, y = (i - x) / W, g = new C.Group();
        PROP_MODELS.board(g);
        g.position.set(x, tileH[i], y);
        g.rotation.y = Math.atan2(TOWN_DEFS[svc.town].pc.x - x, TOWN_DEFS[svc.town].pc.y - y);
        const name = makeLabel('Notice Board', { color: '#ffe9a8', h: 0.28 });
        name.position.y = 2.3;
        const marks = { '!': makeLabel('!', { color: '#ffd84a', size: 64, h: 0.6 }), '?': makeLabel('?', { color: '#c8c8c8', size: 64, h: 0.6 }) };
        for (const m of Object.values(marks)) { m.position.y = 2.8; m.visible = false; g.add(m); }
        g.add(name);
        g.traverse(o => { o.userData.tile = i; });
        scene.add(g); pickables.push(g);
        boardObjs.push({ town: svc.town, marks });
        continue;
      }
      if (svc.type === 'npc') {
        const x = i % W, y = (i - x) / W, a = npcModel(svc.npc);
        a.g.position.set(x, tileH[i], y);
        a.g.rotation.y = Math.atan2(TOWN_DEFS[svc.town].pc.x - x, TOWN_DEFS[svc.town].pc.y - y);
        const name = makeLabel(cap(NPC_NAMES[svc.npc].replace(/^the /, '')), { color: '#ffe9a8', h: 0.28 });
        name.position.y = a.height * 0.9 + 0.75;
        const marks = { '!': makeLabel('!', { color: '#ffd84a', size: 64, h: 0.6 }), '?': makeLabel('?', { color: '#c8c8c8', size: 64, h: 0.6 }) };
        for (const m of Object.values(marks)) { m.position.y = a.height * 0.9 + 1.25; m.visible = false; a.g.add(m); }
        a.g.add(name);
        a.g.traverse(o => { o.userData.tile = i; });
        scene.add(a.g);
        pickables.push(a.g);
        npcObjs.push({ a, npc: svc.npc, marks });
        continue;
      }
      if (svc.type !== 'market' && svc.type !== 'carriage') continue;
      const x = i % W, y = (i - x) / W, h = tileH[i];
      const g = new C.Group();
      if (svc.type === 'market') {
        for (const [px, pz] of [[-0.45, -0.4], [0.45, -0.4], [-0.45, 0.4], [0.45, 0.4]]) g.add(cyl(0.04, 0.04, 1.2, 0x6b4a2b, px, 0.6, pz, 5));
        g.add(box(1.0, 0.4, 0.5, 0x7a5232, 0, 0.2, 0.15));
        for (let k = 0; k < 4; k++) g.add(box(0.27, 0.06, 1.0, k % 2 ? 0xf2ead8 : 0xc0392b, -0.4 + k * 0.27, 1.22, 0));
        g.add(cyl(0.12, 0.14, 0.08, 0xe8c547, 0.2, 0.44, 0.2, 8), box(0.24, 0.2, 0.24, 0x9a7444, -0.25, 0.5, 0.15));
        const merchant = townsfolk(0x8a5aa0);
        merchant.g.position.set(0, 0, -0.55);
        g.add(merchant.g);
        actors.push(merchant);
      } else {
        g.add(box(0.7, 0.35, 1.0, 0x7a5232, 0, 0.5, 0));
        for (const [wx, wz] of [[-0.4, -0.3], [0.4, -0.3], [-0.4, 0.3], [0.4, 0.3]]) {
          const wh = cyl(0.22, 0.22, 0.06, 0x4a3220, wx, 0.22, wz, 10);
          wh.rotation.z = Math.PI / 2;
          g.add(wh);
        }
        g.add(box(0.6, 0.06, 0.06, 0x6b4a2b, 0, 0.45, 0.75));
        const horse = new C.Group();
        horse.add(box(0.3, 0.32, 0.7, 0x7a4a2a, 0, 0.62, 0), box(0.18, 0.32, 0.18, 0x7a4a2a, 0, 0.9, 0.38), box(0.16, 0.14, 0.26, 0x6a3a1a, 0, 0.98, 0.52));
        for (const [lx, lz] of [[-0.1, 0.25], [0.1, 0.25], [-0.1, -0.25], [0.1, -0.25]]) horse.add(box(0.08, 0.46, 0.08, 0x5a3a1a, lx, 0.23, lz));
        horse.position.z = 1.2;
        g.add(horse);
      }
      g.position.set(x, h, y);
      const label = makeLabel(svc.type === 'market' ? 'Market' : 'Carriage', { color: '#ffe9a8', h: 0.32 });
      label.position.y = 1.9;
      g.add(label);
      g.traverse(o => { o.userData.tile = i; });
      scene.add(g);
      pickables.push(g);
    }
    for (const id in TOWN_DEFS) {
      const d = TOWN_DEFS[id];
      const label = makeLabel(TOWNS[id].name, { color: '#fff4c8', size: 56, h: 0.9 });
      label.position.set(d.x, d.h + 5, d.y - d.hh + 1);
      scene.add(label);
    }
    buildTownLife();
    buildPois();
    buildDungeons();
    buildSecrets();
    buildSigns();
  }


  // ------------------------------------------------------------ town life: props, people, animals
  const TOWN_COLORS = { ironhold: 0xb0302a, stonedeep: 0x4a5a8a, saltmere: 0x2a7aa0, thornwood: 0x3a7a2a, ratsnest: 0x2a2a2a,
    gloomwater: 0x4a6a3a, amberreach: 0xd08a2a, frosthollow: 0x5a8ab8 };
  const PROP_MODELS = {
    palm: g => {
      const lean = 0.25 + Math.random() * 0.2, segs = 6;
      let x = 0, y = 0;
      for (let k = 0; k < segs; k++) {
        const sg = cyl(0.13 - k * 0.012, 0.15 - k * 0.012, 0.55, k % 2 ? 0x8a6a42 : 0x9a7a4e, x, y + 0.27, 0, 6);
        sg.rotation.z = -lean * (k / segs);
        g.add(sg);
        x += Math.sin(lean * k / segs) * 0.55; y += 0.53;
      }
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2, fr = new C.Group();
        fr.position.set(x, y, 0); fr.rotation.y = a;
        const leaf = box(0.32, 0.04, 1.3, k % 2 ? 0x3a8a3a : 0x4a9a3a, 0, 0, 0.6); leaf.rotation.x = 0.45;
        fr.add(leaf); g.add(fr);
      }
      for (let k = 0; k < 3; k++) g.add(mesh(geo('IcosahedronGeometry', 0.09, 0), mat(0x6a4a22), x + Math.cos(k * 2) * 0.14, y - 0.1, Math.sin(k * 2) * 0.14));
    },
    stall: (g, town, p) => {
      const goods = (p && p.goods) || 'produce';
      const awn = { produce: 0x3a8a3a, bread: 0xc8a050, cloth: 0x7a3a9a, pottery: 0xb0583a, meat: 0xa02a2a, tools: 0x3a5a7a, flowers: 0xd05a8a,
        fish: 0x2a6aa0, ore: 0x4a4a52, furs: 0x6a4a2a, shady: 0x2a1a1a, weapons: 0x5a5a62 }[goods];
      for (const [x, z] of [[-0.5, -0.38], [0.5, -0.38], [-0.5, 0.32], [0.5, 0.32]]) g.add(cyl(0.035, 0.035, 1.55, 0x6b4a2b, x, 0.78, z, 5));
      g.add(box(1.1, 0.55, 0.5, 0x7a5232, 0, 0.28, 0.12), box(1.14, 0.06, 0.56, 0x8a6338, 0, 0.58, 0.12));
      g.add(box(1.0, 0.06, 0.25, 0x8a6338, 0, 0.95, -0.3), box(1.0, 0.06, 0.25, 0x8a6338, 0, 1.25, -0.3));
      for (let k = 0; k < 4; k++) { const a = box(0.28, 0.05, 1.05, k % 2 ? 0xf2ead8 : awn, -0.42 + k * 0.28, 1.62, 0.05); a.rotation.x = 0.22; g.add(a); }
      for (let k = 0; k < 4; k++) g.add(box(0.28, 0.14, 0.03, k % 2 ? 0xf2ead8 : awn, -0.42 + k * 0.28, 1.48, 0.58));
      const top = 0.62, add = (o) => g.add(o);
      const R = k => (Math.sin(k * 91.7 + goods.length * 13) + 1) / 2;
      if (goods === 'produce') for (let k = 0; k < 9; k++) add(mesh(geo('IcosahedronGeometry', 0.07, 0), mat([0xd03a2a, 0x6aa83a, 0xf0a030][k % 3]), -0.4 + (k % 5) * 0.2, top + 0.06, 0.02 + Math.floor(k / 5) * 0.16));
      if (goods === 'bread') for (let k = 0; k < 6; k++) { const l = cyl(0.06, 0.07, 0.24, 0xc08a48, -0.38 + (k % 3) * 0.38, top + 0.07, 0.03 + Math.floor(k / 3) * 0.17, 6); l.rotation.z = Math.PI / 2; add(l); }
      if (goods === 'cloth') for (let k = 0; k < 5; k++) { const c = cyl(0.07, 0.07, 0.4, [0x7a3a9a, 0x2a6aa0, 0xc8a050, 0xa02a2a, 0x3a8a3a][k], -0.4 + k * 0.2, top + 0.08, 0.12, 8); c.rotation.x = Math.PI / 2; add(c); }
      if (goods === 'pottery') for (let k = 0; k < 6; k++) add(cyl(0.05, 0.08, 0.18 + R(k) * 0.12, 0xb0583a, -0.4 + k * 0.16, top + 0.1, 0.1, 7));
      if (goods === 'meat') { for (let k = 0; k < 4; k++) add(cone(0.08, 0.25, 0x9a3a2a, -0.36 + k * 0.24, 1.35, 0.28, 6)); add(box(0.6, 0.06, 0.3, 0xc04a3a, 0, top + 0.03, 0.12)); }
      if (goods === 'tools' || goods === 'weapons') for (let k = 0; k < 5; k++) { const t = box(0.04, 0.42, 0.04, goods === 'weapons' ? 0xc8ccd2 : 0x6b4a2b, -0.4 + k * 0.2, top + 0.2, 0.25); t.rotation.z = 0.25; add(t); add(box(0.14, 0.08, 0.05, 0x9aa0a8, -0.4 + k * 0.2 + 0.05, top + 0.38, 0.25)); }
      if (goods === 'flowers') for (let k = 0; k < 4; k++) { add(cyl(0.09, 0.08, 0.16, 0x5a5a62, -0.36 + k * 0.24, top + 0.08, 0.12, 7)); for (let j = 0; j < 3; j++) add(mesh(geo('IcosahedronGeometry', 0.05, 0), mat([0xe04a6a, 0xf0d040, 0xffffff, 0xa060e0][(k + j) % 4]), -0.36 + k * 0.24 + (j - 1) * 0.05, top + 0.22, 0.12)); }
      if (goods === 'fish') { add(box(0.95, 0.06, 0.4, 0xe8f0f4, 0, top + 0.03, 0.12)); for (let k = 0; k < 6; k++) add(box(0.22, 0.05, 0.08, 0x8ab0c0, -0.36 + (k % 3) * 0.36, top + 0.08, 0.04 + Math.floor(k / 3) * 0.16)); }
      if (goods === 'ore') for (let k = 0; k < 6; k++) add(k % 2 ? box(0.18, 0.07, 0.09, [0xc77a3a, 0xa5a5a8][k % 4 > 1 ? 1 : 0], -0.4 + k * 0.16, top + 0.05, 0.12) : mesh(geo('DodecahedronGeometry', 0.08, 0), mat(0x6e6862), -0.4 + k * 0.16, top + 0.07, 0.12));
      if (goods === 'furs') for (let k = 0; k < 3; k++) { const f = box(0.3, 0.04, 0.45, [0x8f8f96, 0x6a4a2a, 0xd8d0c0][k], -0.33 + k * 0.33, top + 0.03, 0.12); f.rotation.y = R(k) - 0.5; add(f); }
      if (goods === 'shady') for (let k = 0; k < 7; k++) add(cyl(0.035, 0.045, 0.2, [0x2a5a2a, 0x5a2a2a, 0x2a2a5a][k % 3], -0.42 + k * 0.14, top + 0.1, 0.12, 6));
      g.add(box(0.6, 0.22, 0.04, 0xb08850, 0, 1.85, 0.58));
    },
    fountain: g => {
      g.add(cyl(0.85, 0.9, 0.4, 0x9a958c, 0, 0.2, 0, 8), mesh(geo('CylinderGeometry', 0.75, 0.75, 0.05, 8), mat(0x4a8ac0), 0, 0.36, 0));
      g.add(cyl(0.12, 0.16, 1.1, 0x9a958c, 0, 0.75, 0, 6), cyl(0.38, 0.12, 0.15, 0x9a958c, 0, 1.3, 0, 8), mesh(geo('CylinderGeometry', 0.32, 0.32, 0.04, 8), mat(0x4a8ac0), 0, 1.37, 0));
      g.add(cone(0.08, 0.3, 0xb0aaa0, 0, 1.55, 0, 6));
    },
    forge: g => {
      g.add(box(0.8, 0.7, 0.6, 0x6a645e, -0.2, 0.35, -0.2), mesh(geo('BoxGeometry', 0.5, 0.06, 0.4), glow(0xff6a1a), -0.2, 0.72, -0.2, false));
      g.add(box(0.3, 1.4, 0.3, 0x5a554e, -0.4, 1.4, -0.35));
      g.add(cyl(0.18, 0.2, 0.3, 0x6b4a2b, 0.4, 0.15, 0.25, 7), box(0.35, 0.1, 0.15, 0x45454c, 0.4, 0.35, 0.25));
      g.add(cyl(0.18, 0.18, 0.4, 0x5a3a20, 0.45, 0.2, -0.3, 7));
      for (let k = 0; k < 3; k++) { const sw = box(0.03, 0.55, 0.03, 0xc8ccd2, 0.15 + k * 0.12, 0.35, -0.48); sw.rotation.z = 0.1; g.add(sw); }
      const gl = glowSprite(0xff6a1a, 1.6, false); gl.position.set(-0.2, 0.85, -0.2); g.add(gl);
      flame(g, -0.2, 0.82, -0.2, 0.6);
    },
    tables: g => {
      g.add(box(1.1, 0.07, 0.55, 0x8a6338, 0, 0.55, 0));
      for (const [x, z] of [[-0.45, -0.2], [0.45, -0.2], [-0.45, 0.2], [0.45, 0.2]]) g.add(box(0.06, 0.52, 0.06, 0x6b4a2b, x, 0.26, z));
      for (const z of [-0.48, 0.48]) { g.add(box(1.1, 0.06, 0.22, 0x7a5232, 0, 0.32, z)); for (const x of [-0.45, 0.45]) g.add(box(0.06, 0.3, 0.06, 0x6b4a2b, x, 0.15, z)); }
      for (const [x, z] of [[-0.3, -0.1], [0.1, 0.12], [0.35, -0.08]]) g.add(cyl(0.05, 0.05, 0.12, 0x9a7a4a, x, 0.64, z, 6));
      g.add(cyl(0.12, 0.12, 0.02, 0xe8e0d0, -0.05, 0.6, -0.05, 8));
    },
    board: g => {
      for (const x of [-0.5, 0.5]) g.add(box(0.08, 1.7, 0.08, 0x5a3a20, x, 0.85, 0));
      g.add(box(1.0, 0.8, 0.06, 0x8a6338, 0, 1.2, 0.02));
      for (const [x, y] of [[-0.3, 1.35], [0.05, 1.3], [0.3, 1.1], [-0.15, 1.0]]) g.add(box(0.22, 0.28, 0.02, 0xf2ead8, x, y, 0.06));
      const rf = box(1.25, 0.06, 0.35, 0x5a3a20, 0, 1.75, 0); rf.rotation.x = 0.3; g.add(rf);
    },
    fishrack: g => {
      for (const x of [-0.55, 0.55]) for (const s of [-1, 1]) { const leg = box(0.05, 1.4, 0.05, 0x7a5432, x, 0.68, s * 0.18); leg.rotation.x = s * 0.25; g.add(leg); }
      g.add(box(1.2, 0.05, 0.05, 0x7a5432, 0, 1.33, 0));
      for (let k = 0; k < 6; k++) g.add(box(0.06, 0.28, 0.12, 0xa8b8c0, -0.45 + k * 0.18, 1.12, 0));
    },
    sawhorse: g => {
      for (const x of [-0.45, 0.45]) for (const s of [-1, 1]) { const leg = box(0.06, 0.65, 0.06, 0x7a5432, x, 0.3, 0); leg.rotation.x = s * 0.45; g.add(leg); }
      const log = cyl(0.15, 0.15, 1.2, 0x8a6338, 0, 0.62, 0, 7); log.rotation.z = Math.PI / 2; g.add(log);
      g.add(box(0.02, 0.3, 0.5, 0xc8ccd2, 0.15, 0.85, 0), cyl(0.2, 0.22, 0.3, 0x7a5a3a, 0.8, 0.15, 0.4, 7));
    },
    gamble: g => {
      g.add(cyl(0.3, 0.3, 0.6, 0x5a3a20, 0, 0.3, 0, 8), cyl(0.38, 0.38, 0.05, 0x3a2a1a, 0, 0.62, 0, 8));
      for (const [x, z] of [[0.05, 0.05], [-0.08, 0.1]]) g.add(box(0.06, 0.06, 0.06, 0xf2f2f2, x, 0.68, z));
      for (let k = 0; k < 3; k++) { const a = k / 3 * Math.PI * 2; g.add(cyl(0.16, 0.16, 0.38, 0x6b4a2b, Math.cos(a) * 0.6, 0.19, Math.sin(a) * 0.6, 6)); }
      g.add(cyl(0.05, 0.05, 0.12, 0x9a7a4a, 0.15, 0.7, -0.1, 6));
    },
    barrel: g => { g.add(cyl(0.26, 0.26, 0.6, 0x7a5232, 0, 0.3, 0, 8), cyl(0.27, 0.27, 0.05, 0x3a3a3a, 0, 0.12, 0, 8), cyl(0.27, 0.27, 0.05, 0x3a3a3a, 0, 0.48, 0, 8)); },
    crates: g => { g.add(box(0.45, 0.45, 0.45, 0xa07a40, -0.12, 0.23, 0), box(0.35, 0.35, 0.35, 0xb08850, 0.22, 0.18, 0.15), box(0.3, 0.3, 0.3, 0x9a7444, -0.05, 0.6, 0.02)); },
    hay: g => { const h = cyl(0.32, 0.32, 0.7, 0xd8b85a, 0, 0.32, 0, 10); h.rotation.z = Math.PI / 2; g.add(h); },
    cart: g => {
      g.add(box(0.7, 0.3, 1.0, 0x8a6338, 0, 0.45, 0), box(0.6, 0.25, 0.8, 0xd8b85a, 0, 0.65, 0));
      for (const s of [-1, 1]) { const w = cyl(0.25, 0.25, 0.06, 0x4a3220, s * 0.4, 0.25, 0, 10); w.rotation.z = Math.PI / 2; g.add(w); }
      g.add(box(0.06, 0.06, 0.7, 0x6b4a2b, -0.15, 0.4, 0.8), box(0.06, 0.06, 0.7, 0x6b4a2b, 0.15, 0.4, 0.8));
    },
    well: g => {
      g.add(cyl(0.45, 0.48, 0.5, 0x8a847a, 0, 0.25, 0, 10), cyl(0.36, 0.36, 0.05, 0x1a3a5a, 0, 0.45, 0, 10));
      g.add(box(0.06, 1.1, 0.06, 0x6b4a2b, -0.4, 0.75, 0), box(0.06, 1.1, 0.06, 0x6b4a2b, 0.4, 0.75, 0));
      const roof = cone(0.6, 0.4, 0x8a3a2a, 0, 1.45, 0, 4);
      roof.rotation.y = Math.PI / 4;
      g.add(roof, cyl(0.1, 0.1, 0.15, 0x7a5232, 0, 0.9, 0, 6));
    },
    banner: (g, town) => { g.add(cyl(0.04, 0.05, 2.4, 0x5a3a1e, 0, 1.2, 0, 5), box(0.04, 0.9, 0.5, TOWN_COLORS[town], 0, 1.85, 0.27), box(0.05, 0.12, 0.52, 0xe8c547, 0, 1.4, 0.27)); },
    flowers: g => {
      g.add(box(0.8, 0.25, 0.35, 0x7a5232, 0, 0.12, 0));
      for (let k = 0; k < 5; k++) g.add(mesh(geo('IcosahedronGeometry', 0.08, 0), mat([0xe04a6a, 0xf0d040, 0xffffff, 0xa060e0][k % 4]), -0.3 + k * 0.15, 0.32, 0));
    },
    orecart: g => {
      g.add(box(0.6, 0.4, 0.8, 0x55555c, 0, 0.42, 0), cone(0.3, 0.25, 0xb07a4a, 0, 0.72, 0, 6));
      for (const s of [-1, 1]) { const w = cyl(0.16, 0.16, 0.05, 0x2a2a2a, s * 0.32, 0.17, 0, 8); w.rotation.z = Math.PI / 2; g.add(w); }
    },
    anvilprop: g => { g.add(cyl(0.22, 0.25, 0.35, 0x6b4a2b, 0, 0.18, 0, 7), box(0.45, 0.13, 0.2, 0x45454c, 0, 0.42, 0)); },
    nets: g => {
      g.add(box(0.06, 1.0, 0.06, 0x6b4a2b, -0.45, 0.5, 0), box(0.06, 1.0, 0.06, 0x6b4a2b, 0.45, 0.5, 0), box(0.96, 0.05, 0.05, 0x6b4a2b, 0, 0.98, 0));
      const net = new C.Mesh(geo('PlaneGeometry', 0.85, 0.75), new C.MeshLambertMaterial({ color: 0xc8b890, transparent: true, opacity: 0.7, side: C.DoubleSide }));
      net.position.y = 0.58;
      g.add(net);
    },
    logpile: g => { for (let k = 0; k < 5; k++) { const l = cyl(0.12, 0.12, 0.9, 0x8a6338, -0.25 + (k % 3) * 0.25, 0.12 + (k > 2 ? 0.22 : 0), 0, 6); l.rotation.x = Math.PI / 2; if (k > 2) l.position.x += 0.12; g.add(l); } },
    tent: g => {
      const t = cone(0.65, 0.95, [0x7a5a3a, 0x6a4a3a, 0x8a7a5a][Math.floor(Math.random() * 3)], 0, 0.48, 0, 4);
      t.rotation.y = Math.PI / 4;
      g.add(t, box(0.25, 0.4, 0.02, 0x2a1a0a, 0, 0.2, 0.46));
    },
    firepit: g => {
      for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; g.add(mesh(geo('DodecahedronGeometry', 0.09, 0), mat(0x6a655e), Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3)); }
      flame(g, 0, 0.25, 0);
      const gl = glowSprite(0xff9a3a, 2.4, false); gl.position.y = 0.4; g.add(gl);
    },
    lamp: g => {
      g.add(cyl(0.04, 0.06, 1.8, 0x2a2a2a, 0, 0.9, 0, 6), box(0.2, 0.25, 0.2, 0x2a2a2a, 0, 1.85, 0));
      g.add(mesh(geo('BoxGeometry', 0.14, 0.18, 0.14), windowMat, 0, 1.85, 0, false));
      const gl = glowSprite(0xffc870, 2.2); gl.position.y = 1.85; g.add(gl);
    },
    boat: g => {
      g.add(box(0.8, 0.3, 2.0, 0x7a5232, 0, 0.1, 0), box(0.6, 0.1, 1.6, 0x5a3a20, 0, 0.27, 0));
      g.add(cyl(0.04, 0.04, 1.8, 0x5a3a1e, 0, 1.1, 0.2, 5));
      const sail = new C.Mesh(geo('PlaneGeometry', 0.9, 1.1), new C.MeshLambertMaterial({ color: 0xeee6d0, side: C.DoubleSide }));
      sail.position.set(0, 1.2, 0.2); sail.rotation.y = Math.PI / 2;
      g.add(sail);
    },
  };

  function animal(kind) {
    const g = new C.Group(), inner = new C.Group();
    g.add(inner);
    const a = { g, inner, kind: 'wolf', legs: [], height: 0.8 };
    const legs = (pts, h, w, c) => { for (const [x, z] of pts) { const l = limb(w, h, c); l.position.set(x, h, z); inner.add(l); a.legs.push(l); } };
    if (kind === 'cow') {
      inner.add(box(0.5, 0.45, 0.95, 0xf2efe6, 0, 0.72, 0), box(0.3, 0.3, 0.35, 0xf2efe6, 0, 0.85, 0.6), box(0.52, 0.2, 0.3, 0x2a2a2a, 0, 0.78, -0.1), box(0.2, 0.12, 0.08, 0xe0a0a0, 0, 0.75, 0.79));
      legs([[-0.17, 0.32], [0.17, 0.32], [-0.17, -0.32], [0.17, -0.32]], 0.5, 0.11, 0xe6e2d8);
    } else if (kind === 'pig') {
      inner.add(box(0.42, 0.36, 0.7, 0xf0a8a8, 0, 0.42, 0), box(0.3, 0.28, 0.25, 0xf0a8a8, 0, 0.45, 0.45), box(0.14, 0.1, 0.06, 0xd88888, 0, 0.42, 0.6));
      legs([[-0.13, 0.22], [0.13, 0.22], [-0.13, -0.22], [0.13, -0.22]], 0.25, 0.09, 0xe09898);
    } else if (kind === 'chicken') {
      inner.add(box(0.2, 0.2, 0.26, 0xfafafa, 0, 0.25, 0), box(0.12, 0.14, 0.12, 0xfafafa, 0, 0.4, 0.12), box(0.03, 0.06, 0.06, 0xd03a2a, 0, 0.5, 0.12), box(0.04, 0.03, 0.06, 0xe8a83a, 0, 0.4, 0.2));
      legs([[-0.05, 0], [0.05, 0]], 0.15, 0.03, 0xe8a83a);
      a.height = 0.5;
    } else if (kind === 'dog') {
      inner.add(box(0.24, 0.24, 0.55, 0x8a5a32, 0, 0.38, 0), box(0.2, 0.2, 0.24, 0x8a5a32, 0, 0.5, 0.35), box(0.08, 0.08, 0.3, 0x8a5a32, 0, 0.45, -0.35));
      legs([[-0.08, 0.18], [0.08, 0.18], [-0.08, -0.18], [0.08, -0.18]], 0.27, 0.07, 0x6a4222);
    } else if (kind === 'deer') {
      inner.add(box(0.32, 0.36, 0.85, 0xa8743e, 0, 0.82, 0), box(0.16, 0.42, 0.18, 0xa8743e, 0, 1.1, 0.42), box(0.18, 0.18, 0.3, 0xa8743e, 0, 1.3, 0.55), box(0.12, 0.08, 0.06, 0xf6f0e0, 0, 0.92, -0.44));
      if (Math.random() < 0.5) for (const s of [-1, 1]) { const ant = cyl(0.015, 0.02, 0.35, 0xe0d6c0, s * 0.08, 1.52, 0.5, 4); ant.rotation.z = s * 0.4; inner.add(ant); }
      legs([[-0.1, 0.3], [0.1, 0.3], [-0.1, -0.3], [0.1, -0.3]], 0.64, 0.07, 0x8a5a2e);
      a.height = 1.5;
    } else if (kind === 'horse') {
      const c = 0x7a4a2a, dk = 0x4a2a14;
      inner.add(box(0.42, 0.45, 1.15, c, 0, 1.05, 0), box(0.24, 0.5, 0.26, c, 0, 1.4, 0.58), box(0.22, 0.22, 0.42, c, 0, 1.62, 0.8));
      inner.add(box(0.06, 0.45, 0.28, dk, 0, 1.55, 0.5), box(0.08, 0.5, 0.08, dk, 0, 0.95, -0.62));
      inner.add(box(0.46, 0.08, 0.5, 0x8a2a2a, 0, 1.3, 0.05), box(0.36, 0.12, 0.42, 0x5a3a20, 0, 1.36, 0.05));
      for (const sx of [-1, 1]) inner.add(box(0.05, 0.1, 0.06, dk, sx * 0.08, 1.8, 0.72));
      legs([[-0.14, 0.42], [0.14, 0.42], [-0.14, -0.42], [0.14, -0.42]], 0.85, 0.11, dk);
      a.height = 1.9;
    } else if (kind === 'cat') {
      const c = 0xe0a050;
      inner.add(box(0.16, 0.16, 0.36, c, 0, 0.22, 0), box(0.15, 0.14, 0.14, c, 0, 0.3, 0.22), box(0.04, 0.04, 0.3, c, 0, 0.36, -0.28).rotateX(-0.8));
      for (const sx of [-1, 1]) inner.add(cone(0.035, 0.07, c, sx * 0.05, 0.4, 0.22, 4));
      legs([[-0.05, 0.12], [0.05, 0.12], [-0.05, -0.12], [0.05, -0.12]], 0.15, 0.04, 0xc08a40);
      a.height = 0.45;
    } else if (kind === 'rabbit') {
      inner.add(box(0.18, 0.16, 0.26, 0x9a8a78, 0, 0.12, 0), box(0.13, 0.13, 0.13, 0x9a8a78, 0, 0.22, 0.13), box(0.04, 0.16, 0.04, 0x9a8a78, -0.03, 0.34, 0.12), box(0.04, 0.16, 0.04, 0x9a8a78, 0.03, 0.34, 0.12), box(0.07, 0.07, 0.04, 0xf6f6f6, 0, 0.14, -0.14));
      a.hop = true;
      a.height = 0.4;
    }
    return a;
  }

  // Simple wandering: pick a target, walk to it, pause, repeat. Visual only.
  function wander(w, dt, t) {
    if (w.pause > 0) { w.pause -= dt; w.a.g.position.set(w.x, gh(w.x, w.z), w.z); animateLimbs(w.a, false, false, dt, t); return; }
    const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz);
    if (d < 0.1) { w.pause = w.idle(); w.pick(); animateLimbs(w.a, false, false, dt, t); return; }
    const step = Math.min(d, w.speed * dt);
    w.x += dx / d * step; w.z += dz / d * step;
    w.a.rot = lerpAngle(w.a.rot || 0, Math.atan2(dx, dz), Math.min(1, dt * 8));
    w.a.g.rotation.y = w.a.rot;
    w.a.g.position.set(w.x, gh(w.x, w.z), w.z);
    if (w.a.hop) w.a.inner.position.y = Math.abs(Math.sin(t * 12)) * 0.15;
    else animateLimbs(w.a, true, false, dt, t, w.speed * 4);
  }

  function freeTownTile(x, y) {
    const i = idx(x, y);
    return terrain[i] === T.FLOOR && !townBlocks.has(i) && !services.has(i);
  }
  function lineClear(x0, z0, x1, z1) {
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) * 2);
    for (let k = 1; k <= n; k++) {
      const x = Math.round(x0 + (x1 - x0) * k / n), z = Math.round(z0 + (z1 - z0) * k / n);
      if (!freeTownTile(x, z)) return false;
    }
    return true;
  }

  function buildTownLife() {
    const folkColors = [0x3a6a9e, 0x9e5a3a, 0x5a8a3a, 0x8a3a6a, 0xc0a040, 0x6a4a8a, 0x2a7a7a];
    for (const id in TOWN_DEFS) {
      const d = TOWN_DEFS[id], tg = new C.Group();
      townGroups.push({ g: tg, x: d.x, y: d.y, id });
      scene.add(tg);
      const staticG = new C.Group();
      for (const p of townProps.filter(p => p.town === id)) {
        if (p.kind === 'pen') {
          const pg = new C.Group();
          for (let x = p.x; x < p.x + p.w; x++) for (let y = p.y; y < p.y + p.h; y++) {
            if (!(y === p.y || y === p.y + p.h - 1 || x === p.x || x === p.x + p.w - 1)) continue;
            pg.add(box(0.1, 0.7, 0.1, 0x7a5232, x, tileH[idx(x, y)] + 0.35, y));
            pg.add(box(x === p.x || x === p.x + p.w - 1 ? 0.06 : 1, 0.06, x === p.x || x === p.x + p.w - 1 ? 1 : 0.06, 0x9a7444, x, tileH[idx(x, y)] + 0.5, y));
          }
          staticG.add(pg);
          const n = p.animal === 'chicken' ? 5 : 3;
          for (let k = 0; k < n; k++) {
            const a = animal(p.animal);
            const w = { a, x: p.x + 1 + Math.random() * (p.w - 3), z: p.y + 1 + Math.random() * (p.h - 3), speed: p.animal === 'chicken' ? 0.8 : 0.4, pause: Math.random() * 3 };
            w.pick = () => { w.tx = p.x + 1 + Math.random() * (p.w - 3); w.tz = p.y + 1 + Math.random() * (p.h - 3); };
            w.idle = () => 1 + Math.random() * 4;
            w.pick();
            tg.add(a.g); walkers.push(w);
          }
          continue;
        }
        const g = new C.Group();
        PROP_MODELS[p.kind](g, id, p);
        const h = p.kind === 'boat' ? 0 : tileH[idx(p.x, p.y)];
        g.position.set(p.x, h, p.y);
        g.rotation.y = p.rot || 0;
        if (p.kind === 'boat') { g.userData.bob = Math.random() * 6; tg.add(g); walkers.push({ boat: g }); continue; }
        staticG.add(g);
        // A merchant minds every stall; smiths hammer away at the forges.
        if (p.kind === 'stall' || p.kind === 'forge') {
          const a = townsfolk(folkColors[(p.x * 7 + p.y) % folkColors.length]);
          const back = p.kind === 'stall' ? -0.75 : 0.75;
          a.g.position.set(p.x + Math.sin(p.rot || 0) * back, h, p.y + Math.cos(p.rot || 0) * back);
          a.g.rotation.y = (p.rot || 0) + (p.kind === 'forge' ? Math.PI * 0.75 : 0);
          if (p.kind === 'forge') { a.hand.add(tool('hammer', 0)); a.working = true; a.phase = p.x; }
          tg.add(a.g);
          actors.push(a);
        }
      }
      tg.add(bake(staticG));
      // Townsfolk wander between open spots; some carry crates.
      const count = Math.round((id === 'ironhold' ? 12 : 7) * Q.folk);
      for (let k = 0; k < count; k++) {
        const a = townsfolk(folkColors[(k * 3 + id.length) % folkColors.length]);
        if (k % 3 === 0) { a.hand.add(box(0.3, 0.25, 0.25, 0xa07a40, 0, 0.1, 0.2)); a.carry = true; }
        const w = { a, x: d.x, z: d.y + 2, speed: 1.2 + Math.random() * 0.5, pause: Math.random() * 3 };
        w.pick = () => {
          for (let tries = 0; tries < 12; tries++) {
            const x = d.x + Math.round((Math.random() * 2 - 1) * (d.hw - 1)), z = d.y + Math.round((Math.random() * 2 - 1) * (d.hh - 1));
            if (freeTownTile(x, z) && lineClear(w.x, w.z, x, z)) { w.tx = x; w.tz = z; return; }
          }
          w.tx = w.x; w.tz = w.z;
        };
        w.idle = () => 1 + Math.random() * 5;
        for (let tries = 0; tries < 20; tries++) {
          const x = d.x + Math.round((Math.random() * 2 - 1) * (d.hw - 1)), z = d.y + Math.round((Math.random() * 2 - 1) * (d.hh - 1));
          if (freeTownTile(x, z)) { w.x = x; w.z = z; break; }
        }
        w.pick();
        tg.add(a.g); walkers.push(w);
      }
      // A town dog.
      const dog = animal('dog'), dw = { a: dog, x: d.x + 1, z: d.y + 1, speed: 2.2, pause: 0 };
      dw.pick = () => { const x = d.x + Math.round((Math.random() * 2 - 1) * 4), z = d.y + Math.round((Math.random() * 2 - 1) * 3); if (freeTownTile(x, z) && lineClear(dw.x, dw.z, x, z)) { dw.tx = x; dw.tz = z; } else { dw.tx = dw.x; dw.tz = dw.z; } };
      dw.idle = () => 0.5 + Math.random() * 3;
      dw.pick();
      tg.add(dog.g); walkers.push(dw);
      // Guards patrol inside the capital's walls.
      if (d.walls) {
        const pts = [[d.x - d.hw + 2, d.y - d.hh + 2], [d.x + d.hw - 2, d.y - d.hh + 2], [d.x + d.hw - 2, d.y + d.hh - 2], [d.x - d.hw + 2, d.y + d.hh - 2]];
        for (let k = 0; k < 4; k++) {
          const a = humanoid({ tunic: 0x8c8c94, skin: 0xe0b08a, legs: 0x3a3a40, sleeve: 0x6a6a72, scale: 0.85 });
          a.body.add(box(0.3, 0.32, 0.02, TOWN_COLORS.ironhold, 0, 0, 0.135));
          a.head.add(box(0.34, 0.16, 0.34, 0x9c9c9c, 0, 0.12, 0));
          a.hand.add(tool('spear'));
          let leg = k;
          const w = { a, x: pts[k][0], z: pts[k][1], speed: 1.1, pause: 0 };
          w.pick = () => { leg = (leg + 1) % 4; w.tx = pts[leg][0]; w.tz = pts[leg][1]; };
          w.idle = () => 2;
          w.pick();
          tg.add(a.g); walkers.push(w);
        }
      }
    }
  }

  // ------------------------------------------------------------ ruins, stones, camps, shrines, signposts
  const POI_PARTS = {
    wall: g => {
      const h = 0.6 + Math.random() * 1.2;
      g.add(box(1, h, 0.7, 0x8a857c, 0, h / 2, 0), box(1.02, 0.12, 0.72, 0x5a7a3a, 0, h + 0.03, 0));
      if (Math.random() < 0.5) g.add(mesh(geo('DodecahedronGeometry', 0.18, 0), mat(0x8a857c), 0.4, 0.1, 0.5));
    },
    pillar: g => { const h = 1 + Math.random() * 1.6; g.add(cyl(0.25, 0.3, h, 0x9a958c, 0, h / 2, 0, 8), cyl(0.36, 0.36, 0.15, 0x8a857c, 0, 0.07, 0, 8)); },
    standing: g => { const h = 1.6 + Math.random() * 0.9; const st = box(0.55, h, 0.3, 0x6e6a66, 0, h / 2, 0); st.rotation.z = (Math.random() - 0.5) * 0.12; g.add(st, box(0.57, 0.15, 0.32, 0x5a7a3a, 0, h * 0.3, 0)); },
    tent: PROP_MODELS.tent,
    firepit: g => { for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; g.add(mesh(geo('DodecahedronGeometry', 0.09, 0), mat(0x6a655e), Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3)); } g.add(cyl(0.22, 0.25, 0.04, 0x2a2420, 0, 0.02, 0, 8)); },
    crates: PROP_MODELS.crates,
    mound: g => {
      g.add(mesh(geo('DodecahedronGeometry', 0.9, 0), mat(0x5e5a54), 0, 0.35, 0), mesh(geo('DodecahedronGeometry', 0.5, 0), mat(0x6e6a62), 0.4, 0.6, 0.3));
      g.add(box(1.2, 0.12, 1.0, 0x4a6a32, 0, 0.95, 0));
    },
  };

  // A stair cut into a stone arch on the surface, a ladder up a light shaft below.
  function portalModel(down) {
    const g = new C.Group();
    if (down) {
      for (const x of [-0.75, 0.75]) g.add(box(0.4, 2.2, 0.5, 0x7a766e, x, 1.1, -0.3));
      g.add(box(2.0, 0.45, 0.6, 0x6a665e, 0, 2.4, -0.3), box(1.1, 1.9, 0.1, 0x050404, 0, 0.95, -0.25));
      for (let k = 0; k < 4; k++) g.add(box(1.0, 0.1, 0.3, 0x5a564e, 0, 0.5 - k * 0.12, -0.15 - k * 0.1));
      for (const x of [-1.15, 1.15]) { g.add(box(0.08, 1.3, 0.08, 0x2a2a2a, x, 0.65, 0.1)); flame(g, x, 1.4, 0.1, 0.7); const gl = glowSprite(0xff9a3a, 2.0, false); gl.position.set(x, 1.45, 0.1); g.add(gl); }
      g.add(mesh(geo('DodecahedronGeometry', 0.18, 0), mat(0xe8e2cc), 0.5, 2.75, -0.1));
    } else {
      for (const x of [-0.25, 0.25]) g.add(box(0.07, 4.0, 0.07, 0x6b4a2b, x, 2.0, 0));
      for (let k = 0; k < 10; k++) g.add(box(0.5, 0.05, 0.05, 0x7a5a32, 0, 0.3 + k * 0.38, 0));
      const shaft = new C.Mesh(geo('CylinderGeometry', 0.6, 0.9, 6, 8, 1, true), new C.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.12, depthWrite: false, side: C.DoubleSide, fog: false }));
      shaft.position.y = 3; shaft.userData.noBake = true;
      g.add(shaft);
      const gl = glowSprite(0xfff2c8, 3.2, false); gl.position.y = 3.5; g.add(gl);
    }
    return g;
  }

  // Star seeds glow in hidden places; cairns mark buried treasure.
  function buildSecrets() {
    starSeeds.forEach((sd, k) => {
      const g = new C.Group();
      const star = mesh(geo('OctahedronGeometry', 0.22, 0), mat(0xffe27a, { emissive: 0xffc030, emissiveIntensity: 0.9 }), 0, 0, 0, false);
      g.add(star);
      const gl = glowSprite(0xffd060, 1.8, false); g.add(gl);
      g.position.set(sd.x, tileH[idx(sd.x, sd.y)] + 0.9, sd.y);
      scene.add(g);
      seedObjs.push({ k, g, star, base: g.position.y });
    });
    cairns.forEach(c => {
      const i = idx(c.x, c.y), svc = services.get(i), g = new C.Group(), pile = new C.Group(), hole = new C.Group();
      for (const [x, y, z, r] of [[0, 0.18, 0, 0.32], [0.22, 0.12, 0.15, 0.2], [-0.2, 0.12, 0.12, 0.2], [0.04, 0.48, 0.02, 0.2], [0, 0.7, 0, 0.12]]) pile.add(mesh(geo('DodecahedronGeometry', r, 0), mat(0x8a857c), x, y, z));
      pile.add(box(0.06, 0.6, 0.06, 0x6b4a2b, 0.35, 0.3, -0.25), box(0.3, 0.2, 0.04, 0xa02a2a, 0.45, 0.55, -0.25));
      hole.add(mesh(geo('CylinderGeometry', 0.42, 0.36, 0.06, 10), mat(0x2a1e14), 0, 0.03, 0), mesh(geo('DodecahedronGeometry', 0.22, 0), mat(0x6a5a44), 0.55, 0.1, 0.2));
      g.add(pile, hole);
      g.position.set(c.x, tileH[i], c.y);
      g.traverse(o => { o.userData.tile = i; });
      scene.add(g); pickables.push(g);
      cairnObjs.push({ id: svc.id, pile, hole });
    });
  }
  function updateSecrets(t) {
    const st = state.story;
    for (const o of seedObjs) {
      o.g.visible = !st.seeds[o.k] && Math.abs(o.g.position.x - player.vx) < 80 && Math.abs(o.g.position.z - player.vz) < 80;
      if (!o.g.visible) continue;
      o.star.rotation.y = t * 1.5;
      o.g.position.y = o.base + Math.sin(t * 2 + o.k) * 0.12;
    }
    for (const o of cairnObjs) { const dug = !!st.dug[o.id]; o.pile.visible = !dug; o.hole.visible = dug; }
    for (const r of runeObjs) {
      const solved = !!st.solved[r.svc.poi], sym = ((st.runes[r.svc.poi] || {})[r.svc.dir] || 'Sun') + (solved ? '*' : '');
      if (sym === r.sym) continue;
      r.sym = sym;
      if (r.label) { r.sg.remove(r.label); disposeSprite(r.label); }
      r.label = makeLabel(RUNE_GLYPHS[sym.replace('*', '')], { color: solved ? '#ffd84a' : '#bfe8ff', size: 72, h: 0.55 });
      r.label.position.y = 2.9;
      r.sg.add(r.label);
    }
  }

  // Wall torches, bones and rubble along the dungeon halls.
  function buildDungeons() {
    for (const dg of DUNGEONS) {
      const g = new C.Group();
      for (const tc of dungeonTorches.filter(t => t.dungeon === dg.id)) {
        const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => !dungeonMask[idx(tc.x + a, tc.y + b)]);
        const x = tc.x + dir[0] * 0.42, z = tc.y + dir[1] * 0.42, h = tileH[idx(tc.x, tc.y)];
        g.add(box(0.1, 0.4, 0.1, 0x2a2a2a, x, h + 1.4, z), box(0.16, 0.12, 0.16, 0x3a3a3a, x, h + 1.65, z));
        flame(g, x, h + 1.82, z, 0.7);
        const gl = glowSprite(0xff9a3a, 2.6, false); gl.position.set(x, h + 1.85, z); g.add(gl);
      }
      for (let y = dg.y0; y < dg.y0 + dg.h; y++) for (let x = dg.x0; x < dg.x0 + dg.w; x++) {
        const i = idx(x, y);
        if (!dungeonMask[i] || services.has(i)) continue;
        const r = rnd(i, 41), h = tileH[i];
        if (r < 0.025) { g.add(mesh(geo('DodecahedronGeometry', 0.12, 0), mat(0xe8e2cc), x, h + 0.1, y), box(0.4, 0.05, 0.06, 0xd8d2bc, x + 0.15, h + 0.03, y + 0.1)); }
        else if (r < 0.06) g.add(mesh(geo('DodecahedronGeometry', 0.25 + rnd(i, 42) * 0.2, 0), mat(dg.id === 'cavern' ? 0x6a7a8a : 0x5a554e), x, h + 0.1, y));
        else if (r < 0.075 && dg.id === 'cavern') { const c = mesh(geo('OctahedronGeometry', 0.18, 0), mat(0x9adfff, { emissive: 0x3a8fcf, emissiveIntensity: 0.8 }), x, h + 0.2, y); c.scale.y = 2.2; g.add(c); }
        else if (r < 0.075) g.add(cyl(0.18, 0.2, 0.5, 0x5a3a20, x, h + 0.25, y, 7));
      }
      scene.add(bake(g));
    }
  }

  function chestModel(open) {
    const g = new C.Group();
    g.add(box(0.7, 0.4, 0.45, 0x7a4a22, 0, 0.2, 0), box(0.72, 0.06, 0.47, 0xc9a24a, 0, 0.32, 0));
    const lid = new C.Group();
    lid.position.set(0, 0.4, -0.22);
    lid.add(box(0.72, 0.16, 0.47, 0x8a5a2a, 0, 0.08, 0.22));
    lid.rotation.x = open ? -1.6 : 0;
    g.add(lid);
    g.userData.lid = lid;
    return g;
  }

  function buildPois() {
    for (const p of pois) {
      const g = new C.Group();
      g.position.set(0, 0, 0);
      for (const part of p.parts) {
        const pg = new C.Group();
        POI_PARTS[part.kind](pg);
        pg.position.set(part.x, tileH[idx(part.x, part.y)], part.y);
        pg.rotation.y = part.rot || Math.random() * 0.4;
        g.add(pg);
      }
      const chests = [];
      for (const [i, svc] of services) {
        if (svc.poi !== p.id && svc.poi !== p.id + '_hoard') continue;
        const x = i % W, y = (i - x) / W;
        const sg = new C.Group();
        if (svc.type === 'chest') { const chest = chestModel(!!state.opened[svc.poi]); chests.push({ chest, key: svc.poi }); sg.add(chest); }
        else if (svc.type === 'rune') {
          const rr = { svc, sg, sym: null, label: null };
          runeObjs.push(rr);
          sg.userData.rune = rr;
        }
        else if (svc.type === 'forge') {
          sg.add(box(2.2, 0.4, 1.6, 0x6a665e, 0, 0.2, 0), box(1.6, 0.9, 1.1, 0x7a766e, 0, 0.85, -0.1), mesh(geo('BoxGeometry', 0.9, 0.08, 0.6), mat(0x2a2420), 0, 1.32, -0.1, false));
          sg.add(box(0.7, 2.6, 0.7, 0x5a564e, 0, 2.6, -0.45), box(0.9, 0.2, 0.9, 0x6a665e, 0, 3.95, -0.45));
          sg.add(cyl(0.3, 0.35, 0.4, 0x5a564e, 1.4, 0.2, 0.6, 7), box(0.7, 0.2, 0.32, 0x3a3a42, 1.4, 0.5, 0.6), box(0.3, 0.12, 0.2, 0x3a3a42, 1.8, 0.5, 0.6));
          for (const [rx, rz] of [[-0.6, 0.46], [0, 0.46], [0.6, 0.46]]) sg.add(mesh(geo('BoxGeometry', 0.25, 0.25, 0.04), mat(0x8a6a3a, { emissive: 0xffb040, emissiveIntensity: 0 }), rx, 0.9, rz, false));
          const fx = new C.Group();
          fx.add(mesh(geo('BoxGeometry', 0.8, 0.06, 0.5), glow(0xff8a2a), 0, 1.36, -0.1, false));
          flame(fx, -0.2, 1.55, -0.1, 0.9); flame(fx, 0.2, 1.5, -0.1, 0.8);
          const gl = glowSprite(0xffb040, 5, false); gl.position.set(0, 1.8, -0.1); fx.add(gl);
          const pl = new C.PointLight(0xffa040, 1.4, 12, 1.6); pl.position.set(0, 2.2, 0.6); fx.add(pl);
          fx.visible = false;
          sg.add(fx);
          forgeFx = { fx, runes: sg.children.filter(o => o.material && o.material.emissive && o.material.emissive.getHex() === 0xffb040) };
        }
        else if (svc.type === 'portal') {
          const below = !!inDungeonRect(x, y);
          sg.add(portalModel(!below));
          if (below) { const lb = makeLabel(svc.label, { color: '#ffe9a8', h: 0.3 }); lb.position.y = 3.2; sg.add(lb); }
        } else {
          sg.add(cyl(0.45, 0.55, 0.6, 0x8a857c, 0, 0.3, 0, 6), cyl(0.3, 0.35, 0.25, 0x9a958c, 0, 0.72, 0, 6));
          const crystal = mesh(geo('OctahedronGeometry', 0.25, 0), mat(0x9adfff, { emissive: 0x3a9fdf, emissiveIntensity: 1 }), 0, 1.2, 0, false);
          crystal.userData.spin = true;
          sg.add(crystal);
          const gl = glowSprite(0x7ad0ff, 2.6, false); gl.position.y = 1.2; sg.add(gl);
        }
        sg.position.set(x, tileH[i], y);
        sg.traverse(o => { o.userData.tile = i; });
        pickables.push(sg);
        g.add(sg);
      }
      const label = makeLabel(p.name, { color: '#ffe9a8', h: 0.4 });
      label.position.set(p.x, tileH[idx(p.x, p.y)] + 3, p.y);
      g.add(label);
      scene.add(g);
      poiObjs.push({ p, g, label, chests });
    }
  }

  function buildSigns() {
    for (const sgn of signs) {
      const g = new C.Group();
      g.add(cyl(0.05, 0.06, 1.6, 0x5a3a1e, 0, 0.8, 0, 5));
      g.add(box(0.9, 0.2, 0.05, 0xb08850, 0.15, 1.35, 0), box(0.9, 0.2, 0.05, 0xb08850, -0.15, 1.05, 0));
      g.position.set(sgn.x, tileH[idx(sgn.x, sgn.y)], sgn.y);
      g.rotation.y = sgn.rot + Math.PI / 2;
      const l1 = makeLabel(sgn.text[0], { color: '#ffe9a8', h: 0.26, size: 32 }), l2 = makeLabel(sgn.text[1], { color: '#ffe9a8', h: 0.26, size: 32 });
      l1.position.set(sgn.x, tileH[idx(sgn.x, sgn.y)] + 2.05, sgn.y);
      l2.position.set(sgn.x, tileH[idx(sgn.x, sgn.y)] + 1.75, sgn.y);
      scene.add(g, l1, l2);
    }
  }

  // ------------------------------------------------------------ ground clutter: grass, flowers, mushrooms, reeds...
  function mergeGeos(list) {
    const pos = [];
    for (const g of list) {
      const ng = g.index ? g.toNonIndexed() : g;
      pos.push(...ng.attributes.position.array);
    }
    const out = new C.BufferGeometry();
    out.setAttribute('position', new C.BufferAttribute(new Float32Array(pos), 3));
    out.computeVertexNormals();
    return out;
  }
  function tuftGeo() {
    const blades = [];
    for (let k = 0; k < 4; k++) {
      const b = new C.ConeGeometry(0.035, 0.34 + k * 0.04, 3);
      b.translate(0, 0.17, 0);
      b.rotateZ((k - 1.5) * 0.25);
      b.rotateY(k * 1.7);
      b.translate((k - 1.5) * 0.05, 0, (k % 2) * 0.05);
      blades.push(b);
    }
    return mergeGeos(blades);
  }
  function reedGeo() {
    const r = [];
    for (let k = 0; k < 3; k++) { const c = new C.CylinderGeometry(0.015, 0.02, 0.8 + k * 0.15, 4); c.translate((k - 1) * 0.08, 0.4, (k % 2) * 0.06); r.push(c); }
    const head = new C.CylinderGeometry(0.035, 0.035, 0.16, 5); head.translate(0, 0.85, 0); r.push(head);
    return mergeGeos(r);
  }
  const CLUTTER_KINDS = {
    tuft:     { geo: () => tuftGeo(), cap: 12000 },
    flower:   { geo: () => { const s = new C.CylinderGeometry(0.01, 0.01, 0.22, 3); s.translate(0, 0.11, 0); const h = new C.IcosahedronGeometry(0.055, 0); h.translate(0, 0.24, 0); return mergeGeos([s, h]); }, cap: 3000 },
    mushroom: { geo: () => { const s = new C.CylinderGeometry(0.03, 0.04, 0.12, 5); s.translate(0, 0.06, 0); const c = new C.ConeGeometry(0.1, 0.08, 7); c.translate(0, 0.15, 0); return mergeGeos([s, c]); }, cap: 1500 },
    rock:     { geo: () => new C.DodecahedronGeometry(0.12, 0), cap: 2500 },
    log:      { geo: () => { const c = new C.CylinderGeometry(0.12, 0.14, 1.3, 6); c.rotateZ(Math.PI / 2); c.translate(0, 0.12, 0); return c; }, cap: 400 },
    reed:     { geo: () => reedGeo(), cap: 3000 },
    lily:     { geo: () => { const c = new C.CylinderGeometry(0.2, 0.2, 0.02, 7); c.translate(0, 0.0, 0); return c; }, cap: 1500 },
    cactus:   { geo: () => { const t = new C.CylinderGeometry(0.12, 0.14, 1.1, 6); t.translate(0, 0.55, 0); const a = new C.CylinderGeometry(0.07, 0.07, 0.4, 5); a.translate(0.2, 0.75, 0); const b = new C.CylinderGeometry(0.07, 0.07, 0.3, 5); b.translate(-0.2, 0.55, 0); const c = new C.CylinderGeometry(0.06, 0.06, 0.18, 5); c.rotateZ(Math.PI / 2); c.translate(0.14, 0.58, 0); const d = c.clone(); d.translate(-0.28, -0.2, 0); return mergeGeos([t, a, b, c, d]); }, cap: 700 },
    snow:     { geo: () => { const c = new C.SphereGeometry(0.4, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); c.scale(1, 0.35, 0.8); return c; }, cap: 2500 },
  };
  const clutter = {};
  let clutterX = -999, clutterY = -999;
  function buildClutter() {
    for (const k in CLUTTER_KINDS) {
      const def = CLUTTER_KINDS[k];
      const im = new C.InstancedMesh(def.geo(), new C.MeshLambertMaterial({ color: 0xffffff }), def.cap);
      im.instanceColor = new C.InstancedBufferAttribute(new Float32Array(def.cap * 3).fill(1), 3);
      im.count = 0;
      im.frustumCulled = false;
      im.receiveShadow = k !== 'lily';
      scene.add(im);
      clutter[k] = im;
    }
  }
  const BIOME_GRASS = { [BIOME.MEADOW]: 0x6aa83a, [BIOME.FOREST]: 0x4a8a30, [BIOME.BADLANDS]: 0xb0a058, [BIOME.HIGHLANDS]: 0x7a9a6a,
    [BIOME.MARSH]: 0x5a7a3a, [BIOME.DESERT]: 0xb8a868, [BIOME.TAIGA]: 0x7a9a82, [BIOME.ISLES]: 0x6ab040 };
  const SEASON_GRASS = [0x7ab83a, null, 0xa8a048, 0x9aa890];
  const FLOWER_COLORS = [0xf04a5a, 0xf0d040, 0xffffff, 0xb070f0, 0x5a9af0, 0xff9a3a];
  function streamClutter() {
    clutterX = Math.round(player.vx); clutterY = Math.round(player.vz);
    for (const k in clutter) clutter[k].count = 0;
    const R = Q.clutterR, dens = Q.clutter, m4 = new C.Matrix4(), q = new C.Quaternion(), e = new C.Euler(), v = new C.Vector3(), sc = new C.Vector3(), col = new C.Color();
    const put = (kind, x, z, y, rot, s, color) => {
      const im = clutter[kind];
      if (im.count >= im.instanceMatrix.count) return;
      m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, rot, 0)), sc.set(s, s, s));
      im.setMatrixAt(im.count, m4);
      im.setColorAt(im.count, col.setHex(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.08));
      im.count++;
    };
    const near = (x, y, type) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => terrain[idx(x + a, y + b)] === type);
    for (let y = clutterY - R; y <= clutterY + R; y++) for (let x = clutterX - R; x <= clutterX + R; x++) {
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue;
      const i = idx(x, y), t = terrain[i];
      if (structIndex.has(i) || townBlocks.has(i) || services.has(i)) continue;
      const r1 = rnd(i, 21), r2 = rnd(i, 22), r3 = rnd(i, 23), b = biome[i];
      const jx = () => x + (Math.random() - 0.5) * 0.9, jz = () => y + (Math.random() - 0.5) * 0.9;
      if (t === T.WATER) {
        if (r1 < 0.14 * dens && near(x, y, T.GRASS) && y < coastY(x) - 6) put('lily', jx(), jz(), -0.03, r2 * 6, 0.7 + r3 * 0.6, 0x3a8a3a);
        continue;
      }
      if (t !== T.GRASS && t !== T.SAND) continue;
      const hasNode = nodes.has(i);
      if (near(x, y, T.WATER) && r1 < 0.45 * dens) { const px = jx(), pz = jz(); put('reed', px, pz, gh(px, pz), r2 * 6, 0.8 + r3 * 0.5, 0x6a8a3a); }
      if (b === BIOME.DESERT && t === T.SAND && r3 < 0.025 * dens && !hasNode) { const px = jx(), pz = jz(); put('cactus', px, pz, gh(px, pz), r1 * 6, 0.7 + r2 * 0.6, 0x4a7a3a); }
      if (t === T.SAND) { if (r2 < 0.08 * dens) { const px = jx(), pz = jz(); put('rock', px, pz, gh(px, pz), r3 * 6, 0.6 + r1, 0xa09a90); } continue; }
      const grassP = ({ [BIOME.MEADOW]: 0.95, [BIOME.FOREST]: 0.75, [BIOME.HIGHLANDS]: 0.6, [BIOME.BADLANDS]: 0.35, [BIOME.MARSH]: 0.9, [BIOME.DESERT]: 0.12, [BIOME.TAIGA]: 0.4, [BIOME.ISLES]: 0.85 }[b] || 0) * dens * (hasNode ? 0.5 : 1);
      const tufts = r1 < grassP ? (r2 < 0.5 ? 2 : 1) : 0;
      const snowy = b !== BIOME.TAIGA && snowyAt(x, y);
      const grassC = snowy ? 0xb8c8c0 : tileH[i] > 1.6 ? 0x8a9a6a : SEASON_GRASS[seasonIdx()] && b !== BIOME.DESERT && b !== BIOME.BADLANDS ? SEASON_GRASS[seasonIdx()] : BIOME_GRASS[b];
      for (let k = 0; k < tufts; k++) { const px = jx(), pz = jz(); put('tuft', px, pz, gh(px, pz), Math.random() * 6, 0.5 + Math.random() * 0.4, grassC); }
      if (hasNode) continue;
      if (snowy) { if (r3 < 0.5 * dens) { const px = jx(), pz = jz(); put('snow', px, pz, gh(px, pz) - 0.02, r1 * 6, 0.8 + r2, 0xf2f8fc); } continue; }
      // After the thaw, spring flowers everywhere.
      if (winterLevel() < 0 && b !== BIOME.DESERT && r3 > 0.9 - 0.1 * dens) {
        const c = FLOWER_COLORS[Math.floor(r1 * FLOWER_COLORS.length)];
        for (let k = 0; k < 3; k++) { const px = jx(), pz = jz(); put('flower', px, pz, gh(px, pz), 0, 0.8 + Math.random() * 0.5, c); }
      }
      if (b === BIOME.TAIGA && r3 < 0.3 * dens) { const px = jx(), pz = jz(); put('snow', px, pz, gh(px, pz) - 0.02, r1 * 6, 0.7 + r2 * 0.9, 0xf2f8fc); }
      if (b === BIOME.MARSH && r3 > 0.9 - 0.06 * dens) { const px = jx(), pz = jz(); put('mushroom', px, pz, gh(px, pz), 0, 0.8 + r1, r2 < 0.5 ? 0xa8b04a : 0x8a7a5a); }
      if (b === BIOME.ISLES && r3 < 0.06 * dens) { const c = FLOWER_COLORS[Math.floor(r2 * FLOWER_COLORS.length)]; const px = jx(), pz = jz(); put('flower', px, pz, gh(px, pz), 0, 1, c); }
      if ((b === BIOME.MEADOW && r3 < 0.13 * dens) || (b === BIOME.HIGHLANDS && r3 < 0.05 * dens)) {
        const c = FLOWER_COLORS[Math.floor(r2 * FLOWER_COLORS.length)];
        for (let k = 0; k < 3; k++) { const px = jx(), pz = jz(); put('flower', px, pz, gh(px, pz), 0, 0.8 + Math.random() * 0.5, c); }
      }
      if (b === BIOME.FOREST && r3 > 0.94 - 0.05 * dens) { const px = jx(), pz = jz(); put('mushroom', px, pz, gh(px, pz), 0, 0.8 + r1, r2 < 0.5 ? 0xd03a2a : 0xa07a4a); }
      if (r2 > 0.97 - (b === BIOME.HIGHLANDS || b === BIOME.BADLANDS ? 0.07 : 0.025) * dens) { const px = jx(), pz = jz(); put('rock', px, pz, gh(px, pz), r1 * 6, 0.6 + r3 * 1.2, 0x8a857c); }
      if (b === BIOME.FOREST && r1 > 0.988) put('log', x, y, tileH[i], r2 * 6, 0.9 + r3 * 0.3, 0x6e4a2a);
    }
    for (const k in clutter) { clutter[k].instanceMatrix.needsUpdate = true; clutter[k].instanceColor.needsUpdate = true; }
  }

  // ------------------------------------------------------------ wildlife
  function spawnCritter(kind) {
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * Math.PI * 2, d = 18 + Math.random() * 22;
      const x = Math.round(player.vx + Math.cos(a) * d), y = Math.round(player.vz + Math.sin(a) * d);
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue;
      const i = idx(x, y);
      if (terrain[i] !== T.GRASS || nodes.has(i) || townAt(x, y, 6)) continue;
      const b = biome[i];
      if (kind === 'rabbit' && b !== BIOME.MEADOW && b !== BIOME.HIGHLANDS) continue;
      if (kind === 'deer' && (b === BIOME.BADLANDS || b === BIOME.DESERT || b === BIOME.MARSH || b === BIOME.ISLES)) continue;
      const m = animal(kind);
      const c = { kind, a: m, x, z: y, tx: x, tz: y, pause: Math.random() * 3, speed: kind === 'deer' ? 1.3 : 1.6, flee: 0 };
      m.g.position.set(x, gh(x, y), y);
      scene.add(m.g);
      critters.push(c);
      return;
    }
  }
  function critterOk(x, z) {
    const tx = Math.round(x), ty = Math.round(z);
    if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return false;
    const i = idx(tx, ty), n = nodes.get(i);
    return WALKABLE.has(terrain[i]) && terrain[i] !== T.FLOOR && !townBlocks.has(i) && !structIndex.has(i) && !(n && n.until <= Date.now() && RESOURCES[n.res].skill && RESOURCES[n.res].skill !== 'fishing');
  }
  function updateCritters(dt, t) {
    const want = { deer: Math.round(7 * Q.wildlife), rabbit: Math.round(9 * Q.wildlife) };
    for (const kind in want) {
      const have = critters.filter(c => c.kind === kind).length;
      if (have < want[kind] && Math.random() < 0.05) spawnCritter(kind);
    }
    for (let k = critters.length - 1; k >= 0; k--) {
      const c = critters[k];
      const pd = Math.hypot(c.x - player.vx, c.z - player.vz);
      if (pd > 60) { scene.remove(c.a.g); critters.splice(k, 1); continue; }
      if (pd < 6 && c.flee <= 0) {
        c.flee = 3;
        const ax = (c.x - player.vx) / (pd || 1), az = (c.z - player.vz) / (pd || 1);
        c.tx = c.x + ax * 10; c.tz = c.z + az * 10; c.pause = 0;
      }
      if (c.flee > 0) c.flee -= dt;
      if (c.pause > 0) { c.pause -= dt; animateLimbs(c.a, false, false, dt, t); c.a.inner.rotation.x = c.kind === 'deer' ? 0.25 : 0; continue; }
      c.a.inner.rotation.x = 0;
      const dx = c.tx - c.x, dz = c.tz - c.z, d = Math.hypot(dx, dz);
      if (d < 0.2) {
        c.pause = 1 + Math.random() * 5;
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 5;
        c.tx = c.x + Math.cos(a) * r; c.tz = c.z + Math.sin(a) * r;
        continue;
      }
      const sp = (c.flee > 0 ? 4.5 : c.speed) * dt, nx = c.x + dx / d * sp, nz = c.z + dz / d * sp;
      if (!critterOk(nx, nz)) { c.tx = c.x; c.tz = c.z; continue; }
      c.x = nx; c.z = nz;
      c.a.rot = lerpAngle(c.a.rot || 0, Math.atan2(dx, dz), Math.min(1, dt * 8));
      c.a.g.rotation.y = c.a.rot;
      c.a.g.position.set(c.x, gh(c.x, c.z), c.z);
      if (c.a.hop) c.a.inner.position.y = Math.abs(Math.sin(t * (c.flee > 0 ? 18 : 11))) * 0.18;
      else animateLimbs(c.a, true, false, dt, t, c.flee > 0 ? 16 : 7);
    }
  }

  function bird() {
    const g = new C.Group(), body = box(0.12, 0.08, 0.3, 0x2a2a30, 0, 0, 0);
    const wl = new C.Group(), wr = new C.Group();
    wl.add(box(0.45, 0.02, 0.16, 0x3a3a40, -0.22, 0, 0)); wr.add(box(0.45, 0.02, 0.16, 0x3a3a40, 0.22, 0, 0));
    g.add(body, wl, wr);
    return { g, wl, wr };
  }
  function updateBirds(dt, t, day) {
    const want = Math.round(3 * Q.wildlife);
    while (flocks.length < want) {
      const f = { cx: player.vx + (Math.random() - 0.5) * 60, cz: player.vz + (Math.random() - 0.5) * 60, h: 14 + Math.random() * 8, r: 6 + Math.random() * 8, sp: 0.3 + Math.random() * 0.3, dir: Math.random() * 6, birds: [] };
      for (let k = 0; k < 5 + Math.floor(Math.random() * 4); k++) { const b = bird(); b.off = [Math.random() * 3, Math.random() * 2, Math.random() * 3]; b.ph = Math.random() * 6; scene.add(b.g); f.birds.push(b); }
      flocks.push(f);
    }
    for (const f of flocks) {
      f.cx += Math.cos(f.dir) * dt * 2; f.cz += Math.sin(f.dir) * dt * 2;
      if (Math.hypot(f.cx - player.vx, f.cz - player.vz) > 70) { f.cx = player.vx - Math.cos(f.dir) * 50; f.cz = player.vz - Math.sin(f.dir) * 50; }
      const a = t * f.sp;
      for (const b of f.birds) {
        b.g.visible = day > 0.2;
        const x = f.cx + Math.cos(a + b.off[0]) * f.r + b.off[2], z = f.cz + Math.sin(a + b.off[0]) * f.r;
        b.g.position.set(x, Math.max(f.h, gh(x, z) + 8) + b.off[1] + Math.sin(t + b.ph) * 0.4, z);
        b.g.rotation.y = -(a + b.off[0]);
        const flap = Math.sin(t * 9 + b.ph) * 0.6;
        b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
      }
    }
  }

  let fishJump = null;
  function updateFish(dt, now) {
    if (!fishJump && Math.random() < dt * 0.25 && fishSlots.length) {
      const f = fishSlots[Math.floor(Math.random() * fishSlots.length)];
      if (Math.hypot(f.x - player.vx, f.y - player.vz) < 30) {
        const m = box(0.08, 0.12, 0.35, 0x8ab0c0, 0, 0, 0);
        scene.add(m);
        fishJump = { m, x: f.x + (Math.random() - 0.5), z: f.y + (Math.random() - 0.5), t: 0, dir: Math.random() * 6 };
      }
    }
    if (fishJump) {
      const j = fishJump;
      j.t += dt;
      const p = j.t / 0.8;
      j.m.position.set(j.x + Math.cos(j.dir) * p * 0.8, Math.sin(p * Math.PI) * 0.7 - 0.05, j.z + Math.sin(j.dir) * p * 0.8);
      j.m.rotation.set(-Math.cos(p * Math.PI) * 1.2, j.dir, 0);
      if (p >= 1) { scene.remove(j.m); fishJump = null; }
    }
  }

  // ------------------------------------------------------------ sky: sun, moon, stars, clouds, rain
  function buildSky() {
    const n = 1500, pos = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      pos.set([Math.cos(th) * r * 250, Math.abs(u) * 250 + 10, Math.sin(th) * r * 250], k * 3);
    }
    const sg = new C.BufferGeometry();
    sg.setAttribute('position', new C.BufferAttribute(pos, 3));
    stars = new C.Points(sg, new C.PointsMaterial({ color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    scene.add(stars);
    for (let k = 0; k < 16; k++) {
      const g = new C.Group(), m = new C.MeshLambertMaterial({ color: 0xffffff, fog: false, flatShading: true });
      for (let j = 0; j < 4 + Math.floor(Math.random() * 3); j++) {
        const c = new C.Mesh(geo('IcosahedronGeometry', 3, 0), m);
        c.position.set(j * 3.5 - 6, Math.random() * 1.5, (Math.random() - 0.5) * 4);
        c.scale.set(1 + Math.random(), 0.55 + Math.random() * 0.3, 1 + Math.random() * 0.5);
        g.add(c);
      }
      g.userData.off = [(Math.random() - 0.5) * 240, 42 + Math.random() * 14, (Math.random() - 0.5) * 240];
      g.userData.mat = m;
      scene.add(g);
      clouds.push(g);
    }
    const rn = 1400, rp = new Float32Array(rn * 6);
    const rg = new C.BufferGeometry();
    rg.setAttribute('position', new C.BufferAttribute(rp, 3));
    rain = new C.LineSegments(rg, new C.LineBasicMaterial({ color: 0xaabbd0, transparent: true, opacity: 0.45, fog: false }));
    rain.userData.drops = Array.from({ length: rn }, () => [Math.random() * 50 - 25, Math.random() * 30, Math.random() * 50 - 25]);
    rain.frustumCulled = false;
    scene.add(rain);
  }

  const cA = new C.Color(), cB = new C.Color();
  function updateSky(dt, t, camPos) {
    const day = daylight(), time = state.time;
    const w = state.weather.kind;
    rainAmt += ((w === 'rain' ? 1 : 0) - rainAmt) * Math.min(1, dt * 0.6);
    fogAmt += ((w === 'fog' ? 1 : 0) - fogAmt) * Math.min(1, dt * 0.2);
    cloudAmt += ((w === 'clear' ? 0.25 : 1) - cloudAmt) * Math.min(1, dt * 0.2);
    const gloom = Math.max(rainAmt * 0.7, fogAmt * 0.4, (cloudAmt - 0.25) * 0.3);
    // Underground the sky goes black and only torches and your lantern light the way.
    const below = inDungeonRect(Math.round(player.vx), Math.round(player.vz)) ? 1 : 0;
    underAmt = Math.abs(below - underAmt) > 0.5 ? below : underAmt + (below - underAmt) * Math.min(1, dt * 3);
    // Sky colour: night blue, day blue, with warm dawn and dusk and grey weather.
    const dusk = Math.max(0, 1 - Math.abs(time - 0.25) / 0.05) + Math.max(0, 1 - Math.abs(time - 0.75) / 0.05);
    cA.setHex(0x0c1630).lerp(cB.setHex(SKY), day);
    cA.lerp(cB.setHex(0xf09a6a), Math.min(1, dusk) * 0.55);
    cA.lerp(cB.setHex(day > 0.3 ? 0x8a96a2 : 0x1a2028), gloom);
    cA.lerp(cB.setHex(0x060508), underAmt);
    scene.background.copy(cA);
    scene.fog.color.copy(cA);
    // Sun by day, a pale moon by night.
    const a = (time - 0.25) * Math.PI * 2, up = Math.sin(a);
    const dir = up > -0.05 ? [-Math.cos(a), Math.max(0.15, up), 0.35] : [Math.cos(a), Math.max(0.2, -up), -0.3];
    sun.position.set(camPos.x + dir[0] * 40, camPos.y + dir[1] * 40, camPos.z + dir[2] * 40);
    sun.color.setHex(up > -0.05 ? 0xfff1d6 : 0x9ab0ff).lerp(cB.setHex(0xffa060), Math.min(1, dusk) * 0.6);
    sun.intensity = (up > -0.05 ? 0.2 + 0.55 * day : 0.22) * (1 - gloom * 0.5);
    sun.intensity *= 1 - underAmt * 0.9;
    hemi.intensity = (0.18 + 0.38 * day) * (1 - underAmt * 0.55);
    hemi.color.setHex(0x6a7ab8).lerp(cB.setHex(0xdfefff), day);
    stars.material.opacity = clamp(1 - day * 1.6, 0, 1) * (1 - cloudAmt * 0.7);
    stars.position.copy(camPos);
    lantern.intensity = Math.max(clamp(1 - day * 1.5, 0, 1) * 1.3, underAmt * 1.6);
    lantern.distance = 11 + underAmt * 5;
    windowMat.emissiveIntensity = clamp(1.2 - day * 1.6, 0, 1);
    const night = Math.max(clamp(1 - day * 1.5, 0, 1), underAmt);
    stars.visible = underAmt < 0.5;
    for (const gl of glows) gl.sp.material.opacity = gl.nightOnly ? night * 0.9 : 0.35 + night * 0.55;
    for (const c of clouds) {
      c.userData.off[0] += dt * 1.5;
      if (c.userData.off[0] > 120) c.userData.off[0] -= 240;
      c.position.set(camPos.x + c.userData.off[0], c.userData.off[1], camPos.z + c.userData.off[2]);
      c.visible = underAmt < 0.5 && c.id % 4 < Math.round(cloudAmt * 4);
      c.userData.mat.color.setHex(0xffffff).lerp(cB.setHex(0x6a7280), gloom).multiplyScalar(0.35 + 0.65 * day);
    }
    rain.visible = rainAmt > 0.02 && underAmt < 0.5;
    const snowing = snowyAt(camPos.x, camPos.z) || seasonIdx() === 3 || biome[idx(Math.round(camPos.x), Math.round(camPos.z))] === BIOME.TAIGA;
    waterMesh.visible = underAmt < 0.5;
    if (rain.visible) {
      const arr = rain.geometry.attributes.position.array, drops = rain.userData.drops;
      for (let k = 0; k < drops.length; k++) {
        const d = drops[k];
        d[1] -= dt * (snowing ? 4 : 28);
        if (d[1] < -2) { d[1] = 28; d[0] = Math.random() * 50 - 25; d[2] = Math.random() * 50 - 25; }
        const x = camPos.x + d[0] + (snowing ? Math.sin(t + k) * 0.4 : 0), y = camPos.y - 8 + d[1], z = camPos.z + d[2];
        arr.set(snowing ? [x, y, z, x + 0.08, y - 0.08, z] : [x, y, z, x + 0.05, y - 0.6, z], k * 6);
      }
      rain.geometry.attributes.position.needsUpdate = true;
      rain.material.color.setHex(snowing ? 0xffffff : 0xaabbd0);
      rain.material.opacity = (snowing ? 0.9 : 0.45) * rainAmt;
    }
    return gloom;
  }

  // ------------------------------------------------------------ your pet follows you around
  let petObj = null, shownSeason = -1;
  function updatePet(dt, t) {
    const kind = petKind();
    if (!kind) { if (petObj) { scene.remove(petObj.a.g); petObj = null; } return; }
    if (!petObj || petObj.kind !== kind) {
      if (petObj) scene.remove(petObj.a.g);
      const a = kind === 'wolf' ? wolf() : animal(kind);
      if (kind === 'wolf') a.inner.scale.setScalar(0.75);
      petObj = { kind, a, x: state.px - 1, z: state.py - 1 };
      scene.add(a.g);
    }
    const p = petObj, a = p.a;
    // Trail a little behind and to the side, and catch up if you get away.
    const tx = state.px - Math.sin(state.face) * 1.3 + Math.cos(state.face) * 0.6, tz = state.py - Math.cos(state.face) * 1.3 - Math.sin(state.face) * 0.6;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 12) { p.x = tx; p.z = tz; }
    const mov = d > 0.4;
    if (mov) { const sp = Math.min(d, (d > 3 ? 9 : 4.5) * dt); p.x += dx / d * sp; p.z += dz / d * sp; a.rot = lerpAngle(a.rot || 0, Math.atan2(dx, dz), Math.min(1, dt * 8)); }
    a.g.position.set(p.x, Math.max(gh(p.x, p.z), state.sailing ? 0.1 : -9), p.z);
    a.g.visible = !state.sailing;
    a.g.rotation.y = a.rot || 0;
    animateLimbs(a, mov, false, dt, t, 14);
  }

  // ------------------------------------------------------------ caravans on the road, and the people of your town
  const wagonObjs = new Map();
  function updateCaravans(dt, t) {
    const live = new Set();
    for (const c of state.caravans) {
      if (c.phase === 'idle') continue;
      const post = structById(c.post), route = post && caravanRoute(post, c.town);
      if (!route) continue;
      const f = c.phase === 'out' ? c.t : 1 - c.t, p = routePoint(route, f);
      const near = Math.abs(p.x - player.vx) < 70 && Math.abs(p.y - player.vz) < 70;
      let o = wagonObjs.get(c.id);
      if (!near) { if (o) o.g.visible = false; if (o) live.add(c.id); continue; }
      if (!o || o.guards !== c.guards) { if (o) scene.remove(o.g); o = { g: caravanModel(c.guards), guards: c.guards, rot: 0 }; scene.add(o.g); wagonObjs.set(c.id, o); }
      live.add(c.id);
      o.g.visible = true;
      const dir = c.phase === 'out' ? 1 : -1;
      if (p.dx || p.dy) o.rot = lerpAngle(o.rot, Math.atan2(p.dx * dir, p.dy * dir), Math.min(1, dt * 4));
      o.g.position.set(p.x, gh(p.x, p.y) + Math.abs(Math.sin(t * 6)) * 0.03, p.y);
      o.g.rotation.y = o.rot;
      for (const a of o.g.userData.walkers || []) animateLimbs(a, true, false, dt, t, 9);
      o.g.userData.horse.position.y = Math.abs(Math.sin(t * 7)) * 0.04;
    }
    for (const [id, o] of wagonObjs) if (!live.has(id)) { scene.remove(o.g); wagonObjs.delete(id); }
  }

  // Once your town is founded, settlers stroll between your buildings.
  const myFolk = [];
  function updateMyTown(dt, t) {
    const hall = state.myTown && structById(state.myTown.hall);
    const want = hall ? Math.min(14, 3 + staffCount()) : 0;
    while (myFolk.length > want) scene.remove(myFolk.pop().a.g);
    if (!hall) return;
    const c = structCenter(hall);
    if (Math.hypot(c.x - player.vx, c.y - player.vz) > 70) return;
    const folkColors = [0x3a6a9e, 0x9e5a3a, 0x5a8a3a, 0x8a3a6a, 0xc0a040, 0x6a4a8a, 0x2a7a7a];
    const okTile = (x, y) => { const i = idx(Math.round(x), Math.round(y)); return WALKABLE.has(terrain[i]) && !structIndex.has(i) && !nodes.has(i); };
    const pickSpot = () => {
      const ss = state.structs.filter(s => s.level);
      for (let k = 0; k < 20; k++) {
        const s = ss[Math.floor(Math.random() * ss.length)], sc = structCenter(s), sz = structSize(s);
        const x = sc.x + (Math.random() - 0.5) * (sz + 4), y = sc.y + (Math.random() - 0.5) * (sz + 4);
        if (Math.hypot(x - c.x, y - c.y) < 22 && okTile(x, y)) return [x, y];
      }
      return [c.x, c.y + 2.5];
    };
    while (myFolk.length < want) {
      const a = townsfolk(folkColors[myFolk.length % folkColors.length]);
      const [x, y] = pickSpot();
      const w = { a, x, z: y, tx: x, tz: y, pause: Math.random() * 3, speed: 1.1 + Math.random() * 0.4, idle: () => 1 + Math.random() * 4 };
      w.pick = () => { const [nx, ny] = pickSpot(); w.tx = nx; w.tz = ny; };
      scene.add(a.g); myFolk.push(w);
    }
    for (const w of myFolk) wander(w, dt, t);
  }

  // ------------------------------------------------------------ your settlement: workers hauling goods
  function updateCarriers(dt, t) {
    const stores = state.structs.filter(s => s.type === 'storehouse' && s.level);
    const live = new Set();
    if (stores.length) {
      for (const s of state.structs) {
        const def = STRUCTS[s.type];
        if (!s.level || !s.workers || !(def.gather || def.station) || s.type === 'storehouse') continue;
        const c = structCenter(s);
        let best = stores[0], bd = Infinity;
        for (const st of stores) { const sc = structCenter(st), d = Math.hypot(sc.x - c.x, sc.y - c.y); if (d < bd) { bd = d; best = st; } }
        if (bd > 40) continue;
        const sc = structCenter(best);
        for (let k = 0; k < Math.min(s.workers, 2); k++) {
          const key = `${s.id}:${k}`;
          live.add(key);
          let w = carriers.get(key);
          if (!w) {
            const a = humanoid({ tunic: 0x8a6a3a, skin: 0xd9a77a, legs: 0x4a3a2a, scale: 0.7 });
            const color = def.gather ? { woodcutting: 0x8a6338, mining: 0x8a8580, fishing: 0x8ab0c0 }[def.gather] : 0xb08850;
            a.load = box(0.3, 0.22, 0.25, color, 0, 0.05, 0.2);
            a.hand.add(a.load);
            scene.add(a.g);
            w = { a, p: k * 0.5, from: null, to: null };
            carriers.set(key, w);
          }
          // Walk out and back: p in [0,1) out to the storehouse, [1,2) back.
          const dist = Math.max(1, Math.hypot(sc.x - c.x, sc.y - c.y));
          if (s.damaged > 0 || state.unpaid) { w.a.g.visible = false; continue; }
          w.a.g.visible = true;
          w.p = (w.p + dt * 1.1 / dist) % 2;
          const out = w.p < 1, f = out ? w.p : 2 - w.p;
          const ex = 0.9 + (k ? 0.4 : 0);
          const x = c.x + (sc.x - c.x) * f + (k ? 0.4 : -0.4), z = c.y + (sc.y - c.y) * f + (k ? 0.3 : 0);
          w.a.g.position.set(x, gh(x, z), z);
          w.a.g.rotation.y = Math.atan2((sc.x - c.x) * (out ? 1 : -1), (sc.y - c.y) * (out ? 1 : -1));
          w.a.load.visible = def.gather ? out : !out;
          animateLimbs(w.a, true, false, dt, t, 9 * ex);
          w.a.armR.rotation.x = w.a.load.visible ? -1.1 : w.a.armR.rotation.x;
        }
      }
    }
    for (const [key, w] of carriers) if (!live.has(key)) { scene.remove(w.a.g); carriers.delete(key); }
  }

  function setQuality(name) {
    Q = QUALITY[name] || QUALITY.medium;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixel));
    renderer.shadowMap.enabled = Q.shadows;
    sun.castShadow = Q.shadows;
    sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); });
    clutterX = -999;
    resize();
  }

  // ------------------------------------------------------------ player structures
  let previewing = false; // the build preview gets no smoke or flames
  function addSmoke(group, x, y, z) {
    if (previewing) return;
    for (let k = 0; k < 5; k++) {
      const p = mesh(geo('IcosahedronGeometry', 0.14, 0), new C.MeshLambertMaterial({ color: 0xb8b8b8, transparent: true, opacity: 0.6 }), x, y, z, false);
      p.userData.noBake = true;
      smoke.push({ p, x, y, z, phase: k / 5, group });
      group.add(p);
    }
  }
  function flame(group, x, y, z, s = 1) {
    if (previewing) return;
    const f = mesh(geo('ConeGeometry', 0.17 * s, 0.45 * s, 6), glow(0xffa22a), x, y, z, false);
    f.userData.seed = Math.random() * 10;
    f.userData.noBake = true;
    flames.push(f);
    group.add(f);
  }

  // Your buildings. Each takes (group, struct) and grows with struct.level; size is the footprint in tiles.
  const lv = s => Math.max(1, s.level || 1);
  const STRUCT_MODELS = {
    workbench: (g, s) => {
      g.add(box(1.0, 0.1, 0.55, 0x9a7444, 0, 0.62, 0));
      for (const [x, z] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.2], [0.42, 0.2]]) g.add(box(0.08, 0.62, 0.08, 0x6b4a2b, x, 0.31, z));
      g.add(box(0.9, 0.06, 0.45, 0x8a6338, 0, 0.18, 0), box(0.16, 0.12, 0.14, 0x55555c, -0.38, 0.73, 0.1), box(0.3, 0.06, 0.12, 0x55555c, -0.1, 0.7, 0));
      g.add(box(0.06, 0.06, 0.3, 0x6b4a2b, 0.25, 0.7, 0.05), box(0.4, 0.05, 0.1, 0xb08850, 0.2, 0.68, -0.15));
      if (lv(s) >= 2) { g.add(box(0.9, 0.7, 0.06, 0x7a5232, 0, 1.0, -0.3)); for (let k = 0; k < 3; k++) g.add(box(0.05, 0.3, 0.05, 0x55555c, -0.3 + k * 0.3, 1.1, -0.26)); }
      if (lv(s) >= 3) { for (const x of [-0.5, 0.5]) g.add(box(0.08, 1.8, 0.08, 0x6b4a2b, x, 0.9, -0.35)); const rf = box(1.3, 0.08, 0.9, 0x5a3a20, 0, 1.8, -0.05); rf.rotation.x = 0.25; g.add(rf); }
    },
    campfire: (g, s) => {
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.add(mesh(geo('DodecahedronGeometry', 0.11, 0), mat(0x77726b), Math.cos(a) * 0.34, 0.07, Math.sin(a) * 0.34)); }
      const l1 = cyl(0.05, 0.05, 0.5, 0x5a3a1e, 0, 0.08, 0, 5), l2 = l1.clone();
      l1.rotation.z = Math.PI / 2; l2.rotation.x = Math.PI / 2;
      g.add(l1, l2);
      flame(g, 0, 0.3, 0);
      addSmoke(g, 0, 0.6, 0);
      if (!previewing) { const gl = glowSprite(0xff9a3a, 2.6, false); gl.position.y = 0.4; g.add(gl); }
      const seat = cyl(0.14, 0.14, 0.9, 0x7a5432, 0, 0.14, 0.75, 6); seat.rotation.z = Math.PI / 2; g.add(seat);
      if (lv(s) >= 2) { for (const x of [-0.45, 0.45]) { g.add(box(0.05, 0.75, 0.05, 0x5a3a1e, x, 0.38, 0)); } g.add(box(0.95, 0.04, 0.04, 0x3a2a1a, 0, 0.72, 0), box(0.1, 0.06, 0.28, 0xc88a42, 0.1, 0.66, 0)); }
      if (lv(s) >= 3) {
        g.add(box(0.06, 1.4, 0.06, 0x5a3a1e, -0.6, 0.7, -0.6), box(0.06, 1.4, 0.06, 0x5a3a1e, 0.6, 0.7, -0.6), box(1.25, 0.05, 0.05, 0x5a3a1e, 0, 1.3, -0.6));
        for (let k = 0; k < 4; k++) g.add(box(0.08, 0.25, 0.04, 0xc88a42, -0.4 + k * 0.27, 1.12, -0.6));
      }
    },
    sawbench: (g, s) => {
      g.add(box(1.1, 0.08, 0.45, 0x8a6338, 0, 0.55, 0));
      for (const [x, z] of [[-0.45, -0.17], [0.45, -0.17], [-0.45, 0.17], [0.45, 0.17]]) g.add(box(0.07, 0.55, 0.07, 0x6b4a2b, x, 0.27, z));
      const log = cyl(0.14, 0.14, 1.0, 0xa07a4a, 0, 0.72, 0, 7); log.rotation.z = Math.PI / 2;
      g.add(log, box(0.02, 0.32, 0.45, 0xc8ccd2, 0.15, 0.85, 0), box(0.3, 0.08, 0.06, 0x6b4a2b, 0.15, 1.04, 0));
      for (let k = 0; k < (lv(s) >= 2 ? 6 : 3); k++) g.add(box(0.9, 0.06, 0.16, 0xd9b17a, -0.05, 0.04 + Math.floor(k / 3) * 0.07, 0.42 + (k % 3) * 0.17));
      if (lv(s) >= 2) { for (const [x, z] of [[-0.55, -0.45], [0.55, -0.45]]) g.add(box(0.08, 1.7, 0.08, 0x6b4a2b, x, 0.85, z)); const rf = box(1.4, 0.07, 1.0, 0x6b4a2b, 0, 1.75, -0.1); rf.rotation.x = 0.3; g.add(rf); }
      if (lv(s) >= 3) { const wheel = cyl(0.45, 0.45, 0.08, 0x5a3a20, -0.62, 0.55, 0.3, 10); wheel.rotation.z = Math.PI / 2; g.add(wheel); for (let k = 0; k < 4; k++) { const sp = box(0.04, 0.85, 0.04, 0x3a2a1a, -0.62, 0.55, 0.3); sp.rotation.x = k * Math.PI / 4; g.add(sp); } }
    },
    furnace: (g, s) => {
      const L = lv(s), h = 0.85 + (L - 1) * 0.25;
      g.add(box(0.95, h, 0.85, 0x5f5953, 0, h / 2, 0), box(0.75, 0.2, 0.65, 0x6a645e, 0, h + 0.1, 0));
      g.add(mesh(geo('BoxGeometry', 0.4, 0.3, 0.04), glow(0xff7a1a), 0, 0.3, 0.43, false), box(0.5, 0.06, 0.08, 0x3a3530, 0, 0.48, 0.44));
      g.add(cyl(0.14, 0.17, 0.9 + L * 0.3, 0x4c4741, 0.2, h + 0.4 + L * 0.15, -0.2, 6));
      addSmoke(g, 0.2, h + 0.9 + L * 0.3, -0.2);
      if (!previewing) { const gl = glowSprite(0xff7a1a, 1.8, false); gl.position.set(0, 0.35, 0.6); g.add(gl); }
      if (L >= 2) { g.add(box(0.3, 0.25, 0.45, 0x7a5232, 0.62, 0.3, 0.1)); const nz = cone(0.06, 0.25, 0x3a3530, 0.5, 0.3, 0.1, 5); nz.rotation.z = Math.PI / 2; g.add(nz); }
      if (L >= 3) { g.add(cone(0.35, 0.35, 0x1a1a1c, -0.6, 0.17, 0.3, 6)); for (let k = 0; k < 3; k++) g.add(box(0.22, 0.07, 0.1, 0xc77a3a, -0.55, 0.04 + k * 0.08, -0.3)); }
    },
    anvil: (g, s) => {
      g.add(cyl(0.25, 0.28, 0.4, 0x6b4a2b, 0, 0.2, 0, 7), box(0.2, 0.15, 0.2, 0x3a3a40, 0, 0.47, 0), box(0.5, 0.14, 0.22, 0x45454c, 0, 0.6, 0));
      const horn = cone(0.07, 0.22, 0x45454c, 0.34, 0.6, 0, 5); horn.rotation.z = -Math.PI / 2; g.add(horn);
      g.add(cyl(0.22, 0.22, 0.5, 0x5a3a20, 0.6, 0.25, 0.35, 7), cyl(0.2, 0.2, 0.02, 0x2a4a6a, 0.6, 0.49, 0.35, 7));
      if (lv(s) >= 2) {
        g.add(box(0.7, 0.6, 0.6, 0x6a645e, -0.65, 0.3, -0.2), mesh(geo('BoxGeometry', 0.45, 0.08, 0.4), glow(0xff6a1a), -0.65, 0.62, -0.2, false));
        if (!previewing) { const gl = glowSprite(0xff6a1a, 1.4, false); gl.position.set(-0.65, 0.75, -0.2); g.add(gl); }
      }
      if (lv(s) >= 3) {
        for (const [x, z] of [[-1, -0.6], [1, -0.6], [-1, 0.6], [1, 0.6]]) g.add(box(0.09, 2.0, 0.09, 0x6b4a2b, x * 0.95, 1.0, z));
        roof(g, 2.1, 1.4, 0.55, 2.0, 0x6b4a2b, null, { over: 0.1 });
        for (let k = 0; k < 3; k++) { const sw = box(0.04, 0.5, 0.04, 0xc8ccd2, -0.3 + k * 0.2, 1.3, -0.62); g.add(sw); }
      }
    },
    storehouse: (g, s) => {
      const S = structSize(s) - 0.3, L = lv(s), wh = 1.7 + (L - 1) * 0.4;
      g.add(box(S, 0.2, S - 0.2, 0x7a746a, 0, 0.1, 0), box(S - 0.1, wh, S - 0.4, 0x9a7444, 0, 0.2 + wh / 2, 0));
      for (let k = 0; k < 7; k++) g.add(box(0.06, wh, 0.05, 0x7a5432, -S / 2 + 0.2 + k * (S - 0.4) / 6, 0.2 + wh / 2, (S - 0.4) / 2 + 0.02));
      roof(g, S - 0.1, S - 0.4, 1.0 + L * 0.15, 0.2 + wh, 0x6b3a2a, 0x9a7444, { over: 0.25, thick: 0.14 });
      g.add(box(1.0, 1.25, 0.06, 0x5a3a20, 0, 0.83, (S - 0.4) / 2 + 0.05));
      for (const sx of [-1, 1]) { const brace = box(0.06, 1.3, 0.04, 0x3a2614, sx * 0.25, 0.83, (S - 0.4) / 2 + 0.09); brace.rotation.z = sx * 0.6; g.add(brace); }
      g.add(box(0.45, 0.45, 0.45, 0xb08850, S / 2 + 0.1, 0.23, S / 2 - 0.6), box(0.38, 0.38, 0.38, 0xa07a40, S / 2 + 0.12, 0.65, S / 2 - 0.6), cyl(0.22, 0.22, 0.5, 0x7a5232, -S / 2 - 0.05, 0.25, S / 2 - 0.5, 8));
      if (L >= 2) { win(g, 0, 0.2 + wh + 0.45, (S - 0.4) / 2 + 0.02, 0, { w: 0.5, h: 0.5 }); g.add(box(0.12, 0.12, 0.9, 0x6b4a2b, 0, 0.2 + wh + 1.0, (S - 0.4) / 2 + 0.35)); g.add(cyl(0.015, 0.015, 1.2, 0xc8b890, 0, 0.2 + wh + 0.4, (S - 0.4) / 2 + 0.75, 4)); }
      if (L >= 3) { g.add(box(1.0, 1.4, S - 0.8, 0x8a6a40, -S / 2 - 0.45, 0.7, 0)); const lt = box(1.3, 0.08, S - 0.5, 0x6b3a2a, -S / 2 - 0.45, 1.5, 0); lt.rotation.z = 0.35; g.add(lt); }
    },
    house: (g, s) => {
      const S = structSize(s), L = lv(s), w = S - 0.7, d = S - 0.9, wall = 0xe6d6b4, beam = 0x46301c, shut = 0x3a6a3a;
      g.add(box(w + 0.12, 0.3, d + 0.12, 0x7a746a, 0, 0.15, 0), box(w, 1.5, d, wall, 0, 1.05, 0));
      timbers(g, w, d, 0.3, 1.5, beam, false);
      door(g, d / 2, { color: 0x5a3a20 });
      win(g, -w * 0.32, 1.15, d / 2 + 0.03, 0, { shutter: shut, flowers: true });
      win(g, w * 0.32, 1.15, d / 2 + 0.03, 0, { shutter: shut });
      let top = 1.8, rw = w, rd = d;
      if (L >= 2) {
        rw = w + 0.3; rd = d + 0.3;
        g.add(box(rw, 0.14, rd, beam, 0, top + 0.07, 0), box(rw, 1.3, rd, wall, 0, top + 0.79, 0));
        timbers(g, rw, rd, top + 0.14, 1.3, beam, true);
        win(g, -0.5, top + 0.8, rd / 2 + 0.03, 0, { shutter: shut }); win(g, 0.5, top + 0.8, rd / 2 + 0.03, 0, { shutter: shut });
        top += 1.44;
      }
      roof(g, rw, rd, 1.3, top, 0x8a4a2a, wall, { over: 0.3 });
      g.add(box(0.4, 1.4, 0.4, 0x8a7a6a, w * 0.25, top + 0.85, -d * 0.18));
      addSmoke(g, w * 0.25, top + 1.7, -d * 0.18);
      if (L >= 3) {
        g.add(box(1.0, 1.3, d - 0.4, wall, w / 2 + 0.5, 0.95, -0.1));
        const sr = box(1.3, 0.1, d, 0x8a4a2a, w / 2 + 0.55, 1.75, -0.1); sr.rotation.z = -0.4; g.add(sr);
        for (let k = 0; k < 5; k++) g.add(box(0.06, 0.45, 0.06, 0x8a6a40, -S / 2 + 0.15 + k * (S - 0.3) / 4, 0.22, S / 2 - 0.05));
        g.add(box(S - 0.2, 0.05, 0.05, 0x8a6a40, 0, 0.38, S / 2 - 0.05));
      }
    },
    lumber_camp: (g, s) => {
      const S = structSize(s), L = lv(s);
      const tent = cone(0.85, 1.2, 0xc9b48a, -S / 4, 0.6, -S / 4, 4); tent.rotation.y = Math.PI / 4; g.add(tent);
      for (let k = 0; k < 3 + L * 2; k++) { const l = cyl(0.12, 0.12, 1.1, 0x8a6338, S / 4 + (k % 3 - 1) * 0.26, 0.12 + Math.floor(k / 3) * 0.22, S / 4, 6); l.rotation.x = Math.PI / 2; g.add(l); }
      g.add(cyl(0.22, 0.25, 0.35, 0x7a5a3a, -S / 4, 0.17, S / 4, 7));
      if (L >= 2) { for (const [x, z] of [[0, -S / 2 + 0.3], [S / 2 - 0.3, -S / 2 + 0.3]]) g.add(box(0.1, 1.7, 0.1, 0x6b4a2b, x, 0.85, z)); const rf = box(S / 2 + 0.2, 0.08, 1.0, 0x5a3a20, S / 4 - 0.15, 1.7, -S / 2 + 0.6); rf.rotation.x = -0.25; g.add(rf); }
      if (L >= 3) { const cab = new C.Group(); HOUSES.thornwood(cab, 0.3); cab.scale.setScalar(0.55); cab.position.set(-S / 4, 0, -S / 4); g.remove(tent); g.add(cab); }
    },
    mine: (g, s) => {
      const S = structSize(s), L = lv(s);
      for (let k = 0; k < 6; k++) g.add(mesh(geo('DodecahedronGeometry', 0.7, 0), mat(0x7a746c), -S / 2 + 0.4 + (k % 3) * (S - 0.8) / 2, 0.45 + Math.floor(k / 3) * 0.55, -S / 2 + 0.5 + Math.floor(k / 3) * 0.2));
      g.add(box(1.0, 0.9, 0.3, 0x0e0c0a, 0, 0.55, -S / 2 + 1.05));
      for (const x of [-0.6, 0.6]) g.add(box(0.14, 1.3, 0.14, 0x6b4a2b, x, 0.65, -S / 2 + 1.15));
      g.add(box(1.5, 0.16, 0.18, 0x6b4a2b, 0, 1.3, -S / 2 + 1.15));
      g.add(box(0.5, 0.3, 0.38, 0x55555c, 0.6, 0.25, S / 4), cone(0.3, 0.35, 0xb07a4a, -0.7, 0.17, S / 4, 6));
      if (L >= 2) { for (let k = 0; k < 4; k++) g.add(box(0.8, 0.05, 0.1, 0x5a3a20, 0, 0.03, -S / 2 + 1.4 + k * 0.32)); for (const x of [-0.25, 0.25]) g.add(box(0.05, 0.05, 1.4, 0x55555c, x, 0.08, -S / 2 + 1.9)); g.add(box(0.08, 1.4, 0.08, 0x2a2a2a, 0.95, 0.7, 0)); if (!previewing) { const gl = glowSprite(0xffc870, 1.6); gl.position.set(0.95, 1.4, 0); g.add(gl); } }
      if (L >= 3) { for (const sx of [-1, 1]) { const leg = box(0.12, 2.8, 0.12, 0x6b4a2b, sx * 0.55 + S / 4, 1.35, -0.2); leg.rotation.z = sx * 0.2; g.add(leg); } const wh = cyl(0.45, 0.45, 0.08, 0x4a3220, S / 4, 2.6, -0.2, 12); wh.rotation.x = Math.PI / 2; g.add(wh); }
    },
    dock: (g, s) => {
      const S = structSize(s), L = lv(s);
      // Point the pier at the water.
      let dir = [0, 1];
      if (s.x != null) {
        let best = -1;
        for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          let n = 0;
          for (let k = 0; k < S; k++) {
            const tx = dx ? (dx > 0 ? s.x + S : s.x - 1) : s.x + k, ty = dz ? (dz > 0 ? s.y + S : s.y - 1) : s.y + k;
            if (terrain[idx(tx, ty)] === T.WATER) n++;
          }
          if (n > best) { best = n; dir = [dx, dz]; }
        }
      }
      const pier = new C.Group();
      for (let k = 0; k < 4 + L * 2; k++) pier.add(box(1.1, 0.08, 0.36, 0x8a6338, 0, 0.2, S / 2 - 0.2 + k * 0.38));
      for (let k = 0; k < 2 + L; k++) for (const x of [-0.5, 0.5]) pier.add(cyl(0.07, 0.07, 1.0, 0x5a3a20, x, -0.15, S / 2 + k * 0.75, 5));
      if (L >= 3) { pier.add(box(0.7, 0.25, 1.6, 0x7a5232, 1.1, -0.02, S / 2 + 1.2), box(0.5, 0.08, 1.3, 0x5a3a20, 1.1, 0.12, S / 2 + 1.2)); }
      pier.rotation.y = Math.atan2(dir[0], dir[1]);
      g.add(pier);
      const hut = new C.Group(); HOUSES.saltmere(hut, 0.2); hut.scale.setScalar(L >= 2 ? 0.6 : 0.42); hut.position.set(-dir[0] * 0.4, 0, -dir[1] * 0.4); hut.rotation.y = Math.atan2(dir[0], dir[1]); g.add(hut);
      for (let k = 0; k < 3; k++) g.add(box(0.04, 0.9, 0.04, 0x8a6a3a, S / 2 - 0.3 - k * 0.2, 0.45, -S / 2 + 0.3));
    },
    wall: (g, s) => {
      const L = lv(s);
      if (L === 1) {
        for (let k = 0; k < 4; k++) { const h = 1.7 + (k % 2) * 0.15; g.add(cyl(0.13, 0.14, h, 0x7a5432, -0.375 + k * 0.25, h / 2, 0, 6), cone(0.13, 0.25, 0x6a4a2a, -0.375 + k * 0.25, h + 0.12, 0, 6)); }
        g.add(box(1.02, 0.1, 0.1, 0x5a3a20, 0, 0.6, 0.14), box(1.02, 0.1, 0.1, 0x5a3a20, 0, 1.3, 0.14));
      } else {
        const h = L === 2 ? 2.0 : 2.6, c = L === 2 ? 0x8a857c : 0x9a948a;
        g.add(box(1.02, h, 0.8, c, 0, h / 2, 0), box(1.04, 0.15, 0.84, 0x6a655e, 0, 0.3, 0));
        for (const x of [-0.3, 0.3]) g.add(box(0.32, 0.4, 0.82, c, x, h + 0.2, 0));
        if (L === 3) g.add(box(1.04, 0.15, 0.84, 0x6a655e, 0, h - 0.4, 0));
      }
    },
    gate: (g, s) => {
      const L = lv(s), c = L === 1 ? 0x7a5432 : 0x8a857c, h = L === 1 ? 2.3 : 2.8;
      for (const x of [-0.45, 0.45]) g.add(L === 1 ? cyl(0.15, 0.16, h, c, x, h / 2, 0, 6) : box(0.3, h, 0.8, c, x, h / 2, 0));
      g.add(box(1.2, 0.25, L === 1 ? 0.3 : 0.85, c, 0, h - 0.1, 0));
      for (const x of [-0.42, 0.42]) { const d = box(0.36, 1.7, 0.06, 0x5a3a20, x, 0.9, 0.3); d.rotation.y = x < 0 ? -1.2 : 1.2; g.add(d); }
      g.add(box(0.06, 0.4, 0.5, TOWN_COLORS.ironhold, 0, h - 0.45, 0.2));
    },
    trading_post: (g, s) => {
      const L = lv(s), S = structSize(s);
      g.add(box(S - 0.6, 1.8, S - 1.2, 0x9a7444, -0.1, 0.9, -0.4));
      timbers(g, S - 0.6, S - 1.2, 0, 1.8, 0x5a3a20, false);
      roof(g, S - 0.6, S - 1.2, 0.9, 1.8, 0x6a4a3a, 0x9a7444, { over: 0.3 });
      g.add(box(1.0, 1.2, 0.06, 0x3a2614, -0.1, 0.6, S / 2 - 0.98));
      const aw = box(S - 0.4, 0.06, 1.0, 0xb08850, -0.1, 1.5, S / 2 - 0.5); aw.rotation.x = 0.25; g.add(aw);
      g.add(cyl(0.03, 0.03, 2.2, 0x2a2a2a, S / 2 - 0.25, 1.1, S / 2 - 0.3, 4), box(0.06, 0.5, 0.8, 0xc9a24a, S / 2 - 0.25, 2.0, S / 2 - 0.65));
      const crates = new C.Group(), barrel = new C.Group();
      PROP_MODELS.crates(crates); PROP_MODELS.barrel(barrel);
      crates.position.set(S / 2 - 0.6, 0, S / 2 - 0.5); barrel.position.set(-S / 2 + 0.4, 0, S / 2 - 0.4);
      g.add(crates, barrel);
      if (L >= 2) { const wg = caravanModel(0); wg.position.set(S / 2 + 0.6, 0, 0.2); wg.rotation.y = Math.PI; g.add(wg); }
      if (L >= 3) g.add(box(1.2, 1.4, 1.2, 0x8a6338, -S / 2 - 0.4, 0.7, -0.6), cone(0.95, 0.6, 0x5a3a2a, -S / 2 - 0.4, 1.7, -0.6, 4));
    },
    town_hall: (g, s) => {
      const L = lv(s), S = structSize(s), stone = 0x9a948a, wall = 0xe8dcc0;
      g.add(box(S + 0.2, 0.5, S, stone, 0, 0.25, 0), box(S - 0.2, 2.2, S - 0.6, wall, 0, 1.6, -0.1));
      timbers(g, S - 0.2, S - 0.6, 0.5, 2.2, 0x46301c, true);
      roof(g, S - 0.2, S - 0.6, 1.5, 2.7, 0x7a3a2a, wall, { over: 0.35 });
      door(g, (S - 0.6) / 2 - 0.1, { color: 0x5a3a20, bands: true, w: 0.9, h: 1.5, y: 0.5 });
      for (const x of [-0.95, 0.95]) win(g, x, 1.9, (S - 0.6) / 2 - 0.07, 0, { shutter: 0x3a5a7a, flowers: true });
      for (const x of [-S / 2 + 0.2, S / 2 - 0.2]) g.add(box(0.12, 0.12, 0.12, 0x46301c, x, 0.5, S / 2 - 0.1));
      g.add(box(S + 0.2, 0.12, 0.9, 0x8a847a, 0, 0.56, S / 2 - 0.1));
      // Bell tower, taller with each level.
      const th = 1.6 + L * 0.9;
      g.add(box(1.0, th, 1.0, stone, 0, 2.7 + th / 2, -0.4), box(1.2, 0.15, 1.2, 0x7a746a, 0, 2.7 + th, -0.4));
      for (const x of [-0.42, 0.42]) g.add(box(0.16, 0.8, 1.0, stone, x, 3.1 + th, -0.4));
      g.add(cyl(0.18, 0.26, 0.35, 0xc9a24a, 0, 3.0 + th, -0.4, 8), cone(0.85, 1.3, 0x5a3a44, 0, 4.2 + th, -0.4, 4));
      g.add(cyl(0.3, 0.3, 0.05, 0xf2ead8, 0, 2.2 + th, 0.11, 12).rotateX(Math.PI / 2));
      g.add(cyl(0.035, 0.035, 1.6, 0x3a2a1a, 0, 5.4 + th, -0.4, 5), box(0.04, 0.5, 0.8, TOWN_COLORS.ironhold, 0, 5.9 + th, 0.0));
      for (const x of [-S / 2 - 0.1, S / 2 + 0.1]) { const b = new C.Group(); PROP_MODELS.banner(b, 'ironhold'); b.position.set(x, 0, S / 2 - 0.2); g.add(b); }
    },
    guard_tower: (g, s) => {
      const S = structSize(s), L = lv(s);
      if (L === 1) {
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const leg = cyl(0.08, 0.1, 3.0, 0x7a5432, x * 0.5, 1.5, z * 0.5, 6); g.add(leg); }
        g.add(box(1.4, 0.12, 1.4, 0x8a6338, 0, 3.0, 0));
        for (const [x, z, w, d] of [[0, 0.68, 1.4, 0.06], [0, -0.68, 1.4, 0.06], [0.68, 0, 0.06, 1.4], [-0.68, 0, 0.06, 1.4]]) g.add(box(w, 0.6, d, 0x7a5432, x, 3.35, z));
        roof(g, 1.5, 1.5, 0.7, 3.9, 0x5a3a20, null, { over: 0.1 });
        for (const x of [-0.5, 0.5]) for (const x2 of [0]) g.add(box(0.05, 0.05, 0.05, 0x7a5432, x + x2, 0, 0));
        for (let k = 0; k < 8; k++) g.add(box(0.5, 0.04, 0.04, 0x7a5432, 0, 0.35 + k * 0.33, 0.75));
      } else {
        const h = L === 2 ? 3.6 : 5.0, r = 0.55 + S * 0.15;
        g.add(cyl(r, r + 0.12, h, 0x8a8478, 0, h / 2, 0, 10), cyl(r + 0.18, r + 0.18, 0.3, 0x7a746c, 0, h + 0.15, 0, 10));
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; g.add(box(0.3, 0.4, 0.3, 0x8a8478, Math.cos(a) * (r + 0.1), h + 0.5, Math.sin(a) * (r + 0.1))); }
        g.add(box(0.5, 0.9, 0.08, 0x3a2a1a, 0, 0.45, r + 0.04));
        for (const y of [1.5, h - 0.8]) win(g, 0, y, r + 0.06, 0, { w: 0.16, h: 0.4, frame: 0x6a645e });
        if (L >= 3) {
          g.add(cone(r + 0.35, 1.4, 0x7a3530, 0, h + 1.4, 0, 10), cyl(0.03, 0.03, 1.0, 0x3a2a1a, 0, h + 2.4, 0, 4), box(0.03, 0.4, 0.6, 0xb0302a, 0, h + 2.7, 0.3));
          for (const a of [0.8, -0.8]) { g.add(box(0.06, 0.4, 0.06, 0x2a2a2a, Math.sin(a) * (r + 0.1), 1.6, Math.cos(a) * (r + 0.1))); if (!previewing) { const gl = glowSprite(0xffa040, 1.8); gl.position.set(Math.sin(a) * (r + 0.15), 1.9, Math.cos(a) * (r + 0.15)); g.add(gl); } }
        }
      }
    },
  };

  function scaffold(g, size) {
    const r = size * 0.5 + 0.05;
    for (const [x, z] of [[-r, -r], [r, -r], [-r, r], [r, r]]) g.add(box(0.07, 1.4, 0.07, 0xb08850, x, 0.7, z));
    g.add(box(size + 0.2, 0.06, 0.1, 0xb08850, 0, 1.0, r), box(size + 0.2, 0.06, 0.1, 0xb08850, 0, 1.0, -r));
  }

  function worker(tunic, toolKind) {
    const a = humanoid({ tunic, skin: 0xd9a77a, legs: 0x4a3a2a, scale: 0.7 });
    if (toolKind) a.hand.add(tool(toolKind, 1));
    return a;
  }

  function structModel(s) {
    const def = STRUCTS[s.type], g = new C.Group(), crew = [], size = structSize(s);
    if (!s.level) {
      g.add(box(size - 0.1, 0.1, size - 0.1, 0x9a8a6a, 0, 0.05, 0));
      scaffold(g, size);
    } else {
      STRUCT_MODELS[s.type](g, s);
      if (s.pending) scaffold(g, size);
      const toolKind = { lumber_camp: 'axe', mine: 'pickaxe', dock: 'rod', sawbench: 'hammer', furnace: 'hammer', anvil: 'hammer', campfire: null }[s.type];
      for (let k = 0; k < Math.min(s.workers || 0, 3); k++) {
        const a = worker(0x8a6a3a, toolKind);
        const off = size * 0.5 + 0.5;
        a.g.position.set(-0.6 + k * 0.6, 0, off);
        a.g.rotation.y = Math.PI;
        a.working = true; a.phase = k;
        g.add(a.g); crew.push(a);
      }
      if (s.guards) {
        s.guards.slice(0, 4).forEach((tier, k) => {
          const a = worker(0x5a5f6a, 'spear');
          a.body.add(box(0.3, 0.32, 0.02, 0xa02a2a, 0, 0, 0.135));
          const ang = k / 4 * Math.PI * 2;
          a.g.position.set(Math.cos(ang) * (size * 0.5 + 0.5), 0, Math.sin(ang) * (size * 0.5 + 0.5));
          a.g.rotation.y = ang + Math.PI / 2;
          g.add(a.g); crew.push(a);
        });
      }
    }
    if (def.wall && !s.pending) return { g, crew };
    const hallName = s.type === 'town_hall' && state.myTown && state.myTown.hall === s.id ? state.myTown.name : null;
    const text = s.pending ? `${def.name} ${Math.floor(s.work / workNeeded(s) * 100)}%` : hallName || `${def.name}${s.level > 1 ? ' Lv' + s.level : ''}`;
    const label = makeLabel(text, hallName ? { color: '#fff4c8', size: 56, h: 0.8 } : { color: s.pending ? '#ffd27a' : '#ffe9a8', h: 0.3 });
    const box3 = new C.Box3().setFromObject(g);
    label.position.y = Math.max(1.7, box3.max.y + 0.5);
    g.add(label);
    return { g, crew };
  }

  function scanStructs() {
    const live = new Set();
    for (const s of state.structs) {
      live.add(s.id);
      const sig = `${s.level}:${s.pending}:${s.pending ? Math.floor(s.work / workNeeded(s) * 20) : 0}:${s.workers}:${s.guards ? s.guards.length : 0}:${s.type === 'town_hall' && state.myTown ? state.myTown.name : ''}`;
      const cur = structObjs.get(s.id);
      if (cur && cur.sig === sig) continue;
      if (cur) removeStruct(s.id);
      const def = STRUCTS[s.type];
      const { g, crew } = structModel(s);
      const size = structSize(s), cx = s.x + (size - 1) / 2, cy = s.y + (size - 1) / 2;
      let h = 0;
      for (const [x, y] of footprint(s.x, s.y, size)) h = Math.max(h, tileH[idx(x, y)]);
      g.position.set(cx, h, cy);
      g.traverse(o => { o.userData.tile = idx(s.x, s.y); });
      scene.add(g);
      pickables.push(g);
      structObjs.set(s.id, { g, crew, sig });
    }
    for (const id of [...structObjs.keys()]) if (!live.has(id)) removeStruct(id);
  }
  function removeStruct(id) {
    const o = structObjs.get(id);
    scene.remove(o.g);
    pickables.splice(pickables.indexOf(o.g), 1);
    o.g.traverse(x => {
      if (!x.isSprite) return;
      const gi = glows.findIndex(gl => gl.sp === x);
      if (gi >= 0) glows.splice(gi, 1); else disposeSprite(x);
    });
    for (let k = smoke.length - 1; k >= 0; k--) if (smoke[k].group === o.g) smoke.splice(k, 1);
    for (let k = flames.length - 1; k >= 0; k--) { let p = flames[k].parent; while (p && p !== o.g) p = p.parent; if (p === o.g) flames.splice(k, 1); }
    structObjs.delete(id);
  }

  // Translucent preview of the building being placed.
  function updateGhost() {
    const key = buildMode ? `${buildMode.type}:${buildMode.valid}` : '';
    if (key !== ghostKey) {
      ghostKey = key;
      if (ghost) { scene.remove(ghost); ghost = null; }
      if (buildMode) {
        const def = STRUCTS[buildMode.type];
        ghost = new C.Group();
        previewing = true;
        STRUCT_MODELS[buildMode.type](ghost, { type: buildMode.type, level: 1, size: def.size, x: buildMode.x, y: buildMode.y });
        previewing = false;
        const gm = new C.MeshBasicMaterial({ color: buildMode.valid ? 0x5aff7a : 0xff4a3a, transparent: true, opacity: 0.45, depthWrite: false });
        ghost.traverse(o => { if (o.isMesh) { o.material = gm; o.castShadow = false; } });
        const pad = new C.Mesh(new C.BoxGeometry(def.size, 0.08, def.size), gm);
        pad.position.y = 0.04;
        ghost.add(pad);
        if (def.gather || def.guards) {
          const r = def.guards ? EMPIRE.towerRadius : EMPIRE.gatherRadius;
          const ring = new C.Mesh(new C.RingGeometry(r - 0.15, r, 48).rotateX(-Math.PI / 2), new C.MeshBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.6, depthWrite: false }));
          ring.position.y = 0.15;
          ghost.add(ring);
        }
        scene.add(ghost);
      }
    }
    if (ghost) {
      const def = STRUCTS[buildMode.type];
      const cx = buildMode.x + (def.size - 1) / 2, cy = buildMode.y + (def.size - 1) / 2;
      ghost.position.set(cx, gh(cx, cy), cy);
    }
  }

  // ------------------------------------------------------------ effects
  function floater(x, y, text, o, height = 1.6) {
    const sp = makeLabel(text, o);
    sp.position.set(x + (Math.random() - 0.5) * 0.3, gh(x, y) + height, y);
    scene.add(sp);
    floaters.push({ sp, life: 0, dur: o.dur || 1.1 });
  }
  FX.damage = (x, y, dmg, onPlayer) => {
    floater(x, y, String(dmg), {
      color: '#fff', size: 44, h: 0.42,
      bg: dmg === 0 ? 'rgba(43,95,158,0.9)' : onPlayer ? 'rgba(170,30,25,0.95)' : 'rgba(200,110,20,0.95)',
    }, onPlayer ? 1.5 : 1.3);
  };
  FX.gain = (x, y, text, cls) => {
    floater(x, y, text, { color: cls === 'level' ? '#8fe8ff' : '#ffffff', size: 36, h: cls === 'level' ? 0.42 : 0.3, dur: cls === 'level' ? 2 : 1.2 }, 1.9);
  };
  FX.lunge = m => { const a = monObjs.get(m.id); if (a) a.lunge = 1; };
  // A ring that bursts out from you for a special attack.
  const bursts = [];
  FX.special = (name, radius) => {
    const ring = new C.Mesh(new C.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2),
      new C.MeshBasicMaterial({ color: name === 'Frost Nova' ? 0x9adfff : 0xffd27a, transparent: true, opacity: 0.9, depthWrite: false, side: C.DoubleSide }));
    ring.position.set(state.px, playerY() + 0.15, state.py);
    scene.add(ring);
    bursts.push({ m: ring, life: 0, r: radius });
    floater(state.px, state.py, name, { color: name === 'Frost Nova' ? '#bfe8ff' : '#ffe9a8', size: 40, h: 0.42, dur: 1.4 }, 2.3);
  };
  FX.telegraph = (m, kind) => {
    const a = monObjs.get(m.id);
    if (!a) return;
    const ring = new C.Mesh(new C.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), new C.MeshBasicMaterial({ color: kind === 'breath' ? 0xbfe8ff : 0xffa060, transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.set(m.x, gh(m.x, m.y) + 0.15, m.y);
    scene.add(ring);
    bursts.push({ m: ring, life: 0, r: m.tele ? m.tele.r : 2.5 });
  };
  function updateBursts(dt) {
    for (let k = bursts.length - 1; k >= 0; k--) {
      const b = bursts[k];
      b.life += dt;
      const f = b.life / 0.45;
      b.m.scale.setScalar(0.3 + f * b.r);
      b.m.material.opacity = 0.9 * (1 - f);
      if (f >= 1) { scene.remove(b.m); b.m.geometry.dispose(); b.m.material.dispose(); bursts.splice(k, 1); }
    }
  }
  // Red ground markers that fill in as a monster winds up a big attack.
  function updateTelegraph(a, m) {
    const tl = m.tele;
    if (!tl || tl.kind === 'summon') { if (a.tele) { scene.remove(a.tele); a.tele = null; } return; }
    if (!a.tele || a.teleKey !== tl.start) {
      if (a.tele) scene.remove(a.tele);
      const geo2 = tl.kind === 'breath' ? new C.CircleGeometry(tl.r, 24, Math.PI / 2 - tl.arc, tl.arc * 2) : new C.CircleGeometry(tl.r, 32);
      geo2.rotateX(-Math.PI / 2);
      a.tele = new C.Mesh(geo2, new C.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.3, depthWrite: false }));
      a.tele.renderOrder = 4;
      a.tele.position.set(tl.x, gh(tl.x, tl.y) + 0.08, tl.y);
      a.tele.rotation.y = Math.PI + tl.dir;
      a.teleKey = tl.start;
      scene.add(a.tele);
    }
    const f = clamp((Date.now() - tl.start) / (tl.end - tl.start), 0, 1);
    a.tele.material.opacity = 0.15 + 0.45 * f + Math.sin(f * 30) * 0.05;
  }

  function marker(color, opacity, size = 0.5) {
    const g = new C.RingGeometry(size * 0.75, size, 24);
    g.rotateX(-Math.PI / 2);
    const m = new C.Mesh(g, new C.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.renderOrder = 5;
    m.visible = false;
    scene.add(m);
    return m;
  }

  // ------------------------------------------------------------ picking & camera input
  function groundPoint(ndc) {
    raycaster.setFromCamera(ndc, camera);
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    let prev = 0;
    for (let t = 0.5; t < 160; t += 0.25) {
      const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
      if (y <= Math.max(gh(x, z), -0.04)) {
        // Refine between the last two samples.
        let a = prev, b = t;
        for (let k = 0; k < 6; k++) {
          const m = (a + b) / 2, mx = o.x + d.x * m, mz = o.z + d.z * m;
          if (o.y + d.y * m <= Math.max(gh(mx, mz), -0.04)) b = m; else a = m;
        }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prev = t;
    }
    return null;
  }

  function pick(ndc) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      if (o.isInstancedMesh && o.userData.tiles) {
        const i = o.userData.tiles[h.instanceId];
        if (i != null) return { x: i % W, y: Math.floor(i / W) };
        continue;
      }
      while (o) {
        if (o.userData.monsterId != null) return { monsterId: o.userData.monsterId };
        if (o.userData.tile != null) return { x: o.userData.tile % W, y: Math.floor(o.userData.tile / W) };
        o = o.parent;
      }
    }
    const p = groundPoint(ndc);
    return p ? { x: Math.round(p.x), y: Math.round(p.z) } : null;
  }

  function ndcOf(e) {
    const r = renderer.domElement.getBoundingClientRect();
    return new C.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  function setupInput() {
    const cv = renderer.domElement;
    let drag = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 5) drag.moved = true;
        if (drag.moved) {
          state.camYaw -= dx * 0.008;
          pitch = clamp(pitch + dy * 0.005, 0.18, 1.35);
          drag.x = e.clientX; drag.y = e.clientY;
        }
      } else if (buildMode) {
        const p = groundPoint(ndcOf(e));
        if (p) setBuildCursor(p.x, p.z);
      }
    });
    cv.addEventListener('pointerup', e => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      if (d.button === 2) { if (buildMode) buildMode = null; return; }
      if (d.button === 0) { clickWorld(buildMode ? null : pick(ndcOf(e))); uiDirty = true; }
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); zoom = clamp(zoom * (e.deltaY > 0 ? 1.1 : 0.9), 4, 30); }, { passive: false });
  }

  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ frame
  function frame(ms) {
    requestAnimationFrame(frame);
    const now = Date.now();
    const dt = Math.min(0.1, lastFrame ? (ms - lastFrame) / 1000 : 0.016);
    lastFrame = ms;
    const t = ms / 1000;

    frameMove(dt);


    if (now - lastNodeScan > 150) { lastNodeScan = now; scanNodes(now); }
    if (now - lastStructScan > 300) {
      lastStructScan = now;
      const before = structObjs.size;
      scanStructs();
      if (structObjs.size !== before) clutterX = -999;
    }
    updateGhost();

    // Player
    updatePlayerGear();
    const jump = Math.hypot(state.px - player.vx, state.py - player.vz) > 3;
    player.vx = state.px; player.vz = state.py;
    if (jump) { camX = player.vx; camZ = player.vz; }
    if (Math.abs(player.vx - streamX) > 12 || Math.abs(player.vz - streamY) > 12) streamNodes(now);
    if (Math.abs(player.vx - clutterX) > Q.clutterR / 3 || Math.abs(player.vz - clutterY) > Q.clutterR / 3) streamClutter();
    player.rot = lerpAngle(player.rot, state.face, Math.min(1, dt * 14));
    let acting = false;
    if (action) {
      if (action.type === 'gather') {
        const r = RESOURCES[nodes.get(action.i).res];
        const tl = r.tool && bestTool(r.tool);
        setPlayerTool(r.tool || null, tl ? ITEMS[tl].tier : 0);
        acting = r.tool !== 'rod';
        const fx = action.i % W, fy = Math.floor(action.i / W);
        player.rot = lerpAngle(player.rot, Math.atan2(fx - state.px, fy - state.py), Math.min(1, dt * 10));
      } else if (action.type === 'combat') {
        const m = monsters.find(mm => mm.id === action.id);
        acting = !!m && Math.hypot(m.x - state.px, m.y - state.py) <= 1.8;
        setPlayerTool(state.equip.weapon ? (state.equip.weapon === 'wooden_club' ? 'club' : 'sword') : null, state.equip.weapon ? ITEMS[state.equip.weapon].tier : 0);
      } else { setPlayerTool('hammer', 0); acting = true; }
      if (action.type === 'construct') {
        const s = structById(action.sid);
        if (s) { const c = structCenter(s); player.rot = lerpAngle(player.rot, Math.atan2(c.x - state.px, c.y - state.py), Math.min(1, dt * 10)); }
      }
    } else setPlayerTool(state.equip.weapon ? (state.equip.weapon === 'wooden_club' ? 'club' : 'sword') : null, state.equip.weapon ? ITEMS[state.equip.weapon].tier : 0);
    const afloat = !!state.sailing;
    player.boat.visible = afloat;
    player.horse.g.visible = !!state.mounted;
    player.g.position.set(player.vx, playerY() + (afloat ? Math.sin(t * 1.7) * 0.04 : 0), player.vz);
    player.g.rotation.y = player.rot;
    if (afloat) {
      player.g.rotation.z = Math.sin(t * 1.3) * 0.04;
      player.inner.position.y = 0.22;
      player.boat.userData.sail.scale.x = 1 + (moving ? 0.12 : 0.03) * Math.sin(t * 4);
      animateLimbs(player, false, acting, dt, t);
      player.inner.position.y = 0.22;
      if (moving && Math.random() < dt * 0.8) Sound.sfx('splash');
    } else if (state.mounted) {
      // In the saddle: the horse walks, you sit.
      player.g.rotation.z = 0;
      animateLimbs(player.horse, moving, false, dt, t, keys.has('shift') ? 16 : 11);
      animateLimbs(player, false, false, dt, t);
      player.inner.position.y = 0.95 + player.horse.inner.position.y;
      player.legL.rotation.x = player.legR.rotation.x = -1.2;
      player.legL.rotation.z = -0.35; player.legR.rotation.z = 0.35;
    } else {
      player.g.rotation.z = 0;
      player.legL.rotation.z = player.legR.rotation.z = 0;
      animateLimbs(player, moving, acting && !moving && !combat.blocking, dt, t, keys.has('shift') ? 17 : 13);
      if (combat.blocking) { player.armL.rotation.x = -1.5; player.armR.rotation.x = -0.9; }
    }
    // A tucked forward roll in the direction you dodge, spinning around your middle so you never sink into the ground.
    if (combat.dodgeLeft > 0) {
      const a = (1 - combat.dodgeLeft / DODGE.time) * Math.PI * 2, c = 0.55;
      player.rot = Math.atan2(combat.dodgeX, combat.dodgeY);
      player.g.rotation.y = player.rot;
      player.inner.rotation.x = a;
      player.inner.position.set(0, c - c * Math.cos(a) + Math.sin(a / 2) * 0.15, -c * Math.sin(a));
      player.legL.rotation.x = player.legR.rotation.x = -1.6;
      player.armL.rotation.x = player.armR.rotation.x = -2.2;
    } else {
      player.inner.rotation.x = 0;
      player.inner.position.z = 0;
    }
    // Footsteps, softer on grass than on stone.
    const ph = Math.floor(player.walk / Math.PI);
    if (moving && !afloat && ph !== stepPhase && (!state.mounted || ph % 2)) {
      const tt = terrain[idx(Math.round(state.px), Math.round(state.py))];
      Sound.sfx(tt === T.FLOOR || tt === T.ROAD || tt === T.BRIDGE || tt === T.PEAK ? 'stepstone' : 'step');
    }
    stepPhase = ph;
    lantern.position.set(player.vx, playerY() + 2.2, player.vz);
    setBar(player.bar, state.hp / maxHp(), state.hp < maxHp());

    // Monsters
    const live = new Set(), reach = zoom * 2 + 30;
    for (const m of monsters) {
      if (m.hp <= 0) continue;
      live.add(m.id);
      const near = Math.abs(m.x - player.vx) < reach && Math.abs(m.y - player.vz) < reach;
      let a = monObjs.get(m.id);
      if (!near) { if (a) a.g.visible = false; continue; }
      if (!a) { a = makeMonster(m); monObjs.set(m.id, a); }
      a.g.visible = true;
      animateMonster(a, m, dt, t);
      const def = MONSTERS[m.type];
      setBar(a.bar, m.hp / def.hp, m.hp < def.hp);
      a.alert.visible = m.aggro;
      // Stunned monsters sway; winding-up monsters show where the blow will land.
      a.inner.rotation.z = m.stunUntil > Date.now() ? Math.sin(t * 10) * 0.18 : 0;
      updateTelegraph(a, m);
    }
    for (const [id, a] of monObjs) {
      if (live.has(id)) continue;
      if (a.tele) { scene.remove(a.tele); a.tele = null; }
      scene.remove(a.g);
      pickables.splice(pickables.indexOf(a.g), 1);
      a.g.traverse(o => { if (o.isSprite) disposeSprite(o); });
      monObjs.delete(id);
    }

    // Workers, townsfolk and ambient animation
    for (const o of structObjs.values()) for (const a of o.crew) {
      if (a.working) a.armR.rotation.x = -1.2 + Math.sin(t * 5 + a.phase * 2) * 0.8;
    }
    for (const a of actors) {
      a.armL.rotation.x = Math.sin(t * 1.3 + a.g.position.x) * 0.15;
      if (a.working) a.armR.rotation.x = -1.2 + Math.sin(t * 6 + a.phase) * 0.8;
    }
    // Town life only runs near the player.
    for (const tg of townGroups) tg.g.visible = Math.hypot(tg.x - player.vx, tg.y - player.vz) < 75;
    for (const w of walkers) {
      if (w.boat) { w.boat.position.y = Math.sin(t * 1.4 + w.boat.userData.bob) * 0.06; w.boat.rotation.z = Math.sin(t + w.boat.userData.bob) * 0.04; continue; }
      if (!w.a.g.parent.visible) continue;
      wander(w, dt, t);
      if (w.a.carry) w.a.armR.rotation.x = -1.1;
    }
    for (const b of boardObjs) { const m = Story.boardMark(b.town); b.marks['!'].visible = m === '!'; b.marks['?'].visible = m === '?'; }
    updateSecrets(t);
    for (const n of npcObjs) {
      const here = Story.npcHere(n.npc), mark = here ? Story.npcMark(n.npc) : '';
      n.a.g.visible = here;
      n.marks['!'].visible = mark === '!'; n.marks['?'].visible = mark === '?';
      n.marks['!'].position.y = n.a.height * 0.9 + 1.25 + Math.sin(t * 3) * 0.08;
    }
    if (forgeFx && forgeFx.fx.visible !== !!state.story.forgeLit) {
      forgeFx.fx.visible = !!state.story.forgeLit;
      for (const r of forgeFx.runes) r.material.emissiveIntensity = state.story.forgeLit ? 1 : 0;
    }
    for (const po of poiObjs) {
      po.label.visible = Math.hypot(po.p.x - player.vx, po.p.y - player.vz) < 22;
      for (const { chest, key } of po.chests) chest.userData.lid.rotation.x += ((state.opened[key] ? -1.6 : 0) - chest.userData.lid.rotation.x) * Math.min(1, dt * 5);
      po.g.traverse(o => { if (o.userData.spin) { o.rotation.y = t; o.position.y = 1.2 + Math.sin(t * 2) * 0.08; } });
    }
    updateCritters(dt, t);
    updateBursts(dt);
    updatePet(dt, t);
    if (seasonIdx() !== shownSeason) { shownSeason = seasonIdx(); streamX = streamY = -999; clutterX = -999; }
    updateCaravans(dt, t);
    updateMyTown(dt, t);
    updateFish(dt, now);
    updateCarriers(dt, t);
    waterTex.offset.set(t * 0.02, t * 0.013);
    const m4 = new C.Matrix4();
    for (const r of fishSlots) {
      const p = (t * 0.55 + r.phase) % 1, s = 0.5 + p * 1.6;
      ringMesh.setMatrixAt(r.slot, m4.makeScale(s, 1, s).setPosition(r.x, 0.02, r.y));
    }
    if (fishSlots.length) ringMesh.instanceMatrix.needsUpdate = true;
    for (const f of flames) f.scale.set(1, 0.8 + Math.sin(t * 17 + f.userData.seed) * 0.15 + Math.random() * 0.1, 1);
    for (const s of smoke) {
      const p = (t * 0.35 + s.phase) % 1;
      s.p.position.set(s.x + p * 0.3, s.y + p * 1.4, s.z - p * 0.2);
      s.p.scale.setScalar(0.6 + p * 1.6);
      s.p.material.opacity = 0.55 * (1 - p);
    }
    for (let k = floaters.length - 1; k >= 0; k--) {
      const f = floaters[k];
      f.life += dt;
      f.sp.position.y += dt * 0.8;
      f.sp.material.opacity = 1 - Math.max(0, (f.life - f.dur * 0.5) / (f.dur * 0.5));
      if (f.life >= f.dur) { scene.remove(f.sp); disposeSprite(f.sp); floaters.splice(k, 1); }
    }

    // Markers: what E will use, and who you're fighting.
    const it = interactTarget;
    if (it && it.kind !== 'monster' && !action) {
      let x = it.x, y = it.y, size = 0.55;
      if (it.kind === 'struct') { const c = structCenter(it.s); x = c.x; y = c.y; size = structSize(it.s) * 0.7; }
      interactMark.visible = true;
      interactMark.scale.setScalar(size / 0.55 * (1 + Math.sin(t * 6) * 0.06));
      interactMark.position.set(x, Math.max(gh(x, y), 0) + 0.06, y);
    } else interactMark.visible = false;
    let tgt = action && action.type === 'combat' ? monObjs.get(action.id) : null;
    if (!tgt && it && it.kind === 'monster') tgt = monObjs.get(it.m.id);
    targetMark.visible = !!tgt;
    if (tgt) targetMark.position.set(tgt.vx, gh(tgt.vx, tgt.vz) + 0.06, tgt.vz);

    // Orbit camera
    const k = Math.min(1, dt * 10);
    camX += (player.vx - camX) * k;
    camZ += (player.vz - camZ) * k;
    camY += (playerY() - camY) * k;
    const yaw = state.camYaw;
    let cxp = camX + Math.sin(yaw) * Math.cos(pitch) * zoom;
    let czp = camZ + Math.cos(yaw) * Math.cos(pitch) * zoom;
    let cyp = camY + 1 + Math.sin(pitch) * zoom;
    cyp = Math.max(cyp, gh(cxp, czp) + 0.8);
    camera.position.set(cxp, cyp, czp);
    camera.lookAt(camX, camY + 1, camZ);
    const gloom = updateSky(dt, t, new C.Vector3(camX, camY, camZ));
    updateBirds(dt, t, daylight());
    const alt = Math.max(0, camY - 4) * 3;
    const thick = (1 - fogAmt * 0.6) * (1 - rainAmt * 0.3) * (1 - gloom * 0.1);
    scene.fog.near = (34 + zoom + alt) * Q.fog * thick;
    scene.fog.far = (62 + zoom * 1.5 + alt * 1.5) * Q.fog * thick;
    if (underAmt > 0) { scene.fog.near = lerp(scene.fog.near, 6 + zoom * 0.5, underAmt); scene.fog.far = lerp(scene.fog.far, 22 + zoom, underAmt); }
    sun.target.position.set(camX, camY, camZ);

    drawMinimap();
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ public
  function init(container) {
    view = container;
    renderer = new C.WebGLRenderer({ antialias: settings.quality !== 'low' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixel));
    renderer.shadowMap.enabled = Q.shadows;
    renderer.shadowMap.type = C.PCFSoftShadowMap;
    view.prepend(renderer.domElement);

    scene = new C.Scene();
    scene.background = new C.Color(SKY);
    scene.fog = new C.Fog(SKY, 40, 75);
    camera = new C.PerspectiveCamera(50, 1, 0.3, 300);

    hemi = new C.HemisphereLight(0xdfefff, 0x4a5a3a, 0.5);
    scene.add(hemi);
    sun = new C.DirectionalLight(0xfff1d6, 0.7);
    sun.castShadow = Q.shadows;
    sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    lantern = new C.PointLight(0xffc070, 0, 11, 1.6);
    scene.add(lantern);
    windowMat = new C.MeshPhongMaterial({ color: 0x5a4020, emissive: 0xffc860, emissiveIntensity: 0, flatShading: true });
    const sc = sun.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 100;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);

    buildTerrain();
    buildNodeMeshes();
    buildClutter();
    buildTowns();
    buildSky();
    setWinter();
    player = buildPlayer();
    camX = state.px; camZ = state.py; camY = gh(state.px, state.py);
    interactMark = marker(0xffffff, 0.7, 0.55);
    targetMark = marker(0xff3a2a, 0.9, 0.55);
    scene.traverse(o => { if (o.isInstancedMesh) o.frustumCulled = false; });

    setupInput();
    new ResizeObserver(resize).observe(view);
    resize();
  }

  function start() { requestAnimationFrame(frame); }

  return { init, start, setQuality, setWinter };
})();
