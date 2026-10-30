// 3D renderer for Ironhold, built on three.js. It reads game state each frame and
// only talks back to the game through clickTile() and hoverText.
'use strict';

const Render3D = (() => {
  const C = THREE;
  let renderer, scene, camera, sun, view;
  const raycaster = new C.Raycaster();
  const groundPlane = new C.Plane(new C.Vector3(0, 1, 0), 0);
  let zoom = 14, camX = TOWN.x, camZ = TOWN.y;
  let lastFrame = 0, lastNodeScan = 0, lastSiteScan = 0, lastPick = 0;
  let pointer = null, pointerMoved = false;
  let player = null;
  let waterTex = null;
  let hoverMark, walkMark, targetMark;
  const monObjs = new Map();
  const nodeEntries = [];
  const nodeMeshes = [];
  const fishRings = [];
  const siteObjs = {};
  const pickables = [];
  const floaters = [];
  const smoke = [];
  const flames = [];
  const SKY = 0xa9cfe9;
  const TIER_COLORS = [0x8a6a4a, 0xc77a3a, 0x9c9c9c, 0xd2dae4, 0x8f7bff];

  // ------------------------------------------------------------ helpers
  // Hidden instances are parked far below the world (zero-scale matrices upset raycasting).
  const HIDE = new C.Matrix4().makeTranslation(0, -1000, 0);
  const rnd = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
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
    g.font = `bold ${fs}px system-ui, sans-serif`;
    const w = Math.ceil(g.measureText(text).width + fs * 0.9);
    cv.width = w; cv.height = Math.ceil(fs * 1.5);
    g.font = `bold ${fs}px system-ui, sans-serif`;
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
    const sp = new C.Sprite(new C.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = o.h || 0.4;
    sp.scale.set(h * w / cv.height, h, 1);
    sp.renderOrder = 10;
    return sp;
  }
  function disposeSprite(sp) { if (sp.material.map) sp.material.map.dispose(); sp.material.dispose(); }

  // ------------------------------------------------------------ terrain
  function tileColor(x, y) {
    const i = idx(x, y), c = new C.Color();
    switch (terrain[i]) {
      case T.GRASS: {
        const d = clamp((distTown(x, y) - 16) / 65, 0, 1);
        c.setRGB(0.4, 0.62, 0.27).lerp(new C.Color(0.25, 0.37, 0.22), d);
        if (deco[i] < 2) c.multiplyScalar(0.92);
        if (deco[i] === 9) c.lerp(new C.Color(0.62, 0.66, 0.32), 0.35);
        break;
      }
      case T.WATER: case T.BRIDGE: c.setHex(0x1f4a6c); break;
      case T.WALL: c.setHex(0x6b665c); break;
      case T.FLOOR: c.setHex((x + y) % 2 ? 0x938a77 : 0x8e8572); break;
      case T.ROAD: c.setHex(0xa3845a); break;
      default: c.setHex(0x6d665a);
    }
    c.offsetHSL(0, 0, (rnd(i, 1) - 0.5) * 0.05);
    return c;
  }

  function quadGeometry(tiles, yOf, colorOf, uvScale) {
    const n = tiles.length;
    const pos = new Float32Array(n * 12), col = new Float32Array(n * 12), uv = new Float32Array(n * 8);
    const index = new Uint32Array(n * 6);
    tiles.forEach(([x, y], k) => {
      const h = yOf(x, y), c = colorOf ? colorOf(x, y) : null;
      const corners = [[x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [x - 0.5, y + 0.5]];
      corners.forEach(([cx, cz], v) => {
        pos.set([cx, h, cz], (k * 4 + v) * 3);
        if (c) col.set([c.r, c.g, c.b], (k * 4 + v) * 3);
        uv.set([cx / uvScale, cz / uvScale], (k * 4 + v) * 2);
      });
      const b = k * 4;
      index.set([b, b + 3, b + 1, b + 1, b + 3, b + 2], k * 6);
    });
    const g = new C.BufferGeometry();
    g.setAttribute('position', new C.BufferAttribute(pos, 3));
    g.setAttribute('color', new C.BufferAttribute(col, 3));
    g.setAttribute('uv', new C.BufferAttribute(uv, 2));
    g.setIndex(new C.BufferAttribute(index, 1));
    g.computeVertexNormals();
    return g;
  }

  function buildTerrain() {
    const all = [], water = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      all.push([x, y]);
      const t = terrain[idx(x, y)];
      if (t === T.WATER || t === T.BRIDGE) water.push([x, y]);
    }
    const ground = new C.Mesh(
      quadGeometry(all, (x, y) => (terrain[idx(x, y)] === T.WATER || terrain[idx(x, y)] === T.BRIDGE ? -0.12 : 0), tileColor, 1),
      new C.MeshLambertMaterial({ vertexColors: true }));
    ground.receiveShadow = true;
    scene.add(ground);

    waterTex = waterTexture();
    const wm = new C.Mesh(quadGeometry(water, () => 0.03, null, 3),
      new C.MeshPhongMaterial({ color: 0x4f9fd9, map: waterTex, transparent: true, opacity: 0.8, shininess: 80, specular: 0x88bbee }));
    wm.receiveShadow = true;
    scene.add(wm);

    // Mountains around the edge.
    const peaks = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (terrain[idx(x, y)] === T.MOUNTAIN) peaks.push([x, y]);
    const mountain = new C.InstancedMesh(geo('ConeGeometry', 0.85, 1, 6), mat(0xffffff), peaks.length);
    const snow = new C.InstancedMesh(geo('ConeGeometry', 0.85, 1, 6), mat(0xf4f6f8), peaks.length);
    const m4 = new C.Matrix4(), q = new C.Quaternion(), e = new C.Euler();
    peaks.forEach(([x, y], k) => {
      const i = idx(x, y), h = 1.6 + rnd(i, 2) * 2.6;
      q.setFromEuler(e.set(0, rnd(i, 3) * 6, 0));
      m4.compose(new C.Vector3(x, h / 2, y), q, new C.Vector3(1.25, h, 1.25));
      mountain.setMatrixAt(k, m4);
      mountain.setColorAt(k, new C.Color(0x77706a).offsetHSL(0, 0, (rnd(i, 4) - 0.5) * 0.12));
      const sh = h * 0.28;
      m4.compose(new C.Vector3(x, h - sh / 2 + 0.01, y), q, new C.Vector3(1.25 * 0.29, sh, 1.25 * 0.29));
      snow.setMatrixAt(k, h > 3 ? m4 : HIDE);
    });
    mountain.castShadow = true;
    scene.add(mountain, snow);

    // Town walls with crenellations, corner towers and bridges.
    const walls = [], bridges = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = terrain[idx(x, y)];
      if (t === T.WALL) walls.push([x, y]);
      if (t === T.BRIDGE) bridges.push([x, y]);
    }
    const wall = new C.InstancedMesh(geo('BoxGeometry', 1, 1.3, 1), mat(0x8c867a), walls.length);
    const cren = new C.InstancedMesh(geo('BoxGeometry', 0.5, 0.3, 1.02), mat(0x7d776c), walls.length);
    walls.forEach(([x, y], k) => {
      wall.setMatrixAt(k, new C.Matrix4().makeTranslation(x, 0.65, y));
      wall.setColorAt(k, new C.Color(0xffffff).offsetHSL(0, 0, (rnd(idx(x, y), 5) - 0.5) * 0.1));
      cren.setMatrixAt(k, (x + y) % 2 ? new C.Matrix4().makeTranslation(x, 1.45, y) : HIDE);
    });
    wall.castShadow = cren.castShadow = true;
    wall.receiveShadow = true;
    scene.add(wall, cren);
    for (const [x, y] of [[TOWN.x0, TOWN.y0], [TOWN.x1, TOWN.y0], [TOWN.x0, TOWN.y1], [TOWN.x1, TOWN.y1]]) {
      scene.add(cyl(0.75, 0.8, 2.2, 0x8a8478, x, 1.1, y, 8), cone(0.95, 1.0, 0x7a3530, x, 2.7, y, 8));
    }
    for (const [x, y] of [[TOWN.x, TOWN.y0], [TOWN.x, TOWN.y1], [TOWN.x0, TOWN.y], [TOWN.x1, TOWN.y]]) {
      const horiz = y === TOWN.y0 || y === TOWN.y1;
      for (const s of [-1, 1]) {
        const tx = horiz ? x + s : x, ty = horiz ? y : y + s;
        scene.add(cyl(0.35, 0.4, 1.9, 0x8a8478, tx, 0.95, ty, 6));
        const f = mesh(geo('ConeGeometry', 0.12, 0.3, 5), glow(0xffa030), tx, 2.05, ty, false);
        flames.push(f); scene.add(f);
      }
    }
    const plank = new C.InstancedMesh(geo('BoxGeometry', 1.0, 0.1, 0.95), mat(0x8a6338), bridges.length);
    bridges.forEach(([x, y], k) => plank.setMatrixAt(k, new C.Matrix4().makeTranslation(x, 0.1, y)));
    plank.castShadow = true;
    scene.add(plank);
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

  // ------------------------------------------------------------ resource nodes
  const ORE = { copper: [0x8a6f5a, 0xff8c3a], iron: [0x7d7570, 0xeadbcc], coal: [0x55524e, 0x141416] };
  function nodeParts(res) {
    switch (res) {
      case 'pine': return [
        { g: geo('CylinderGeometry', 0.07, 0.11, 0.5, 5), c: 0x6b4a2b, y: 0.25 },
        { g: geo('ConeGeometry', 0.5, 0.9, 7), c: 0x2f6b35, y: 0.8, vary: 1 },
        { g: geo('ConeGeometry', 0.37, 0.75, 7), c: 0x3a8442, y: 1.28, vary: 1 }];
      case 'oak': return [
        { g: geo('CylinderGeometry', 0.12, 0.17, 0.75, 6), c: 0x5e4026, y: 0.37 },
        { g: geo('IcosahedronGeometry', 0.64, 0), c: 0x66a83d, y: 1.15, sy: 0.85, vary: 1 }];
      case 'ironwood': return [
        { g: geo('CylinderGeometry', 0.12, 0.19, 1.0, 6), c: 0x3b3030, y: 0.5 },
        { g: geo('ConeGeometry', 0.52, 2.0, 5), c: 0x25a888, y: 1.75, vary: 1 }];
      case 'copper': case 'iron': case 'coal': return [
        { g: geo('DodecahedronGeometry', 0.42, 0), c: ORE[res][0], y: 0.2, sy: 0.75, vary: 1 },
        { g: geo('OctahedronGeometry', 0.11, 0), c: ORE[res][1], y: 0.4, x: 0.15, z: 0.12 },
        { g: geo('OctahedronGeometry', 0.09, 0), c: ORE[res][1], y: 0.32, x: -0.18, z: -0.05 }];
    }
    return [];
  }

  function buildNodes() {
    const byRes = {};
    const fish = [];
    for (const [i, n] of nodes) {
      const x = i % W, y = (i - x) / W;
      if (RESOURCES[n.res].skill === 'fishing') { fish.push({ i, n, x, y }); continue; }
      (byRes[n.res] = byRes[n.res] || []).push({ i, n, x, y });
    }
    const trees = [], rocks = [];
    for (const res in byRes) {
      const list = byRes[res];
      const parts = nodeParts(res).map(p => {
        const im = new C.InstancedMesh(p.g, mat(0xffffff), list.length);
        im.castShadow = true;
        im.userData.tiles = list.map(e => e.i);
        scene.add(im);
        pickables.push(im);
        nodeMeshes.push(im);
        return { p, im };
      });
      const isTree = RESOURCES[res].skill === 'woodcutting';
      list.forEach((e, k) => {
        const s = isTree ? 0.85 + rnd(e.i, 6) * 0.4 : 0.8 + rnd(e.i, 6) * 0.35;
        const base = new C.Matrix4().compose(
          new C.Vector3(e.x + (rnd(e.i, 8) - 0.5) * 0.15, 0, e.y + (rnd(e.i, 9) - 0.5) * 0.15),
          new C.Quaternion().setFromEuler(new C.Euler(0, rnd(e.i, 7) * Math.PI * 2, 0)),
          new C.Vector3(s, s, s));
        e.base = base;
        e.parts = parts.map(({ p, im }) => {
          const local = new C.Matrix4().compose(new C.Vector3(p.x || 0, p.y, p.z || 0), new C.Quaternion(), new C.Vector3(1, p.sy || 1, 1));
          const m = base.clone().multiply(local);
          im.setMatrixAt(k, m);
          im.setColorAt(k, new C.Color(p.c).offsetHSL(0, 0, p.vary ? (rnd(e.i, 10) - 0.5) * 0.1 : 0));
          return { im, k, m };
        });
        e.active = true;
        (isTree ? trees : rocks).push(e);
        nodeEntries.push(e);
      });
    }
    const stump = new C.InstancedMesh(geo('CylinderGeometry', 0.15, 0.19, 0.18, 6), mat(0x6b4a2b), trees.length);
    trees.forEach((e, k) => { stump.setMatrixAt(k, HIDE); e.alt = { im: stump, k, m: e.base.clone().multiply(new C.Matrix4().makeTranslation(0, 0.09, 0)) }; });
    const rubble = new C.InstancedMesh(geo('DodecahedronGeometry', 0.3, 0), mat(0x5d5852), rocks.length);
    rocks.forEach((e, k) => { rubble.setMatrixAt(k, HIDE); e.alt = { im: rubble, k, m: e.base.clone().multiply(new C.Matrix4().compose(new C.Vector3(0, 0.05, 0), new C.Quaternion(), new C.Vector3(1, 0.35, 1))) }; });
    stump.castShadow = rubble.castShadow = true;
    scene.add(stump, rubble);
    nodeMeshes.push(stump, rubble);

    // Fishing spots: two expanding ripple rings each.
    const ringGeo = new C.RingGeometry(0.16, 0.24, 20);
    ringGeo.rotateX(-Math.PI / 2);
    const rings = new C.InstancedMesh(ringGeo, new C.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }), fish.length * 2);
    const tint = { minnow: 0xe8f6ff, trout: 0x8ff0ff, pike: 0xc4a8ff };
    fish.forEach((e, k) => {
      for (let r = 0; r < 2; r++) {
        rings.setColorAt(k * 2 + r, new C.Color(tint[e.n.res]));
        fishRings.push({ x: e.x, y: e.y, k: k * 2 + r, phase: r * 0.5 + rnd(e.i, 11) });
      }
    });
    rings.userData.tiles = fish.flatMap(e => [e.i, e.i]);
    scene.add(rings);
    pickables.push(rings);
    rings.userData.fish = true;
    nodeMeshes.push(rings);
  }

  function scanNodes(now) {
    const dirty = new Set();
    for (const e of nodeEntries) {
      const active = nodeActive(e.n, now);
      if (active === e.active) continue;
      e.active = active;
      for (const p of e.parts) { p.im.setMatrixAt(p.k, active ? p.m : HIDE); dirty.add(p.im); }
      e.alt.im.setMatrixAt(e.alt.k, active ? HIDE : e.alt.m);
      dirty.add(e.alt.im);
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

  function tool(kind, tier) {
    const g = new C.Group(), metal = TIER_COLORS[tier] || 0x9c9c9c, wood = 0x6b4a2b;
    const handle = len => { const h = cyl(0.025, 0.025, len, wood, 0, 0, len / 2 - 0.05, 5); h.rotation.x = Math.PI / 2; return h; };
    if (kind === 'axe') g.add(handle(0.55), box(0.04, 0.2, 0.14, metal, 0, 0.06, 0.45));
    if (kind === 'pickaxe') g.add(handle(0.55), box(0.04, 0.42, 0.06, metal, 0, 0, 0.47));
    if (kind === 'hammer') g.add(handle(0.4), box(0.1, 0.1, 0.18, 0x55555c, 0, 0, 0.36));
    if (kind === 'sword') g.add(box(0.05, 0.04, 0.12, wood, 0, 0, 0.02), box(0.18, 0.04, 0.04, metal, 0, 0, 0.09), box(0.06, 0.03, 0.62, metal, 0, 0, 0.42));
    if (kind === 'club') { const c = cyl(0.05, 0.12, 0.8, 0x5a3e24, 0, 0, 0.4, 6); c.rotation.x = Math.PI / 2; g.add(c); }
    if (kind === 'dagger') g.add(box(0.04, 0.03, 0.3, 0xaaaaaa, 0, 0, 0.18));
    if (kind === 'spear') { const s = cyl(0.025, 0.025, 1.4, wood, 0, 0, 0, 5); s.position.y = 0.4; g.add(s, cone(0.05, 0.16, 0xb0b0b8, 0, 1.18, 0, 4)); }
    if (kind === 'rod') {
      const r = cyl(0.015, 0.025, 1.3, 0x8a6a3a, 0, 0, 0, 5);
      r.rotation.x = Math.PI / 2 - 0.5; r.position.set(0, 0.3, 0.55);
      g.add(r);
    }
    return g;
  }

  function buildPlayer() {
    const a = humanoid({ tunic: 0x2f5d9e, skin: 0xe2b48c, legs: 0x5b4630, scale: 0.85 });
    a.hair = box(0.32, 0.1, 0.32, 0x5a3a1e, 0, 1.36, -0.01);
    a.inner.add(a.hair);
    a.helm = box(0.34, 0.16, 0.34, 0x9c9c9c, 0, 1.36, 0);
    a.inner.add(a.helm);
    a.shield = box(0.06, 0.42, 0.34, 0x9c9c9c, -0.09, -0.26, 0.05);
    a.armL.add(a.shield);
    a.tools = {};
    a.equipKey = '';
    a.vx = state.x; a.vz = state.y; a.rot = 0;
    a.g.position.set(state.x, 0, state.y);
    a.bar = hpBar();
    a.bar.g.position.y = a.height + 0.25;
    a.g.add(a.bar.g);
    scene.add(a.g);
    return a;
  }

  function setPlayerTool(kind, tier) {
    const key = kind ? `${kind}:${tier}` : '';
    if (player.toolKey === key) return;
    player.toolKey = key;
    player.hand.clear();
    if (kind) player.hand.add(tool(kind, tier));
  }

  function updatePlayerGear() {
    const eq = state.equip;
    const key = JSON.stringify(eq);
    if (key === player.equipKey) return;
    player.equipKey = key;
    const tierOf = id => (id ? ITEMS[id].tier : 0);
    player.body.material = mat(eq.body ? TIER_COLORS[tierOf(eq.body)] : 0x2f5d9e);
    player.helm.visible = !!eq.head;
    player.hair.visible = !eq.head;
    if (eq.head) player.helm.material = mat(TIER_COLORS[tierOf(eq.head)]);
    player.shield.visible = !!eq.shield;
    if (eq.shield) player.shield.material = mat(TIER_COLORS[tierOf(eq.shield)]);
  }

  function hpBar() {
    const g = new C.Group();
    const bg = new C.Sprite(new C.SpriteMaterial({ color: 0x3a0a08, depthTest: false }));
    const fg = new C.Sprite(new C.SpriteMaterial({ color: 0x4fc23a, depthTest: false }));
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

  function makeMonster(m) {
    let a;
    if (m.type === 'wolf') a = wolf();
    else if (m.type === 'goblin') {
      a = humanoid({ tunic: 0x6b4f2a, skin: 0x6fae4a, legs: 0x4a3a22, sleeve: 0x6fae4a, scale: 0.62 });
      a.head.add(cone(0.07, 0.2, 0x6fae4a, -0.19, 0.04, 0, 4), cone(0.07, 0.2, 0x6fae4a, 0.19, 0.04, 0, 4));
      a.head.children[a.head.children.length - 2].rotation.z = Math.PI / 2;
      a.head.children[a.head.children.length - 1].rotation.z = -Math.PI / 2;
      a.hand.add(tool('dagger'));
    } else if (m.type === 'bandit') {
      a = humanoid({ tunic: 0x7a2222, skin: 0xd9a77a, legs: 0x2b2b2b, sleeve: 0x4a1a1a, scale: 0.85 });
      a.head.add(box(0.34, 0.2, 0.34, 0x4a1414, 0, 0.1, -0.02));
      a.head.add(box(0.31, 0.08, 0.02, 0x2a0a0a, 0, -0.06, 0.155));
      a.hand.add(tool('sword', 2));
    } else {
      a = humanoid({ tunic: 0x5a4630, skin: 0x8b6fa3, legs: 0x4a3a2a, sleeve: 0x8b6fa3, scale: 1.35 });
      a.head.add(box(0.06, 0.08, 0.04, 0xf2ead0, -0.08, -0.12, 0.16), box(0.06, 0.08, 0.04, 0xf2ead0, 0.08, -0.12, 0.16));
      a.hand.add(tool('club'));
    }
    a.vx = m.x; a.vz = m.y; a.rot = Math.random() * 6; a.lunge = 0;
    a.g.position.set(m.x, 0, m.y);
    a.bar = hpBar();
    a.bar.g.position.y = a.height + 0.25;
    a.alert = makeLabel('!', { color: '#ff4a3a', size: 56, h: 0.45 });
    a.alert.position.y = a.height + 0.6;
    a.alert.visible = false;
    a.g.add(a.bar.g, a.alert);
    a.g.userData.monsterId = m.id;
    a.g.traverse(o => { o.userData.monsterId = m.id; });
    scene.add(a.g);
    pickables.push(a.g);
    return a;
  }

  function lerpAngle(a, b, t) {
    let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    return a + d * t;
  }

  // Move an actor's visual position toward its tile and animate limbs.
  function animateActor(a, tx, tz, acting, faceX, faceZ, dt, t) {
    const dx = tx - a.vx, dz = tz - a.vz, dist = Math.hypot(dx, dz);
    if (dist > 3) { a.vx = tx; a.vz = tz; }
    else { const k = Math.min(1, dt * 11); a.vx += dx * k; a.vz += dz * k; }
    const moving = dist > 0.04;
    let face = null;
    if (moving) face = Math.atan2(dx, dz);
    else if (faceX != null) face = Math.atan2(faceX - a.vx, faceZ - a.vz);
    if (face != null) a.rot = lerpAngle(a.rot, face, Math.min(1, dt * 12));
    a.g.rotation.y = a.rot;
    const lunge = a.lunge || 0;
    a.g.position.set(a.vx + Math.sin(a.rot) * lunge * 0.35, 0, a.vz + Math.cos(a.rot) * lunge * 0.35);
    if (a.lunge) a.lunge = Math.max(0, a.lunge - dt * 5);
    a.walk = (a.walk || 0) + (moving ? dt * 13 : 0);
    const sw = moving ? Math.sin(a.walk) * 0.7 : 0;
    a.inner.position.y = moving ? Math.abs(Math.sin(a.walk)) * 0.05 : 0;
    if (a.kind === 'wolf') {
      a.legs.forEach((l, k) => { l.rotation.x = (k === 0 || k === 3 ? sw : -sw); });
      return;
    }
    a.legL.rotation.x = sw; a.legR.rotation.x = -sw;
    a.armL.rotation.x = -sw * 0.6;
    a.armR.rotation.x = acting ? -1.3 + Math.sin(t * 9) * 0.9 : (lunge > 0 ? -1.5 * lunge : sw * 0.6);
  }

  // ------------------------------------------------------------ town & sites
  function addSmoke(x, y, z) {
    for (let k = 0; k < 5; k++) {
      const p = mesh(geo('IcosahedronGeometry', 0.14, 0), new C.MeshLambertMaterial({ color: 0xb8b8b8, transparent: true, opacity: 0.6 }), x, y, z, false);
      smoke.push({ p, x, y, z, phase: k / 5 });
      scene.add(p);
    }
  }

  function house(w, d, wallC, roofC) {
    const g = new C.Group();
    g.add(box(w, 0.9, d, wallC, 0, 0.45, 0));
    const roof = cone(Math.max(w, d) * 0.78, 0.7, roofC, 0, 1.25, 0, 4);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    g.add(roof, box(0.24, 0.45, 0.04, 0x4a3220, 0, 0.23, d / 2 + 0.01));
    return g;
  }

  const STATION_MODELS = {
    market: () => {
      const g = new C.Group();
      for (const [x, z] of [[-0.45, -0.4], [0.45, -0.4], [-0.45, 0.4], [0.45, 0.4]]) g.add(cyl(0.04, 0.04, 1.2, 0x6b4a2b, x, 0.6, z, 5));
      g.add(box(1.0, 0.4, 0.5, 0x7a5232, 0, 0.2, 0.15));
      for (let k = 0; k < 4; k++) g.add(box(0.27, 0.06, 1.0, k % 2 ? 0xf2ead8 : 0xc0392b, -0.4 + k * 0.27, 1.22, 0));
      g.add(cyl(0.12, 0.14, 0.08, 0xe8c547, 0.2, 0.44, 0.2, 8), box(0.24, 0.2, 0.24, 0x9a7444, -0.25, 0.5, 0.15));
      return g;
    },
    hall: () => {
      const g = house(1.3, 1.1, 0xd8c9a3, 0x8a2f2a);
      g.add(cyl(0.03, 0.03, 1.4, 0x5a3a1e, 0.55, 1.6, 0.4, 5));
      const flag = box(0.04, 0.26, 0.4, 0xe8c547, 0.55, 2.15, 0.6);
      g.add(flag);
      return g;
    },
    furnace: () => {
      const g = new C.Group();
      g.add(box(0.95, 0.85, 0.85, 0x5f5953, 0, 0.42, 0), mesh(geo('BoxGeometry', 0.4, 0.3, 0.04), glow(0xff7a1a), 0, 0.3, 0.43, false));
      g.add(cyl(0.14, 0.17, 0.8, 0x4c4741, 0.2, 1.2, -0.2, 6));
      return g;
    },
    anvil: () => {
      const g = new C.Group();
      g.add(cyl(0.25, 0.28, 0.4, 0x6b4a2b, 0, 0.2, 0, 7), box(0.2, 0.15, 0.2, 0x3a3a40, 0, 0.47, 0), box(0.5, 0.14, 0.22, 0x45454c, 0, 0.6, 0));
      const horn = cone(0.07, 0.22, 0x45454c, 0.34, 0.6, 0, 5);
      horn.rotation.z = -Math.PI / 2;
      g.add(horn);
      return g;
    },
    sawmill: () => {
      const g = new C.Group();
      g.add(box(1.0, 0.08, 0.45, 0x8a6338, 0, 0.5, 0));
      for (const [x, z] of [[-0.42, -0.17], [0.42, -0.17], [-0.42, 0.17], [0.42, 0.17]]) g.add(box(0.07, 0.5, 0.07, 0x6b4a2b, x, 0.25, z));
      const log = cyl(0.13, 0.13, 0.9, 0xa07a4a, 0, 0.67, 0, 7);
      log.rotation.z = Math.PI / 2;
      g.add(log, box(0.02, 0.3, 0.4, 0xc8ccd2, 0.1, 0.78, 0));
      return g;
    },
    range: () => {
      const g = new C.Group();
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2;
        g.add(mesh(geo('DodecahedronGeometry', 0.1, 0), mat(0x77726b), Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32));
      }
      const l1 = cyl(0.05, 0.05, 0.5, 0x5a3a1e, 0, 0.08, 0, 5), l2 = l1.clone();
      l1.rotation.z = Math.PI / 2; l2.rotation.x = Math.PI / 2;
      const f = mesh(geo('ConeGeometry', 0.17, 0.45, 6), glow(0xffa22a), 0, 0.3, 0, false);
      flames.push(f);
      g.add(l1, l2, f);
      return g;
    },
  };

  function buildStations() {
    for (const [i, id] of stations) {
      const x = i % W, y = (i - x) / W;
      const g = STATION_MODELS[id]();
      g.position.set(x, 0, y);
      const label = makeLabel(STATIONS[id].name, { color: '#ffe9a8', h: 0.34 });
      label.position.y = 2.0;
      g.add(label);
      g.traverse(o => { o.userData.tile = i; });
      scene.add(g);
      pickables.push(g);
      if (id === 'furnace') { addSmoke(x + 0.2, 1.65, y - 0.2); addLight(x, 0.8, y + 0.7, 0xff7a1a); }
      if (id === 'range') addLight(x, 0.8, y, 0xffa22a);
    }
  }

  const lights = [];
  function addLight(x, y, z, color) {
    const l = new C.PointLight(color, 0.9, 4.5, 2);
    l.position.set(x, y, z);
    lights.push(l);
    scene.add(l);
  }

  function worker(tunic, toolKind) {
    const a = humanoid({ tunic, skin: 0xd9a77a, legs: 0x4a3a2a, scale: 0.7 });
    if (toolKind) a.hand.add(tool(toolKind, 1));
    return a;
  }

  function siteModel(id) {
    const g = new C.Group(), actors = [];
    const camp = !!CAMPS[id];
    const b = camp ? state.empire.camps[id] : state.empire.works[id];
    const def = camp ? CAMPS[id] : WORKS[id];
    if (!b.built) {
      if (camp) {
        g.add(cyl(0.04, 0.04, 1.1, 0x6b4a2b, 0, 0.55, 0, 5), box(0.6, 0.3, 0.04, 0xb08850, 0, 0.95, 0.04));
        for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) g.add(cyl(0.03, 0.03, 0.4, 0x8a6338, x, 0.2, z, 4));
      } else {
        g.add(box(1.0, 0.1, 1.0, 0x8d877c, 0, 0.05, 0), box(0.3, 0.2, 0.2, 0x8d877c, -0.3, 0.2, -0.3));
      }
    } else if (id === 'lumber' || id === 'mine') {
      const tent = cone(0.6, 0.9, id === 'lumber' ? 0xc9b48a : 0x9a8a6a, -0.25, 0.45, -0.2, 4);
      tent.rotation.y = Math.PI / 4;
      g.add(tent);
      if (id === 'lumber') {
        for (let k = 0; k < 3; k++) { const l = cyl(0.09, 0.09, 0.7, 0x8a6338, 0.35, 0.09 + (k === 2 ? 0.16 : 0), 0.15 + (k === 2 ? 0 : (k - 0.5) * 0.2), 6); l.rotation.x = Math.PI / 2; g.add(l); }
      } else {
        g.add(box(0.45, 0.25, 0.3, 0x55555c, 0.35, 0.22, 0.2), cone(0.25, 0.3, 0xc27a3e, 0.35, 0.45, 0.2, 5));
      }
    } else if (id === 'fishery') {
      g.add(house(0.8, 0.7, 0x9a7a52, 0x5a4a3a));
      for (let k = 0; k < 3; k++) g.add(box(0.5, 0.06, 0.4, 0x8a6338, 0.2, 0.08, 0.6 + k * 0.4));
    } else {
      const colors = { sawmill: [0xc9a46a, 0x6b4a2b], smelter: [0x7a746c, 0x4a3a3a], smokehouse: [0x8a6a4a, 0x4a3020], armoury: [0x8c8c94, 0x3a3a5a] }[id];
      const s = 0.8 + b.level * 0.08;
      const h = house(1.1 * s, 1.0 * s, colors[0], colors[1]);
      g.add(h);
      if (id !== 'sawmill') { g.add(cyl(0.1, 0.12, 0.7, 0x4c4741, 0.3, 1.3, -0.25, 6)); }
      else { const disc = cyl(0.35, 0.35, 0.04, 0xc8ccd2, 0.65, 0.45, 0, 12); disc.rotation.z = Math.PI / 2; g.add(disc); }
    }
    if (b.built && camp) {
      const toolKind = { lumber: 'axe', mine: 'pickaxe', fishery: 'rod' }[id];
      for (let k = 0; k < Math.min(b.workers, 3); k++) {
        const a = worker(0x8a6a3a, toolKind);
        a.g.position.set(-0.6 + k * 0.5, 0, 0.75);
        a.g.rotation.y = Math.PI;
        a.working = true; a.phase = k;
        g.add(a.g); actors.push(a);
      }
      for (let k = 0; k < Math.min(b.guards.length, 3); k++) {
        const a = worker(0x5a5f6a, 'spear');
        a.body.add(box(0.3, 0.32, 0.02, 0xa02a2a, 0, 0, 0.135));
        a.g.position.set(-0.7 + k * 0.6, 0, -0.85);
        a.g.rotation.y = Math.PI;
        g.add(a.g); actors.push(a);
      }
    }
    const label = makeLabel(b.built ? `${def.name} Lv${b.level}` : `${def.name} (empty plot)`, { color: b.built ? '#ffe9a8' : '#d8d0c0', h: 0.32 });
    label.position.y = 2.0;
    g.add(label);
    return { g, actors };
  }

  function scanSites() {
    for (const [i, id] of sites) {
      const b = CAMPS[id] ? state.empire.camps[id] : state.empire.works[id];
      const sig = `${b.built}:${b.level}:${b.workers}:${b.guards ? b.guards.length : 0}`;
      const cur = siteObjs[id];
      if (cur && cur.sig === sig) continue;
      if (cur) {
        scene.remove(cur.g);
        pickables.splice(pickables.indexOf(cur.g), 1);
        cur.g.traverse(o => { if (o.isSprite) disposeSprite(o); });
        for (const s of cur.smoke) { scene.remove(s.p); smoke.splice(smoke.indexOf(s), 1); }
      }
      const x = i % W, y = (i - x) / W;
      const { g, actors } = siteModel(id);
      g.position.set(x, 0, y);
      g.traverse(o => { o.userData.tile = i; });
      scene.add(g);
      pickables.push(g);
      const before = smoke.length;
      if (b.built && WORKS[id] && id !== 'sawmill') addSmoke(x + 0.3, 1.75, y - 0.25);
      siteObjs[id] = { g, actors, sig, smoke: smoke.slice(before) };
    }
  }

  // ------------------------------------------------------------ effects
  function floater(x, y, text, o, height = 1.6) {
    const sp = makeLabel(text, o);
    sp.position.set(x + (Math.random() - 0.5) * 0.3, height, y);
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

  function marker(color, opacity) {
    const g = new C.RingGeometry(0.4, 0.5, 4, 1, Math.PI / 4);
    g.rotateX(-Math.PI / 2);
    const m = new C.Mesh(g, new C.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    m.renderOrder = 5;
    m.visible = false;
    scene.add(m);
    return m;
  }

  // ------------------------------------------------------------ picking & input
  function tileFromHit(hit) {
    let o = hit.object;
    if (o.isInstancedMesh && o.userData.tiles) return o.userData.tiles[hit.instanceId];
    while (o) {
      if (o.userData.monsterId != null) {
        const m = monsters.find(mm => mm.id === o.userData.monsterId);
        return m ? idx(m.x, m.y) : null;
      }
      if (o.userData.tile != null) return o.userData.tile;
      o = o.parent;
    }
    return null;
  }

  function pick(ndc) {
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      const t = tileFromHit(h);
      if (t != null) return [t % W, Math.floor(t / W)];
    }
    const p = new C.Vector3();
    if (!raycaster.ray.intersectPlane(groundPlane, p)) return null;
    return [Math.round(p.x), Math.round(p.z)];
  }

  function ndcOf(e) {
    const r = renderer.domElement.getBoundingClientRect();
    return new C.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  function setupInput() {
    const cv = renderer.domElement;
    cv.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') { pointer = ndcOf(e); pointerMoved = true; } });
    cv.addEventListener('pointerleave', () => { pointer = null; hoverText = ''; hoverMark.visible = false; });
    cv.addEventListener('click', e => {
      const t = pick(ndcOf(e));
      if (t) { clickTile(t[0], t[1]); uiDirty = true; }
    });
    cv.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * (e.deltaY > 0 ? 1.1 : 0.9)); }, { passive: false });
    const zi = document.getElementById('zoom-in'), zo = document.getElementById('zoom-out');
    if (zi) zi.addEventListener('click', () => setZoom(zoom * 0.8));
    if (zo) zo.addEventListener('click', () => setZoom(zoom * 1.25));
  }
  function setZoom(z) { zoom = clamp(z, 6, 34); }

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

    if (now - lastNodeScan > 150) { lastNodeScan = now; scanNodes(now); }
    if (now - lastSiteScan > 500) { lastSiteScan = now; scanSites(); }

    // Player
    updatePlayerGear();
    let faceX = null, faceZ = null, acting = false;
    if (action) {
      acting = true;
      if (action.type === 'gather') {
        const n = nodes.get(action.i), r = RESOURCES[n.res];
        faceX = action.i % W; faceZ = Math.floor(action.i / W);
        const tl = bestTool(r.tool);
        setPlayerTool(r.tool === 'rod' ? 'rod' : r.tool, tl ? ITEMS[tl].tier : 0);
        if (r.tool === 'rod') acting = false;
      } else if (action.type === 'combat') {
        const m = monsters.find(mm => mm.id === action.id);
        if (m) { faceX = m.x; faceZ = m.y; }
        acting = !!m && Math.abs(m.x - state.x) + Math.abs(m.y - state.y) === 1;
        setPlayerTool(state.equip.weapon ? 'sword' : null, state.equip.weapon ? ITEMS[state.equip.weapon].tier : 0);
      } else if (action.type === 'craft') setPlayerTool('hammer', 0);
    } else setPlayerTool(state.equip.weapon ? 'sword' : null, state.equip.weapon ? ITEMS[state.equip.weapon].tier : 0);
    animateActor(player, state.x, state.y, acting, faceX, faceZ, dt, t);
    setBar(player.bar, state.hp / maxHp(), state.hp < maxHp());

    // Monsters
    const live = new Set();
    for (const m of monsters) {
      if (m.hp <= 0) continue;
      live.add(m.id);
      let a = monObjs.get(m.id);
      if (!a) { a = makeMonster(m); monObjs.set(m.id, a); }
      const reach = zoom * 1.7 + 6;
      const near = Math.abs(m.x - player.vx) < reach && Math.abs(m.y - player.vz) < reach;
      a.g.visible = near;
      if (!near) { a.vx = m.x; a.vz = m.y; continue; }
      const adj = Math.abs(m.x - state.x) + Math.abs(m.y - state.y) <= 1;
      animateActor(a, m.x, m.y, false, adj || m.aggro ? player.vx : null, player.vz, dt, t);
      const def = MONSTERS[m.type];
      setBar(a.bar, m.hp / def.hp, m.hp < def.hp);
      a.alert.visible = m.aggro;
    }
    for (const [id, a] of monObjs) {
      if (live.has(id)) continue;
      scene.remove(a.g);
      pickables.splice(pickables.indexOf(a.g), 1);
      a.g.traverse(o => { if (o.isSprite) disposeSprite(o); });
      monObjs.delete(id);
    }

    // Camp workers
    for (const id in siteObjs) for (const a of siteObjs[id].actors) {
      if (a.working) a.armR.rotation.x = -1.2 + Math.sin(t * 5 + a.phase * 2) * 0.8;
    }

    // Ambient animation
    waterTex.offset.set(t * 0.02, t * 0.013);
    const rings = nodeMeshes[nodeMeshes.length - 1];
    const m4 = new C.Matrix4();
    for (const r of fishRings) {
      const p = (t * 0.55 + r.phase) % 1;
      const s = 0.5 + p * 1.6;
      rings.setMatrixAt(r.k, m4.makeScale(s, 1, s).setPosition(r.x, 0.06, r.y));
    }
    rings.instanceMatrix.needsUpdate = true;
    for (const f of flames) f.scale.set(1, 0.8 + Math.sin(t * 17 + f.userData.seed) * 0.15 + Math.random() * 0.1, 1);
    for (const l of lights) l.intensity = 0.8 + Math.sin(t * 13 + l.userData.seed) * 0.12 + Math.random() * 0.08;
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

    // Markers
    if (walkTarget) {
      walkMark.visible = true;
      walkMark.position.set(walkTarget.x, 0.05, walkTarget.y);
      walkMark.scale.setScalar(0.9 + Math.sin(t * 8) * 0.1);
    } else walkMark.visible = false;
    const tgt = action && action.type === 'combat' ? monObjs.get(action.id) : null;
    targetMark.visible = !!tgt;
    if (tgt) targetMark.position.set(tgt.vx, 0.05, tgt.vz);

    // Hover picking, throttled
    if (pointer && pointerMoved && now - lastPick > 80) {
      lastPick = now; pointerMoved = false;
      const tl = pick(pointer);
      if (tl) {
        hoverText = describe(tl[0], tl[1]);
        hoverMark.visible = true;
        hoverMark.position.set(tl[0], 0.04, tl[1]);
      }
    }

    // Camera follows the player
    const k = Math.min(1, dt * 6);
    camX += (player.vx - camX) * k;
    camZ += (player.vz - camZ) * k;
    camera.position.set(camX, zoom * 1.05, camZ + zoom * 0.6);
    camera.lookAt(camX, 0, camZ - 0.5);
    scene.fog.near = zoom * 1.6;
    scene.fog.far = zoom * 3.6 + 10;
    sun.position.set(camX - 10, 26, camZ + 12);
    sun.target.position.set(camX, 0, camZ);
    const sc = sun.shadow.camera, ext = zoom * 1.5 + 6;
    if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix(); }

    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ public
  function init(container) {
    view = container;
    const mobile = window.matchMedia('(max-width: 860px)').matches;
    renderer = new C.WebGLRenderer({ antialias: !mobile });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = C.PCFSoftShadowMap;
    view.prepend(renderer.domElement);

    scene = new C.Scene();
    scene.background = new C.Color(SKY);
    scene.fog = new C.Fog(SKY, 25, 60);
    camera = new C.PerspectiveCamera(45, 1, 0.5, 200);

    scene.add(new C.HemisphereLight(0xdfefff, 0x4a5a3a, 0.75));
    sun = new C.DirectionalLight(0xfff1d6, 0.85);
    sun.castShadow = true;
    sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);

    buildTerrain();
    buildNodes();
    buildStations();
    scanSites();
    player = buildPlayer();
    camX = state.x; camZ = state.y;
    hoverMark = marker(0xffffff, 0.55);
    walkMark = marker(0xffe14a, 0.9);
    targetMark = marker(0xff3a2a, 0.9);
    flames.forEach((f, k) => { f.userData.seed = k; });
    lights.forEach((l, k) => { l.userData.seed = k * 1.7; });
    // Instanced meshes span the whole map, so bounds-based culling would wrongly hide them.
    scene.traverse(o => { if (o.isInstancedMesh) o.frustumCulled = false; });

    setupInput();
    new ResizeObserver(resize).observe(view);
    resize();
  }

  function start() { requestAnimationFrame(frame); }

  return { init, start };
})();
