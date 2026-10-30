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
  const STREAM_R = 64;
  const TIER_COLORS = [0x8a8a8a, 0xc77a3a, 0x9c9c9c, 0xd2dae4, 0x8f7bff];

  // ------------------------------------------------------------ helpers
  const HIDE = new C.Matrix4().makeTranslation(0, -1000, 0);
  const rnd = (i, k) => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); };
  const gh = (x, y) => groundHeight(x, y);
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
    const ground = new C.Mesh(g, new C.MeshPhongMaterial({ vertexColors: true, flatShading: true, shininess: 0 }));
    ground.receiveShadow = true;
    scene.add(ground);

    waterTex = waterTexture();
    waterTex.repeat.set(W / 3, H / 3);
    const wg = new C.PlaneGeometry(W + 40, H + 40);
    wg.rotateX(-Math.PI / 2);
    const water = new C.Mesh(wg, new C.MeshPhongMaterial({ color: 0x4f9fd9, map: waterTex, transparent: true, opacity: 0.82, shininess: 80, specular: 0x88bbee }));
    water.position.set(W / 2 - 0.5, -0.04, H / 2 - 0.5);
    water.receiveShadow = true;
    scene.add(water);

    // Town walls, bridges and gate torches.
    const walls = [], bridges = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = terrain[idx(x, y)];
      if (t === T.WALL) walls.push([x, y]);
      if (t === T.BRIDGE) bridges.push([x, y]);
    }
    const wall = new C.InstancedMesh(geo('BoxGeometry', 1, 1.6, 1), mat(0x8c867a), walls.length);
    const cren = new C.InstancedMesh(geo('BoxGeometry', 0.5, 0.3, 1.02), mat(0x7d776c), walls.length);
    walls.forEach(([x, y], k) => {
      const h = tileH[idx(x, y)];
      wall.setMatrixAt(k, new C.Matrix4().makeTranslation(x, h + 0.7, y));
      cren.setMatrixAt(k, (x + y) % 2 ? new C.Matrix4().makeTranslation(x, h + 1.65, y) : HIDE);
    });
    wall.castShadow = cren.castShadow = wall.receiveShadow = true;
    scene.add(wall, cren);
    const d = TOWN_DEFS.ironhold;
    for (const [x, y] of [[d.x - d.hw, d.y - d.hh], [d.x + d.hw, d.y - d.hh], [d.x - d.hw, d.y + d.hh], [d.x + d.hw, d.y + d.hh]]) {
      const h = tileH[idx(x, y)];
      scene.add(cyl(0.8, 0.85, 2.6, 0x8a8478, x, h + 1.3, y, 8), cone(1.0, 1.1, 0x7a3530, x, h + 3.15, y, 8));
    }
    const plank = new C.InstancedMesh(geo('BoxGeometry', 1.0, 0.12, 1.0), mat(0x8a6338), bridges.length);
    const rail = new C.InstancedMesh(geo('BoxGeometry', 0.1, 0.35, 1.0), mat(0x6b4a2b), bridges.length * 2);
    bridges.forEach(([x, y], k) => {
      plank.setMatrixAt(k, new C.Matrix4().makeTranslation(x, 0.1, y));
      const horiz = terrain[idx(x - 1, y)] === T.BRIDGE || terrain[idx(x + 1, y)] === T.BRIDGE;
      for (const s of [-1, 1]) {
        const m = new C.Matrix4().makeTranslation(horiz ? x : x + s * 0.48, 0.3, horiz ? y + s * 0.48 : y);
        if (horiz) m.multiply(new C.Matrix4().makeRotationY(Math.PI / 2));
        rail.setMatrixAt(k * 2 + (s > 0 ? 1 : 0), m);
      }
    });
    plank.castShadow = true;
    scene.add(plank, rail);
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

  // ------------------------------------------------------------ resource nodes (streamed around the player)
  const ORE = { copper: [0x8a6f5a, 0xff8c3a], iron: [0x7d7570, 0xeadbcc], coal: [0x55524e, 0x141416] };
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
      case 'copper': case 'iron': case 'coal': return [
        { g: geo('DodecahedronGeometry', 0.45, 0), c: ORE[res][0], y: 0.22, sy: 0.75, vary: 1 },
        { g: geo('OctahedronGeometry', 0.12, 0), c: ORE[res][1], y: 0.42, x: 0.16, z: 0.12 },
        { g: geo('OctahedronGeometry', 0.1, 0), c: ORE[res][1], y: 0.34, x: -0.2, z: -0.05 }];
      case 'bush': return [
        { g: geo('IcosahedronGeometry', 0.34, 0), c: 0x3d7a35, y: 0.28, sy: 0.8, vary: 1 },
        { g: geo('IcosahedronGeometry', 0.05, 0), c: 0xc2342a, y: 0.42, x: 0.15, z: 0.18 },
        { g: geo('IcosahedronGeometry', 0.05, 0), c: 0xc2342a, y: 0.36, x: -0.2, z: 0.1 }];
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
        const im = new C.InstancedMesh(p.g, new C.MeshPhongMaterial({ color: 0xffffff, flatShading: true, shininess: 0 }), counts[res]);
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
        im.setColorAt(im.count, new C.Color(p.c).offsetHSL(0, 0, p.vary ? (rnd(i, 10) - 0.5) * 0.1 : 0));
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
    a.bar = hpBar();
    a.bar.g.position.y = a.height + 0.3;
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
    const eq = state.equip, key = JSON.stringify(eq);
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

  function makeMonster(m) {
    let a;
    if (m.type === 'wolf') a = wolf();
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

  // ------------------------------------------------------------ town models
  function house(w, d, wallC, roofC, chimney) {
    const g = new C.Group();
    g.add(box(w, 1.0, d, wallC, 0, 0.5, 0));
    const roof = cone(Math.max(w, d) * 0.8, 0.8, roofC, 0, 1.4, 0, 4);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
    g.add(roof, box(0.26, 0.5, 0.04, 0x4a3220, 0, 0.25, d / 2 + 0.01));
    g.add(box(0.22, 0.2, 0.04, 0xf2d27a, w * 0.28, 0.6, d / 2 + 0.01));
    if (chimney) g.add(box(0.2, 0.6, 0.2, 0x6b625a, w * 0.25, 1.6, -d * 0.2));
    return g;
  }

  function townsfolk(color) {
    const a = humanoid({ tunic: color, skin: 0xe0b08a, legs: 0x4a3a2a, scale: 0.8 });
    a.idle = true;
    return a;
  }

  function buildTowns() {
    const styles = {
      ironhold: [0xd8c9a3, 0x8a2f2a], stonedeep: [0x8a8680, 0x4a4a52], saltmere: [0xe8e0d0, 0x3a6a8a],
      thornwood: [0x8a6a42, 0x3a5a2a], ratsnest: [0x6a5a4a, 0x3a2a2a],
    };
    for (const h of townHouses) {
      const [wc, rc] = styles[h.town];
      const g = house(1.7, 1.6, wc, rc, rnd(h.x, h.y) < 0.5);
      g.position.set(h.x + 0.5, tileH[idx(h.x, h.y)], h.y + 0.5);
      g.rotation.y = h.rot * Math.PI / 2;
      scene.add(g);
    }
    for (const [i, svc] of services) {
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
    // Town names and a few people milling about.
    const colors = [0x3a6a9e, 0x9e5a3a, 0x5a8a3a, 0x8a3a6a, 0xc0a040];
    for (const id in TOWN_DEFS) {
      const d = TOWN_DEFS[id];
      const label = makeLabel(TOWNS[id].name, { color: '#fff4c8', size: 56, h: 0.9 });
      label.position.set(d.x, d.h + 5, d.y - d.hh + 1);
      scene.add(label);
      for (let k = 0; k < 4; k++) {
        const a = townsfolk(colors[(k + id.length) % colors.length]);
        const px = d.x + Math.round((rnd(k, d.x) - 0.5) * (d.hw - 2) * 2), py = d.y + 2 + Math.round((rnd(d.y, k) - 0.5) * (d.hh - 1) * 2);
        if (townBlocks.has(idx(px, py)) || services.has(idx(px, py))) continue;
        a.g.position.set(px, tileH[idx(px, py)], py);
        a.g.rotation.y = rnd(k, 3) * 6;
        scene.add(a.g);
        actors.push(a);
      }
    }
  }

  // ------------------------------------------------------------ player structures
  let previewing = false; // the build preview gets no smoke or flames
  function addSmoke(group, x, y, z) {
    if (previewing) return;
    for (let k = 0; k < 5; k++) {
      const p = mesh(geo('IcosahedronGeometry', 0.14, 0), new C.MeshLambertMaterial({ color: 0xb8b8b8, transparent: true, opacity: 0.6 }), x, y, z, false);
      smoke.push({ p, x, y, z, phase: k / 5, group });
      group.add(p);
    }
  }
  function flame(group, x, y, z, s = 1) {
    if (previewing) return;
    const f = mesh(geo('ConeGeometry', 0.17 * s, 0.45 * s, 6), glow(0xffa22a), x, y, z, false);
    f.userData.seed = Math.random() * 10;
    flames.push(f);
    group.add(f);
  }

  const STRUCT_MODELS = {
    workbench: g => {
      g.add(box(1.0, 0.1, 0.55, 0x9a7444, 0, 0.6, 0));
      for (const [x, z] of [[-0.42, -0.2], [0.42, -0.2], [-0.42, 0.2], [0.42, 0.2]]) g.add(box(0.08, 0.6, 0.08, 0x6b4a2b, x, 0.3, z));
      g.add(box(0.3, 0.06, 0.12, 0x55555c, -0.2, 0.68, 0), box(0.06, 0.06, 0.3, 0x6b4a2b, 0.2, 0.68, 0.05));
    },
    campfire: g => {
      for (let k = 0; k < 7; k++) {
        const a = k / 7 * Math.PI * 2;
        g.add(mesh(geo('DodecahedronGeometry', 0.1, 0), mat(0x77726b), Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32));
      }
      const l1 = cyl(0.05, 0.05, 0.5, 0x5a3a1e, 0, 0.08, 0, 5), l2 = l1.clone();
      l1.rotation.z = Math.PI / 2; l2.rotation.x = Math.PI / 2;
      g.add(l1, l2);
      flame(g, 0, 0.3, 0);
      addSmoke(g, 0, 0.6, 0);
    },
    sawbench: g => {
      g.add(box(1.0, 0.08, 0.45, 0x8a6338, 0, 0.5, 0));
      for (const [x, z] of [[-0.42, -0.17], [0.42, -0.17], [-0.42, 0.17], [0.42, 0.17]]) g.add(box(0.07, 0.5, 0.07, 0x6b4a2b, x, 0.25, z));
      const log = cyl(0.13, 0.13, 0.9, 0xa07a4a, 0, 0.67, 0, 7);
      log.rotation.z = Math.PI / 2;
      g.add(log, box(0.02, 0.3, 0.4, 0xc8ccd2, 0.1, 0.78, 0));
    },
    storehouse: g => {
      g.add(box(1.8, 1.2, 1.6, 0x9a7444, 0, 0.6, 0));
      const roof = cone(1.35, 0.8, 0x6b3a2a, 0, 1.6, 0, 4);
      roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.9);
      g.add(roof, box(0.7, 0.8, 0.04, 0x5a3a20, 0, 0.4, 0.81));
      g.add(box(0.35, 0.35, 0.35, 0xb08850, 0.95, 0.18, 0.75), box(0.3, 0.3, 0.3, 0xa07a40, 1.0, 0.5, 0.75));
    },
    furnace: g => {
      g.add(box(0.95, 0.85, 0.85, 0x5f5953, 0, 0.42, 0), mesh(geo('BoxGeometry', 0.4, 0.3, 0.04), glow(0xff7a1a), 0, 0.3, 0.43, false));
      g.add(cyl(0.14, 0.17, 0.8, 0x4c4741, 0.2, 1.2, -0.2, 6));
      addSmoke(g, 0.2, 1.65, -0.2);
    },
    house: g => {
      const h = house(1.8, 1.6, 0xd8c9a3, 0x8a4a2a, true);
      g.add(h);
      addSmoke(g, 0.45, 2.0, -0.32);
    },
    anvil: g => {
      g.add(cyl(0.25, 0.28, 0.4, 0x6b4a2b, 0, 0.2, 0, 7), box(0.2, 0.15, 0.2, 0x3a3a40, 0, 0.47, 0), box(0.5, 0.14, 0.22, 0x45454c, 0, 0.6, 0));
      const horn = cone(0.07, 0.22, 0x45454c, 0.34, 0.6, 0, 5);
      horn.rotation.z = -Math.PI / 2;
      g.add(horn);
    },
    lumber_camp: g => {
      const tent = cone(0.8, 1.1, 0xc9b48a, -0.4, 0.55, -0.3, 4);
      tent.rotation.y = Math.PI / 4;
      g.add(tent);
      for (let k = 0; k < 3; k++) {
        const l = cyl(0.11, 0.11, 0.9, 0x8a6338, 0.45, 0.11 + (k === 2 ? 0.19 : 0), 0.3 + (k === 2 ? 0 : (k - 0.5) * 0.24), 6);
        l.rotation.x = Math.PI / 2;
        g.add(l);
      }
      g.add(cyl(0.2, 0.22, 0.3, 0x7a5a3a, 0.4, 0.15, -0.5, 7));
    },
    mine: g => {
      g.add(box(1.6, 1.1, 0.9, 0x6a645c, 0, 0.55, -0.3), box(0.8, 0.8, 0.05, 0x141414, 0, 0.4, 0.16));
      g.add(box(0.12, 0.95, 0.12, 0x6b4a2b, -0.45, 0.47, 0.2), box(0.12, 0.95, 0.12, 0x6b4a2b, 0.45, 0.47, 0.2), box(1.05, 0.12, 0.14, 0x6b4a2b, 0, 0.95, 0.2));
      g.add(box(0.4, 0.25, 0.3, 0x55555c, 0.55, 0.2, 0.6), cone(0.25, 0.3, 0xb07a4a, -0.55, 0.15, 0.6, 5));
    },
    dock: g => {
      const hut = house(1.0, 0.9, 0x9a7a52, 0x5a4a3a);
      hut.position.set(-0.35, 0, -0.35);
      g.add(hut);
      for (let k = 0; k < 4; k++) g.add(box(0.5, 0.06, 0.38, 0x8a6338, 0.45, 0.12, -0.6 + k * 0.4));
      g.add(box(0.6, 0.5, 0.05, 0x6b4a2b, 0.4, 0.35, 0.75));
    },
    guard_tower: g => {
      g.add(cyl(0.42, 0.5, 2.4, 0x8a8478, 0, 1.2, 0, 8), cyl(0.58, 0.58, 0.3, 0x7a746c, 0, 2.55, 0, 8), cone(0.6, 0.8, 0x7a3530, 0, 3.1, 0, 8));
      g.add(cyl(0.02, 0.02, 0.8, 0x5a3a1e, 0, 3.7, 0, 4), box(0.03, 0.22, 0.36, 0xc0392b, 0, 3.95, 0.18));
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
    const def = STRUCTS[s.type], g = new C.Group(), crew = [];
    if (!s.level) {
      g.add(box(def.size - 0.1, 0.1, def.size - 0.1, 0x9a8a6a, 0, 0.05, 0));
      scaffold(g, def.size);
    } else {
      STRUCT_MODELS[s.type](g);
      if (s.pending) scaffold(g, def.size);
      const toolKind = { lumber_camp: 'axe', mine: 'pickaxe', dock: 'rod', sawbench: 'hammer', furnace: 'hammer', anvil: 'hammer', campfire: null }[s.type];
      for (let k = 0; k < Math.min(s.workers || 0, 3); k++) {
        const a = worker(0x8a6a3a, toolKind);
        const off = def.size * 0.5 + 0.5;
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
          a.g.position.set(Math.cos(ang) * 0.9, 0, Math.sin(ang) * 0.9);
          a.g.rotation.y = ang + Math.PI / 2;
          g.add(a.g); crew.push(a);
        });
      }
    }
    const text = s.pending ? `${def.name} ${Math.floor(s.work / workNeeded(s) * 100)}%` : `${def.name}${s.level > 1 ? ' Lv' + s.level : ''}`;
    const label = makeLabel(text, { color: s.pending ? '#ffd27a' : '#ffe9a8', h: 0.3 });
    label.position.y = def.size > 1 ? 2.6 : 1.7;
    g.add(label);
    return { g, crew };
  }

  function scanStructs() {
    const live = new Set();
    for (const s of state.structs) {
      live.add(s.id);
      const sig = `${s.level}:${s.pending}:${s.pending ? Math.floor(s.work / workNeeded(s) * 20) : 0}:${s.workers}:${s.guards ? s.guards.length : 0}`;
      const cur = structObjs.get(s.id);
      if (cur && cur.sig === sig) continue;
      if (cur) removeStruct(s.id);
      const def = STRUCTS[s.type];
      const { g, crew } = structModel(s);
      const cx = s.x + (def.size - 1) / 2, cy = s.y + (def.size - 1) / 2;
      let h = 0;
      for (const [x, y] of footprint(s.x, s.y, def.size)) h = Math.max(h, tileH[idx(x, y)]);
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
    o.g.traverse(x => { if (x.isSprite) disposeSprite(x); });
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
        STRUCT_MODELS[buildMode.type](ghost);
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

    if (Math.abs(player.vx - streamX) > 12 || Math.abs(player.vz - streamY) > 12) streamNodes(now);
    if (now - lastNodeScan > 150) { lastNodeScan = now; scanNodes(now); }
    if (now - lastStructScan > 300) { lastStructScan = now; scanStructs(); }
    updateGhost();

    // Player
    updatePlayerGear();
    const jump = Math.hypot(state.px - player.vx, state.py - player.vz) > 3;
    player.vx = state.px; player.vz = state.py;
    if (jump) { camX = player.vx; camZ = player.vz; }
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
    player.g.position.set(player.vx, gh(player.vx, player.vz), player.vz);
    player.g.rotation.y = player.rot;
    animateLimbs(player, moving, acting && !moving, dt, t, keys.has('shift') ? 17 : 13);
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
    }
    for (const [id, a] of monObjs) {
      if (live.has(id)) continue;
      scene.remove(a.g);
      pickables.splice(pickables.indexOf(a.g), 1);
      a.g.traverse(o => { if (o.isSprite) disposeSprite(o); });
      monObjs.delete(id);
    }

    // Workers, townsfolk and ambient animation
    for (const o of structObjs.values()) for (const a of o.crew) {
      if (a.working) a.armR.rotation.x = -1.2 + Math.sin(t * 5 + a.phase * 2) * 0.8;
    }
    for (const a of actors) a.armL.rotation.x = Math.sin(t * 1.3 + a.g.position.x) * 0.15;
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
      if (it.kind === 'struct') { const c = structCenter(it.s); x = c.x; y = c.y; size = STRUCTS[it.s.type].size * 0.7; }
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
    camY += (gh(player.vx, player.vz) - camY) * k;
    const yaw = state.camYaw;
    let cxp = camX + Math.sin(yaw) * Math.cos(pitch) * zoom;
    let czp = camZ + Math.cos(yaw) * Math.cos(pitch) * zoom;
    let cyp = camY + 1 + Math.sin(pitch) * zoom;
    cyp = Math.max(cyp, gh(cxp, czp) + 0.8);
    camera.position.set(cxp, cyp, czp);
    camera.lookAt(camX, camY + 1, camZ);
    scene.fog.near = 34 + zoom;
    scene.fog.far = 62 + zoom * 1.5;
    sun.position.set(camX - 14, camY + 30, camZ + 10);
    sun.target.position.set(camX, camY, camZ);

    drawMinimap();
    renderer.render(scene, camera);
  }

  // ------------------------------------------------------------ public
  function init(container) {
    view = container;
    renderer = new C.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = C.PCFSoftShadowMap;
    view.prepend(renderer.domElement);

    scene = new C.Scene();
    scene.background = new C.Color(SKY);
    scene.fog = new C.Fog(SKY, 40, 75);
    camera = new C.PerspectiveCamera(50, 1, 0.3, 300);

    scene.add(new C.HemisphereLight(0xdfefff, 0x4a5a3a, 0.5));
    sun = new C.DirectionalLight(0xfff1d6, 0.7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 100;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);

    buildTerrain();
    buildNodeMeshes();
    buildTowns();
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

  return { init, start };
})();
