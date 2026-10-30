// The world of Ironhold: a fixed, hand-designed map. Same layout every time.
// Tiles are 1x1 world units; tile (x, y) is centred on world position (x, y).
'use strict';

const W = 600, H = 470;
// The original heartland, designed on a 400x320 grid, is stretched and shifted into the middle of
// the bigger world; the outer regions (marsh, desert, taiga, isles) surround it.
const SC = 1.12, OX = 80, OY = 70;
const PX = x => Math.round(x * SC + OX), PY = y => Math.round(y * SC + OY);
const P = pts => pts.map(([x, y]) => [PX(x), PY(y)]);
const T = { GRASS: 0, WATER: 1, WALL: 2, FLOOR: 3, ROAD: 4, ROCK: 5, BRIDGE: 6, SAND: 7, SNOW: 8, PEAK: 9, CAVE: 10 };
const WALKABLE = new Set([T.GRASS, T.FLOOR, T.ROAD, T.BRIDGE, T.SAND, T.PEAK, T.CAVE]);
const BIOME = { MEADOW: 0, FOREST: 1, BADLANDS: 2, HIGHLANDS: 3, MARSH: 4, DESERT: 5, TAIGA: 6, ISLES: 7, DUNGEON: 8 };
const BIOME_NAMES = ['The Meadowlands', 'Thornwood Forest', 'The Badlands', 'The Frost Highlands', 'Blackmire Marsh',
  'The Amber Wastes', 'The Frostpine Taiga', 'The Corsair Isles', 'The Depths'];

const terrain = new Uint8Array(W * H);
const biome = new Uint8Array(W * H);
const tileH = new Float32Array(W * H);             // ground height at each tile centre
const cornerH = new Float32Array((W + 1) * (H + 1)); // ground height at tile corners (for the mesh)
const tileRGB = new Float32Array(W * H * 3);
const nodes = new Map();     // idx -> { res, until }
const services = new Map();  // idx -> { type: 'market' | 'carriage', town }
const townBlocks = new Set(); // tiles covered by town buildings
const townHouses = [];       // { x, y, town } 2x2 decorative houses (x, y = top-left tile)
const townProps = [];        // { kind, x, y, rot, town } stalls, barrels, lamps, pens...
const pois = [];             // ruins, standing stones, camps and shrines
const signs = [];            // { x, y, rot, text } road signposts

const idx = (x, y) => y * W + x;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function valueNoise(seed) {
  const h = (x, y) => {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}
const noiseA = valueNoise(11), noiseB = valueNoise(12), noiseC = valueNoise(13);
const fbm = (n, x, y) => 0.6 * n(x, y) + 0.3 * n(x * 2.1, y * 2.1) + 0.1 * n(x * 4.3, y * 4.3);

// ------------------------------------------------------------ map design
// Towns. `pc` is the square where the market and carriage stand; Stonedeep climbs the mountainside
// in four terraces (heights listed from the bottom), joined by a central stairway.
const TOWN_DEFS = {
  ironhold:  { x: PX(200), y: PY(170), hw: 20, hh: 14, h: 0.5, margin: 4, walls: true },
  stonedeep: { x: PX(210), y: PY(74) + 2, hw: 11, hh: 12, h: 1.2, margin: 3, terraces: [1.2, 2.8, 4.4, 6.0] },
  saltmere:  { x: PX(118), y: PY(270) - 2, hw: 13, hh: 7,  h: 0.35, margin: 4 },
  thornwood: { x: PX(62),  y: PY(186), hw: 12, hh: 9,  h: 0.5, margin: 4 },
  ratsnest:  { x: PX(352), y: PY(238), hw: 10, hh: 8,  h: 0.6, margin: 4 },
  gloomwater:  { x: 48,  y: 250, hw: 12, hh: 9, h: 0.4, margin: 4 },
  amberreach:  { x: 560, y: 262, hw: 12, hh: 9, h: 0.6, margin: 4 },
  frosthollow: { x: 300, y: 34,  hw: 12, hh: 9, h: 0.8, margin: 5 },
};
for (const id in TOWN_DEFS) {
  const d = TOWN_DEFS[id];
  d.pc = d.terraces ? { x: d.x, y: d.y + d.hh - 3 } : { x: d.x, y: d.y };
  d.arrive = d.terraces ? { x: d.x + 2, y: d.y + d.hh - 2 } : { x: d.x + 3, y: d.y - 1 };
}
// Height of a town's ground; terraced towns step up the hill, with stairs up the middle.
function townHeight(t, x, y) {
  if (!t.terraces) return t.h;
  const n = t.terraces.length, rowD = (2 * t.hh + 1) / n;
  const f = clamp((t.y + t.hh + 0.5 - y) / rowD, 0, n - 0.001);
  const lv = Math.floor(f), frac = f - lv;
  let h = t.terraces[lv];
  if (Math.abs(x - t.x) <= 1.6 && lv < n - 1 && frac > 0.55) h = lerp(h, t.terraces[lv + 1], smooth((frac - 0.55) / 0.45));
  return h;
}
const townLandmarks = [];   // { town, kind, x, y, w, h }
const LANDMARKS = {
  ironhold:  { kind: 'keep',  dx: 6,  dy: -12, w: 7, h: 6 },
  stonedeep: { kind: 'mine',  dx: 3,  dy: -12, w: 5, h: 3 },
  thornwood: { kind: 'lodge', dx: -4, dy: -8,  w: 8, h: 4 },
  ratsnest:  { kind: 'den',   dx: 3,  dy: -7,  w: 6, h: 4 },
  saltmere:  { kind: 'lighthouse', w: 3, h: 3 },
  gloomwater:  { kind: 'stilthall',  dx: -4, dy: -8, w: 8, h: 4 },
  amberreach:  { kind: 'sunspire',   dx: 5,  dy: -8, w: 5, h: 5 },
  frosthollow: { kind: 'hearthhall', dx: -4, dy: -8, w: 8, h: 5 },
};

// Where a new game begins: a quiet clearing by a pond, south-west of Ironhold.
const HOMESTEAD = { x: PX(164), y: PY(194) };

// Mount Skyhorn: one giant peak with a spiral trail to the summit.
const PEAK = { x: PX(300), y: PY(122), r: 50, h: 38 };
const peakProfile = d => PEAK.h * Math.pow(Math.max(0, 1 - d / PEAK.r), 1.5);
const trailR = p => (40 - 36 * p) * PEAK.r / 46;
const trailH = p => peakProfile(trailR(p)) * 0.9 + 0.3;
const TRAIL = [];
for (let k = 0; k <= 200; k++) {
  const p = k / 200, th = Math.PI / 2 + p * Math.PI * 2 * 2.25;
  TRAIL.push([PEAK.x + Math.cos(th) * trailR(p), PEAK.y + Math.sin(th) * trailR(p), p]);
}

const RANGES = [
  // The great northern range, with Stonedeep in a valley at its heart.
  { pts: P([[0, 66], [60, 58], [120, 66], [170, 60], [210, 62], [260, 56], [320, 64], [400, 58]]), width: 25, peak: 11 },
  // Hills in the south-west.
  { pts: P([[20, 230], [36, 260], [30, 296]]), width: 16, peak: 6 },
  // Red mesas in the Amber Wastes.
  { pts: [[548, 150], [572, 175], [560, 200]], width: 10, peak: 5 },
];
// Mountain passes without roads.
const PASSES = [{ x: PX(82), y: PY(62), r: 10 }, { x: PX(330), y: PY(61), r: 10 }];

const LAKES = [
  { id: 'mirror', x: PX(150), y: PY(128), rx: 14, ry: 9, fish: [['minnow', 0.6], ['trout', 0.4]] },
  { id: 'pond',   x: PX(176), y: PY(198), rx: 7,  ry: 4.5, fish: [['minnow', 1]] },
  { id: 'fen',    x: PX(86),  y: PY(240), rx: 11, ry: 8, fish: [['trout', 0.7], ['minnow', 0.3]] },
  { id: 'tarn',   x: PX(300), y: PY(22),  rx: 10, ry: 7, fish: [['pike', 0.7], ['trout', 0.3]] },
  { id: 'dust',   x: PX(350), y: PY(182), rx: 8,  ry: 5.5, fish: [['trout', 1]] },
  { id: 'oasis',  x: 562, y: 232, rx: 7, ry: 4.5, fish: [['trout', 0.6], ['minnow', 0.4]] },
  { id: 'icemere', x: 210, y: 36, rx: 13, ry: 7, fish: [['pike', 0.6], ['trout', 0.4]] },
];
const RIVER = P([[244, 78], [248, 110], [240, 140], [246, 172], [252, 205], [244, 240], [234, 272], [230, 300]]);
// The Corsair Isles, strung across the southern sea.
const ISLANDS = [{ x: 200, y: 440, rx: 15, ry: 8 }, { x: 272, y: 449, rx: 18, ry: 9 }, { x: 350, y: 439, rx: 13, ry: 7 }, { x: 422, y: 447, rx: 16, ry: 8 }];
const SEA_FISH = [['pike', 0.55], ['trout', 0.45]];
const RIVER_FISH = [['trout', 0.7], ['minnow', 0.3]];

const ROADS = [
  P([[200, 170], [200, 140], [206, 110], [210, 92], [210, 76]]),
  [...P([[210, 76], [210, 58], [212, 40], [214, 16]]), [310, 60], [300, 34]],
  P([[200, 170], [160, 172], [120, 180], [90, 184], [62, 186]]),
  P([[200, 170], [196, 205], [170, 240], [140, 262], [118, 270]]),
  P([[200, 170], [250, 172], [280, 196], [320, 220], [352, 238]]),
  P([[264, 184], [286, 172], [300, 163]]),
  [[PX(62), PY(186)], [112, 272], [78, 262], [48, 250]],
  [[PX(352), PY(238)], [508, 312], [538, 284], [560, 262]],
  [[PX(118), PY(270) - 2], [214, 404], [206, 426], [200, 440], [236, 446], [272, 449], [312, 445], [350, 439], [386, 443], [422, 447]],
];

const coastTable = new Float32Array(W * 2 + 4);
for (let k = 0; k < coastTable.length; k++) {
  const ox = (k / 2 - 1 - OX) / SC;
  coastTable[k] = (290 + 9 * Math.sin(ox / 37) + (noiseC(ox / 20, 3.3) - 0.5) * 12) * SC + OY;
}
const coastY = x => coastTable[clamp(Math.round((x + 1) * 2), 0, coastTable.length - 1)];

// Two dungeons sealed away in rock, reached through their entrances in the marsh and the taiga.
const DUNGEONS = [
  { id: 'crypt',  name: 'The Sunken Crypt',  x0: 504, y0: 420, w: 44, h: 42, monster: 'skeleton', boss: 'cryptlord', entrance: { x: 62, y: 330 }, floor: [0.36, 0.33, 0.3] },
  { id: 'cavern', name: 'Frostdeep Cavern',  x0: 552, y0: 420, w: 44, h: 42, monster: 'troll',    boss: 'wurm',      entrance: { x: 440, y: 46 },  floor: [0.32, 0.36, 0.42] },
];
const dungeonMask = new Uint8Array(W * H); // 1 = open floor, by dungeon index + 1
const dungeonTorches = [];
const inDungeonRect = (x, y) => DUNGEONS.find(d => x >= d.x0 && x < d.x0 + d.w && y >= d.y0 && y < d.y0 + d.h) || null;
// Rooms on a 3x3 grid joined by corridors; you enter bottom-left and the boss waits top-right.
function carveDungeons() {
  DUNGEONS.forEach((d, n) => {
    const r = mulberry32(5150 + n * 77), cw = Math.floor(d.w / 3), ch = Math.floor(d.h / 3), rooms = [];
    const open = (x, y) => { if (x > d.x0 && y > d.y0 && x < d.x0 + d.w - 1 && y < d.y0 + d.h - 1) dungeonMask[idx(x, y)] = n + 1; };
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
      const rw = 6 + Math.floor(r() * 4), rh = 5 + Math.floor(r() * 4);
      const x = d.x0 + gx * cw + 2 + Math.floor(r() * (cw - rw - 3)), y = d.y0 + gy * ch + 2 + Math.floor(r() * (ch - rh - 3));
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) open(xx, yy);
      rooms[gy * 3 + gx] = { x: x + Math.floor(rw / 2), y: y + Math.floor(rh / 2) };
    }
    const link = (a, b) => {
      let x = a.x, y = a.y;
      while (x !== b.x) { open(x, y); open(x, y + 1); x += Math.sign(b.x - x); }
      while (y !== b.y) { open(x, y); open(x + 1, y); y += Math.sign(b.y - y); }
    };
    // A winding path through every room, plus a couple of shortcuts.
    for (const [a, b] of [[6, 7], [7, 8], [8, 5], [5, 4], [4, 3], [3, 0], [0, 1], [1, 2], [6, 3], [4, 1]]) link(rooms[a], rooms[b]);
    d.start = rooms[6];
    d.bossRoom = rooms[2];
    for (let y = d.y0; y < d.y0 + d.h; y++) for (let x = d.x0; x < d.x0 + d.w; x++) {
      if (!dungeonMask[idx(x, y)] || (x + y * 3) % 7) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => !dungeonMask[idx(x + a, y + b)])) dungeonTorches.push({ x, y, dungeon: d.id });
    }
  });
}

// Polyline helper with a bounding box for quick rejection.
function polyline(pts, pad) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { pts, x0: Math.min(...xs) - pad, x1: Math.max(...xs) + pad, y0: Math.min(...ys) - pad, y1: Math.max(...ys) + pad };
}
function distPoly(pl, x, y) {
  if (x < pl.x0 || x > pl.x1 || y < pl.y0 || y > pl.y1) return Infinity;
  let best = Infinity;
  const p = pl.pts;
  for (let k = 0; k < p.length - 1; k++) {
    const ax = p[k][0], ay = p[k][1], dx = p[k + 1][0] - ax, dy = p[k + 1][1] - ay;
    let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - t * dx, ey = y - ay - t * dy;
    const d2 = ex * ex + ey * ey;
    if (d2 < best) best = d2;
  }
  return Math.sqrt(best);
}
const rangeLines = RANGES.map(r => Object.assign(polyline(r.pts, r.width), r));
const riverLine = polyline(RIVER, 4);
const roadLines = ROADS.map(r => polyline(r, 4));
const trailLine = polyline(TRAIL, 4);
// Distance to the trail plus how far along it (0 = foot, 1 = summit) the nearest point is.
function trailParam(x, y) {
  if (x < trailLine.x0 || x > trailLine.x1 || y < trailLine.y0 || y > trailLine.y1) return { d: Infinity, p: 0 };
  let best = Infinity, bp = 0;
  for (let k = 0; k < TRAIL.length - 1; k++) {
    const ax = TRAIL[k][0], ay = TRAIL[k][1], dx = TRAIL[k + 1][0] - ax, dy = TRAIL[k + 1][1] - ay;
    let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = x - ax - t * dx, ey = y - ay - t * dy, d2 = ex * ex + ey * ey;
    if (d2 < best) { best = d2; bp = TRAIL[k][2] + (TRAIL[k + 1][2] - TRAIL[k][2]) * t; }
  }
  return { d: Math.sqrt(best), p: bp };
}
const tileTrail = new Float32Array(W * H).fill(99);
function roadDist(x, y) {
  let best = Infinity;
  for (let k = 0; k < roadLines.length; k++) { const d = distPoly(roadLines[k], x, y); if (d < best) best = d; }
  return best;
}
const tileRoad = new Float32Array(W * H); // distance from each tile centre to the nearest road

function heightFn(x, y) {
  const dg = inDungeonRect(Math.round(x + 0.5), Math.round(y + 0.5));
  if (dg) {
    // A corner is floor height if any tile touching it is open.
    const tx = Math.round(x + 0.5), ty = Math.round(y + 0.5);
    for (const [a, b] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) if (dungeonMask[idx(tx + a, ty + b)]) return 0.3;
    return 3.8;
  }
  let h = 0.25 + fbm(noiseA, x / 40, y / 40) * 0.8;
  // Outer regions: low wet marsh in the west, dunes in the east, rolling snowy hills in the north.
  const n = (noiseB(x / 18, y / 18) - 0.5) * 16;
  const wm = smooth(clamp((92 + n - x) / 10, 0, 1)), wd = smooth(clamp((x - 522 - n) / 10, 0, 1)), wt = smooth(clamp((62 + n * 0.5 - y) / 10, 0, 1));
  if (wm > 0) h = lerp(h, fbm(noiseC, x / 8, y / 8) > 0.6 ? -0.35 : 0.22 + fbm(noiseA, x / 12, y / 12) * 0.2, wm);
  if (wd > 0) h = lerp(h, 0.3 + (Math.sin(x / 5 + noiseA(x / 15, y / 15) * 4) * 0.5 + 0.5) * 0.65, wd);
  if (wt > 0) h += fbm(noiseA, x / 18, y / 18) * 1.1 * wt;
  for (const r of rangeLines) {
    const d = distPoly(r, x, y);
    if (d >= r.width) continue;
    let k = smooth(1 - d / r.width) * (0.5 + 0.5 * fbm(noiseB, x / 13, y / 13));
    for (const p of PASSES) {
      const pd = Math.hypot(x - p.x, y - p.y);
      if (pd < p.r * 2) k *= lerp(0.12, 1, smooth(clamp(pd / (p.r * 2), 0, 1)));
    }
    h += r.peak * k;
  }
  const dp = Math.hypot(x - PEAK.x, y - PEAK.y);
  if (dp < PEAK.r) {
    const ang = Math.atan2(y - PEAK.y, x - PEAK.x);
    h += peakProfile(dp) * (0.92 + 0.16 * fbm(noiseB, x / 9, y / 9) + 0.04 * Math.sin(ang * 6));
    const tp = trailParam(x, y);
    if (tp.d < 3.4) h = lerp(h, trailH(tp.p), tp.d < 1.7 ? 1 : smooth((3.4 - tp.d) / 1.7));
    if (dp < 6.5) h = lerp(h, trailH(1) + 0.2, smooth(clamp((6.5 - dp) / 2.5, 0, 1)));
  }
  const dh = Math.hypot(x - HOMESTEAD.x, y - HOMESTEAD.y);
  if (dh < 10) h = lerp(h, 0.45, smooth(clamp((10 - dh) / 5, 0, 1)));
  for (const l of LAKES) {
    let e = Math.sqrt(((x - l.x) / l.rx) ** 2 + ((y - l.y) / l.ry) ** 2);
    if (e > 1.45) continue;
    e += (noiseC(x / 6, y / 6) - 0.5) * 0.3;
    if (e < 1.25) h = lerp(h, -0.9, smooth(clamp((1.25 - e) / 0.4, 0, 1)));
  }
  const c = y > 330 ? coastY(x) : 1e9;
  if (y > c - 6) h = lerp(h, -1.3, smooth(clamp((y - (c - 6)) / 7, 0, 1)));
  for (const isl of ISLANDS) {
    let e = Math.hypot((x - isl.x) / isl.rx, (y - isl.y) / isl.ry);
    if (e > 1.5) continue;
    e += (noiseC(x / 5, y / 5) - 0.5) * 0.3;
    if (e < 1.2) h = lerp(h, 0.45 + fbm(noiseA, x / 9, y / 9) * 0.5, smooth(clamp((1.2 - e) / 0.35, 0, 1)));
  }
  const dr = distPoly(riverLine, x, y);
  if (dr < 3.2) h = lerp(h, -0.7, smooth(clamp((3.2 - dr) / 1.6, 0, 1)));
  if (h > -0.05) {
    const d = roadDist(x, y);
    const capH = Math.hypot(x - TOWN_DEFS.stonedeep.x, y - TOWN_DEFS.stonedeep.y) < 36 ? 7.5 : 2.0;
    if (d < 3.4) h = lerp(h, clamp(h, 0.2, capH), d < 2 ? 1 : smooth((3.4 - d) / 1.4));
  }
  for (const id in TOWN_DEFS) {
    const t = TOWN_DEFS[id];
    const dx = Math.max(0, Math.abs(x - t.x) - t.hw), dy = Math.max(0, Math.abs(y - t.y) - t.hh);
    const dd = Math.hypot(dx, dy);
    if (dd < t.margin) h = lerp(h, townHeight(t, clamp(x, t.x - t.hw, t.x + t.hw), clamp(y, t.y - t.hh, t.y + t.hh)), smooth(1 - dd / t.margin));
  }
  return h;
}

function biomeFn(x, y) {
  const n = (noiseB(x / 18, y / 18) - 0.5) * 16;
  if (inDungeonRect(x, y)) return BIOME.DUNGEON;
  if (y > coastY(x) + 10) return BIOME.ISLES;
  if (y < 62 + n * 0.5) return BIOME.TAIGA;
  if (x < 92 + n) return BIOME.MARSH;
  if (x > 522 + n) return BIOME.DESERT;
  const ox = (x - OX) / SC, oy = (y - OY) / SC;
  if (oy < 40 + n * 0.5) return BIOME.HIGHLANDS;
  if (ox > 296 + n && oy > 92 && oy < 284) return BIOME.BADLANDS;
  if (ox < 128 + n && oy > 92 + n && oy < 272) return BIOME.FOREST;
  return BIOME.MEADOW;
}

const inTownRect = (x, y, t, m = 0) => Math.abs(x - t.x) <= t.hw + m && Math.abs(y - t.y) <= t.hh + m;
function townAt(x, y, margin = 0) {
  for (const id in TOWN_DEFS) if (inTownRect(x, y, TOWN_DEFS[id], margin)) return id;
  return null;
}
function nearestTown(x, y) {
  let best = null, bd = Infinity;
  for (const id in TOWN_DEFS) {
    const d = Math.hypot(x - TOWN_DEFS[id].x, y - TOWN_DEFS[id].y);
    if (d < bd) { bd = d; best = id; }
  }
  return { id: best, dist: bd };
}

// ------------------------------------------------------------ generation
function pickWeighted(r, list) {
  let roll = r(), acc = 0;
  for (const [v, w] of list) { acc += w; if (roll < acc) return v; }
  return list[list.length - 1][0];
}

function generateWorld() {
  const r = mulberry32(2024);
  carveDungeons();
  for (let cy = 0; cy <= H; cy++) for (let cx = 0; cx <= W; cx++) cornerH[cy * (W + 1) + cx] = heightFn(cx - 0.5, cy - 0.5);

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    tileRoad[idx(x, y)] = roadDist(x, y);
    if (Math.hypot(x - PEAK.x, y - PEAK.y) < PEAK.r) tileTrail[idx(x, y)] = trailParam(x, y).d;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    const h = (cornerH[y * (W + 1) + x] + cornerH[y * (W + 1) + x + 1] + cornerH[(y + 1) * (W + 1) + x] + cornerH[(y + 1) * (W + 1) + x + 1]) / 4;
    tileH[i] = h;
    biome[i] = biomeFn(x, y);
    const town = townAt(x, y);
    let t;
    if (inDungeonRect(x, y)) t = dungeonMask[i] ? T.CAVE : T.ROCK;
    else if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) t = h < -0.05 ? T.WATER : T.ROCK;
    else if (town) {
      const d = TOWN_DEFS[town];
      const edge = Math.abs(x - d.x) === d.hw || Math.abs(y - d.y) === d.hh;
      const k = y * (W + 1) + x;
      const spread = Math.max(cornerH[k], cornerH[k + 1], cornerH[k + W + 1], cornerH[k + W + 2]) - Math.min(cornerH[k], cornerH[k + 1], cornerH[k + W + 1], cornerH[k + W + 2]);
      t = (d.walls && edge && tileRoad[i] > 1.8) || (d.terraces && spread > 0.6 && Math.abs(x - d.x) > 1) ? T.WALL : T.FLOOR;
    } else if (tileRoad[i] < 1.3) t = h < -0.05 ? T.BRIDGE : T.ROAD;
    else if (Math.hypot(x - PEAK.x, y - PEAK.y) < 4.6) t = T.PEAK;
    else if (tileTrail[i] < 1.45) t = h > 7 ? T.PEAK : T.ROAD;
    else if (h < -0.05) t = T.WATER;
    else if (h > 7) t = T.SNOW;
    else if (h > 3) t = T.ROCK;
    else if (h < 0.15) t = T.SAND;
    else t = T.GRASS;
    terrain[i] = t;
  }

  // Town squares, landmarks and streets of houses.
  for (const id in TOWN_DEFS) layTown(id, TOWN_DEFS[id]);

  // Resources: at most one per 2x2 cell, so nothing forms big clumps.
  const capital = TOWN_DEFS.ironhold;
  for (let cy = 0; cy < H; cy += 2) for (let cx = 0; cx < W; cx += 2) {
    const x = cx + Math.floor(r() * 2), y = cy + Math.floor(r() * 2);
    const roll = r(), pick = r();
    if (x >= W || y >= H) continue;
    const i = idx(x, y), t = terrain[i];
    if (t !== T.GRASS && t !== T.SAND) continue;
    if (townAt(x, y, 4) || tileRoad[i] < 2) continue;
    const h = tileH[i], b = biome[i];
    const dCap = Math.hypot(x - capital.x, y - capital.y);
    let table;
    if (b === BIOME.MARSH) table = [[0.2, 'tree'], [0.05, 'bush'], [0.035, 'rock'], [0.02, 'pebbles']];
    else if (b === BIOME.DESERT) table = [[0.03, 'rock'], [0.04, 'pebbles']];
    else if (b === BIOME.TAIGA) table = [[0.32, 'tree'], [0.05, 'rock'], [0.02, 'pebbles']];
    else if (b === BIOME.ISLES) table = [[0.1, 'tree'], [0.04, 'bush'], [0.03, 'pebbles'], [0.012, 'rock']];
    else if (h > 1.4) {
      table = [[0.09, 'rock'], [0.04, 'tree'], [0.03, 'pebbles']];
    } else if (b === BIOME.FOREST) {
      table = [[0.5, 'tree'], [0.05, 'bush'], [0.015, 'pebbles'], [0.01, 'rock']];
    } else if (b === BIOME.HIGHLANDS) {
      table = [[0.22, 'tree'], [0.07, 'rock'], [0.03, 'pebbles']];
    } else if (b === BIOME.BADLANDS) {
      table = [[0.03, 'tree'], [0.04, 'rock'], [0.04, 'pebbles'], [0.02, 'bush']];
    } else {
      table = [[0.05, 'tree'], [0.025, 'bush'], [0.02, 'pebbles'], [0.006, 'rock']];
    }
    if (dCap > 14 && dCap < 45) table = [[0.06, 'bush'], [0.05, 'pebbles'], [0.025, 'tree'], [0.008, 'rock'], ...table];
    let kind = null, acc = 0;
    for (const [p, k] of table) { acc += p; if (roll < acc) { kind = k; break; } }
    if (!kind) continue;
    let res = kind;
    if (kind === 'tree' && b === BIOME.TAIGA) res = pick < 0.35 ? 'frostwood' : 'pine';
    else if (kind === 'tree' && (b === BIOME.MARSH || b === BIOME.ISLES)) res = pick < 0.4 ? 'pine' : 'oak';
    else if (kind === 'rock' && b === BIOME.MARSH) res = pick < 0.8 ? 'bogiron' : 'coal';
    else if (kind === 'rock' && b === BIOME.DESERT) res = pick < 0.35 ? 'gold' : pick < 0.8 ? 'copper' : 'iron';
    else if (kind === 'rock' && b === BIOME.TAIGA) res = pick < 0.5 ? 'iron' : 'coal';
    else if (kind === 'rock' && b === BIOME.ISLES) res = 'copper';
    else if (kind === 'tree') {
      res = b === BIOME.HIGHLANDS ? (pick < 0.3 ? 'pine' : pick < 0.55 ? 'oak' : 'ironwood')
        : b === BIOME.FOREST ? (x < 70 && pick < 0.12 ? 'ironwood' : pick < 0.55 ? 'pine' : 'oak')
        : pick < 0.85 ? 'pine' : 'oak';
    } else if (kind === 'rock') {
      res = b === BIOME.HIGHLANDS ? (pick < 0.1 ? 'copper' : pick < 0.5 ? 'iron' : 'coal')
        : h > 1.4 ? (pick < 0.35 ? 'copper' : pick < 0.8 ? 'iron' : 'coal')
        : b === BIOME.BADLANDS ? (pick < 0.45 ? 'copper' : pick < 0.9 ? 'iron' : 'coal')
        : pick < 0.88 ? 'copper' : 'iron';
    }
    nodes.set(i, { res, until: 0 });
  }

  // Fishing spots along shorelines, sampled on a 3x3 grid.
  const landNext = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => WALKABLE.has(terrain[idx(x + a, y + b)]));
  for (let cy = 1; cy < H - 1; cy += 3) for (let cx = 1; cx < W - 1; cx += 3) {
    const cand = [];
    for (let y = cy; y < Math.min(cy + 3, H - 1); y++) for (let x = cx; x < Math.min(cx + 3, W - 1); x++) {
      if (terrain[idx(x, y)] === T.WATER && landNext(x, y)) cand.push([x, y]);
    }
    if (!cand.length || r() > 0.4) continue;
    const [x, y] = cand[Math.floor(r() * cand.length)];
    let fish;
    if (y > coastY(x) - 5) fish = SEA_FISH;
    else if (distPoly(riverLine, x, y) < 4) fish = RIVER_FISH;
    else {
      let best = LAKES[0], bd = Infinity;
      for (const l of LAKES) { const e = Math.hypot((x - l.x) / l.rx, (y - l.y) / l.ry); if (e < bd) { bd = e; best = l; } }
      fish = best.fish;
    }
    nodes.set(idx(x, y), { res: pickWeighted(r, fish), until: 0 });
  }

  decorateWorld(r);
  computeColors();
}

function computeColors() {
  const tint = {
    [BIOME.MEADOW]: [0.38, 0.56, 0.26], [BIOME.FOREST]: [0.25, 0.42, 0.2],
    [BIOME.BADLANDS]: [0.6, 0.47, 0.3], [BIOME.HIGHLANDS]: [0.4, 0.5, 0.39],
    [BIOME.MARSH]: [0.3, 0.36, 0.2], [BIOME.DESERT]: [0.86, 0.73, 0.47], [BIOME.TAIGA]: [0.86, 0.89, 0.92], [BIOME.ISLES]: [0.45, 0.66, 0.32],
    [BIOME.DUNGEON]: [0.3, 0.3, 0.3],
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y), h = tileH[i];
    let c;
    switch (terrain[i]) {
      case T.GRASS: {
        c = tint[biome[i]].slice();
        if (h > 1.5) { const k = clamp((h - 1.5) / 1.5, 0, 1) * 0.7; c = c.map((v, j) => lerp(v, [0.5, 0.48, 0.42][j], k)); }
        break;
      }
      case T.SAND: c = [0.84, 0.78, 0.55]; break;
      case T.WATER: case T.BRIDGE: c = [0.16, 0.33, 0.46]; break;
      case T.ROCK: c = h > 4.8 ? [0.62, 0.6, 0.58] : [0.5, 0.47, 0.43]; if (h > 16) c = [0.9, 0.92, 0.95]; if (inDungeonRect(x, y)) c = [0.2, 0.19, 0.2]; break;
      case T.SNOW: c = [0.93, 0.95, 0.98]; break;
      case T.ROAD: c = h > 7 ? [0.82, 0.82, 0.84] : [0.62, 0.5, 0.34]; break;
      case T.PEAK: c = [0.88, 0.9, 0.94]; break;
      case T.CAVE: c = (inDungeonRect(x, y) || DUNGEONS[0]).floor.slice(); break;
      case T.WALL: c = [0.45, 0.43, 0.4]; break;
      default: c = townAt(x, y) === 'ironhold' ? [0.6, 0.57, 0.51] : [0.56, 0.47, 0.34];
    }
    const v = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.06;
    tileRGB[i * 3] = c[0] * v; tileRGB[i * 3 + 1] = c[1] * v; tileRGB[i * 3 + 2] = c[2] * v;
  }
}

// Ground height at any world position, interpolated from the corner grid.
function groundHeight(px, py) {
  const u = clamp(px + 0.5, 0, W - 0.001), v = clamp(py + 0.5, 0, H - 0.001);
  const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
  const k = y0 * (W + 1) + x0;
  const a = cornerH[k], b = cornerH[k + 1], c = cornerH[k + W + 1], d = cornerH[k + W + 2];
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

function walkableTerrain(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  return WALKABLE.has(terrain[idx(x, y)]);
}

// Which monsters live at a tile, or null for safe ground.
function spawnTable(x, y) {
  const t = nearestTown(x, y);
  if (t.dist < (t.id === 'ironhold' ? 34 : 24)) return null;
  if (Math.hypot(x - HOMESTEAD.x, y - HOMESTEAD.y) < 24) return null;
  const i = idx(x, y), b = biome[i];
  const dg = inDungeonRect(x, y);
  if (dg) return Math.hypot(x - dg.start.x, y - dg.start.y) < 8 ? null : [[dg.monster, 1]];
  if (b === BIOME.MARSH) return [['lurker', 0.7], ['wolf', 0.3]];
  if (b === BIOME.DESERT) return [['scorpion', 0.8], ['bandit', 0.2]];
  if (b === BIOME.TAIGA) return [['bear', 0.5], ['wolf', 0.5]];
  if (b === BIOME.ISLES) return [['pirate', 1]];
  if (Math.hypot(x - PEAK.x, y - PEAK.y) < PEAK.r) {
    if (Math.hypot(x - PEAK.x, y - PEAK.y) < 8) return null;
    return tileH[i] > 14 ? [['ogre', 0.7], ['wolf', 0.3]] : [['wolf', 0.6], ['bandit', 0.4]];
  }
  if (b === BIOME.HIGHLANDS) return [['ogre', 0.55], ['wolf', 0.45]];
  if (tileH[i] > 1.4) return [['wolf', 0.5], ['bandit', 0.3], ['goblin', 0.2]];
  if (b === BIOME.BADLANDS) return [['bandit', 0.8], ['wolf', 0.2]];
  if (b === BIOME.FOREST) return [['wolf', 0.55], ['goblin', 0.45]];
  const dCap = Math.hypot(x - TOWN_DEFS.ironhold.x, y - TOWN_DEFS.ironhold.y);
  return dCap > 80 ? [['goblin', 0.4], ['wolf', 0.35], ['bandit', 0.25]] : [['goblin', 0.6], ['wolf', 0.4]];
}

function regionName(x, y) {
  const town = townAt(Math.round(x), Math.round(y), 1);
  if (town) return TOWNS[town].name;
  const i = idx(clamp(Math.round(x), 0, W - 1), clamp(Math.round(y), 0, H - 1));
  const dg = inDungeonRect(Math.round(x), Math.round(y));
  if (dg) return dg.name;
  if (Math.hypot(x - PEAK.x, y - PEAK.y) < 6) return 'Summit of Mount Skyhorn';
  if (Math.hypot(x - PEAK.x, y - PEAK.y) < PEAK.r) return 'Mount Skyhorn';
  if (Math.hypot(x - HOMESTEAD.x, y - HOMESTEAD.y) < 14) return 'Pondside Clearing';
  if (biome[i] >= BIOME.MARSH) return BIOME_NAMES[biome[i]];
  if (tileH[i] > 1.4 && biome[i] !== BIOME.HIGHLANDS) return 'The Mountains';
  if (y > coastY(x) - 12) return 'The Southern Coast';
  return BIOME_NAMES[biome[i]];
}

// ------------------------------------------------------------ hand-placed details
const POI_DEFS = [
  { id: 'watchtower',  kind: 'ruins',  name: 'Old Watchtower',     x: PX(128), y: PY(148) },
  { id: 'fallenkeep',  kind: 'ruins',  name: 'Fallen Keep',        x: PX(262), y: PY(252) },
  { id: 'mossruins',   kind: 'ruins',  name: 'Mossy Ruins',        x: PX(64),  y: PY(118) },
  { id: 'frostruins',  kind: 'ruins',  name: 'Frozen Ruins',       x: PX(150), y: PY(26) },
  { id: 'whispering',  kind: 'stones', name: 'Whispering Stones',  x: PX(226), y: PY(218) },
  { id: 'redstones',   kind: 'stones', name: 'Red Stones',         x: PX(322), y: PY(266) },
  { id: 'abandoned',   kind: 'camp',   name: 'Abandoned Camp',     x: PX(150), y: PY(224) },
  { id: 'hunters',     kind: 'camp',   name: "Hunters' Camp",      x: PX(360), y: PY(30) },
  { id: 'trapper',     kind: 'camp',   name: "Trapper's Camp",     x: PX(36),  y: PY(206) },
  { id: 'wayside',     kind: 'shrine', name: 'Wayside Shrine',     x: PX(176), y: PY(150) },
  { id: 'mountshrine', kind: 'shrine', name: 'Mountain Shrine',    x: PX(276), y: PY(172) },
  { id: 'passshrine',  kind: 'shrine', name: 'Pass Shrine',        x: PX(82),  y: PY(74) },
  // The outer regions
  { id: 'drowned',     kind: 'ruins',  name: 'Drowned Chapel',     x: 40,  y: 186 },
  { id: 'bogstones',   kind: 'stones', name: 'Bog Stones',         x: 70,  y: 372 },
  { id: 'crypt',       kind: 'dungeon', name: 'The Sunken Crypt',  x: 62,  y: 330, dungeon: 'crypt' },
  { id: 'buriedtemple', kind: 'ruins', name: 'Buried Temple',      x: 548, y: 120 },
  { id: 'caravan',     kind: 'camp',   name: 'Caravan Wreck',      x: 578, y: 340 },
  { id: 'suncircle',   kind: 'stones', name: 'Sun Circle',         x: 540, y: 222 },
  { id: 'lodge',       kind: 'camp',   name: "Old Trapper's Lodge", x: 96, y: 36 },
  { id: 'frostshrine', kind: 'shrine', name: 'Frost Shrine',       x: 480, y: 28 },
  { id: 'cavern',      kind: 'dungeon', name: 'Frostdeep Cavern',  x: 440, y: 46, dungeon: 'cavern' },
  { id: 'corsaircove', kind: 'camp',   name: 'Corsair Cove',       x: 424, y: 448 },
  { id: 'seashrine',   kind: 'shrine', name: 'Sea Shrine',         x: 270, y: 452 },
  { id: 'firstforge',  kind: 'forge',  name: 'The Firstforge',     x: 416, y: 262 },
];

function decorateWorld(r) {
  const freeArea = (cx, cy, rad) => {
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) {
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) return false;
      const t = terrain[idx(x, y)];
      if (t !== T.GRASS && t !== T.SAND) return false;
      if (tileRoad[idx(x, y)] < 2.5 || townAt(x, y, 6)) return false;
      if (Math.abs(tileH[idx(x, y)] - tileH[idx(cx, cy)]) > 1) return false;
    }
    return true;
  };
  const clearNodes = (cx, cy, rad) => {
    for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) nodes.delete(idx(x, y));
  };
  const block = (x, y) => townBlocks.add(idx(x, y));
  const grassAt = (x, y) => terrain[idx(x, y)] === T.GRASS && !nodes.has(idx(x, y)) && !townBlocks.has(idx(x, y));

  // The starting clearing: clear the middle, then make sure the basics are close by.
  clearNodes(HOMESTEAD.x, HOMESTEAD.y, 5);
  const starters = [['bush', 7], ['pebbles', 7], ['pine', 9], ['copper', 2]];
  for (const [res, n] of starters) {
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < n; tries++) {
      const a = r() * Math.PI * 2, d = 7 + r() * (res === 'copper' ? 12 : 9);
      const x = Math.round(HOMESTEAD.x + Math.cos(a) * d), y = Math.round(HOMESTEAD.y + Math.sin(a) * d);
      if (!grassAt(x, y) || tileRoad[idx(x, y)] < 2) continue;
      nodes.set(idx(x, y), { res, until: 0 });
      placed++;
    }
  }

  // Starstone veins on the summit of Mount Skyhorn.
  for (const [dx, dy] of [[-3, -1], [3, 0], [0, -3]]) nodes.set(idx(PEAK.x + dx, PEAK.y + dy), { res: 'starrock', until: 0 });

  // Points of interest, nudged to the nearest open ground.
  for (const def of POI_DEFS) {
    let spot = null;
    for (let rad = 0; rad < 25 && !spot; rad++) {
      for (let k = 0; k < Math.max(1, rad * 8) && !spot; k++) {
        const a = k / Math.max(1, rad * 8) * Math.PI * 2;
        const x = Math.round(def.x + Math.cos(a) * rad), y = Math.round(def.y + Math.sin(a) * rad);
        if (freeArea(x, y, def.kind === 'shrine' ? 1 : 3)) spot = [x, y];
      }
    }
    if (!spot) continue;
    const [x, y] = spot;
    const poi = { id: def.id, kind: def.kind, name: def.name, x, y, parts: [] };
    clearNodes(x, y, def.kind === 'shrine' ? 2 : 4);
    const part = (kind, px, py, solid = true, rot = 0) => { poi.parts.push({ kind, x: px, y: py, rot }); if (solid) block(px, py); };
    if (def.kind === 'ruins') {
      for (let k = -3; k <= 3; k++) {
        if (r() < 0.65) part('wall', x + k, y - 3);
        if (r() < 0.5) part('wall', x - 3, y + k);
        if (r() < 0.5 && k > -2) part('wall', x + 3, y + k);
      }
      part('pillar', x - 1, y + 2); part('pillar', x + 2, y + 2);
      services.set(idx(x, y), { type: 'chest', poi: def.id });
    } else if (def.kind === 'stones') {
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2;
        part('standing', Math.round(x + Math.cos(a) * 3), Math.round(y + Math.sin(a) * 3), true, a);
      }
      services.set(idx(x, y), { type: 'shrine', poi: def.id });
    } else if (def.kind === 'camp') {
      part('tent', x - 2, y - 1); part('tent', x + 2, y - 2, true, 1);
      part('firepit', x, y + 1, false);
      part('crates', x + 2, y + 1);
      services.set(idx(x - 1, y + 2), { type: 'chest', poi: def.id });
    } else if (def.kind === 'forge') {
      // A cold, ancient forge ringed by pillars, waiting for the relics to wake it.
      for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) part('pillar', x + dx, y + dy);
      services.set(idx(x, y), { type: 'forge', poi: def.id });
    } else if (def.kind === 'dungeon') {
      // The entrance leads down into the dungeon; a way back waits in its first room.
      const dg = DUNGEONS.find(d => d.id === def.dungeon);
      part('mound', x - 1, y - 1); part('mound', x + 1, y - 1);
      services.set(idx(x, y), { type: 'portal', poi: def.id, to: { x: dg.start.x + 1, y: dg.start.y }, label: `Enter ${def.name}` });
      services.set(idx(dg.start.x - 1, dg.start.y), { type: 'portal', poi: def.id, to: { x: x + 0.5, y: y + 2 }, label: 'Climb back to the surface' });
      services.set(idx(dg.bossRoom.x + 2, dg.bossRoom.y - 1), { type: 'chest', poi: `${def.id}_hoard` });
      poi.dungeon = dg.id;
    } else {
      services.set(idx(x, y), { type: 'shrine', poi: def.id });
    }
    pois.push(poi);
  }

  // Signposts a little way out of each town along every road.
  const townName = id => TOWNS[id].name;
  const endTown = (px, py) => nearestTown(px, py).id;
  for (const road of ROADS) {
    const a = endTown(road[0][0], road[0][1]);
    const last = road[road.length - 1];
    const bt = nearestTown(last[0], last[1]);
    const to = bt.dist < 3 ? townName(bt.id) : 'Mount Skyhorn';
    const from = townName(a);
    // Walk along the road to the first point clear of the town.
    let px = road[0][0], py = road[0][1], k = 0;
    const [dx, dy] = [road[1][0] - road[0][0], road[1][1] - road[0][1]];
    const len = Math.hypot(dx, dy);
    for (k = 0; k < len; k++) { px = road[0][0] + dx / len * k; py = road[0][1] + dy / len * k; if (!townAt(Math.round(px), Math.round(py), 5)) break; }
    const nx = -dy / len, ny = dx / len;
    for (const side of [2, -2, 3, -3]) {
      const sx = Math.round(px + nx * side), sy = Math.round(py + ny * side);
      if (terrain[idx(sx, sy)] === T.GRASS && !nodes.has(idx(sx, sy))) {
        signs.push({ x: sx, y: sy, rot: Math.atan2(dx, dy), text: [`< ${from}`, `${to} >`] });
        block(sx, sy);
        break;
      }
    }
  }

  // Town life: stalls, barrels, lamps, wells, pens and each town's own touches.
  const extras = {
    ironhold: ['fountain', 'forge', 'tables', 'tables', 'tables', 'board', 'well', 'cart', 'hay', 'barrel', 'barrel', 'crates', 'crates', 'banner', 'banner', 'flowers', 'flowers', 'barrel'],
    stonedeep: ['forge', 'forge', 'orecart', 'orecart', 'anvilprop', 'tables', 'tables', 'board', 'crates', 'barrel', 'banner'],
    saltmere: ['fishrack', 'fishrack', 'fishrack', 'nets', 'nets', 'tables', 'tables', 'board', 'barrel', 'crates', 'well', 'banner'],
    thornwood: ['logpile', 'logpile', 'sawhorse', 'sawhorse', 'tables', 'tables', 'board', 'well', 'hay', 'barrel', 'banner', 'forge'],
    ratsnest: ['gamble', 'gamble', 'gamble', 'tent', 'tent', 'firepit', 'firepit', 'tables', 'barrel', 'barrel', 'crates', 'banner'],
    gloomwater: ['fishrack', 'fishrack', 'nets', 'tables', 'board', 'barrel', 'crates', 'banner', 'firepit', 'barrel'],
    amberreach: ['palm', 'palm', 'palm', 'palm', 'palm', 'well', 'tables', 'tables', 'board', 'crates', 'barrel', 'banner'],
    frosthollow: ['logpile', 'logpile', 'forge', 'tables', 'board', 'barrel', 'hay', 'banner', 'firepit', 'firepit'],
  };
  // What each town's market stalls sell.
  const STALL_GOODS = {
    ironhold: ['produce', 'bread', 'cloth', 'pottery', 'meat', 'tools', 'flowers', 'fish', 'produce', 'bread', 'cloth', 'meat'],
    stonedeep: ['tools', 'ore', 'meat', 'bread', 'tools', 'ore'],
    saltmere: ['fish', 'fish', 'produce', 'cloth', 'bread', 'fish'],
    thornwood: ['meat', 'furs', 'produce', 'tools', 'bread', 'furs'],
    ratsnest: ['shady', 'weapons', 'shady', 'meat', 'weapons'],
    gloomwater: ['fish', 'produce', 'pottery', 'shady', 'fish'],
    amberreach: ['cloth', 'pottery', 'produce', 'ore', 'flowers', 'cloth'],
    frosthollow: ['furs', 'meat', 'bread', 'tools', 'furs'],
  };
  for (const id in TOWN_DEFS) {
    const d = TOWN_DEFS[id], tr = mulberry32(id.length * 31 + d.y);
    const ok = (x, y) => {
      if (Math.abs(x - d.x) > d.hw - 1 || Math.abs(y - d.y) > d.hh - 1) return false;
      if (Math.abs(x - d.x) <= 1 || Math.abs(y - d.y) <= 1) return false;
      const i = idx(x, y);
      if (terrain[i] !== T.FLOOR || townBlocks.has(i)) return false;
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
        const j = idx(xx, yy);
        if (services.has(j) || (townBlocks.has(j) && !(xx === x && yy === y))) return false;
      }
      return !(x === d.arrive.x && y === d.arrive.y);
    };
    // Market stalls ring the square and line the main streets, each facing the street.
    const face = (x, y) => {
      if (d.terraces) return 0;
      if (Math.abs(x - d.x) <= 3 && Math.abs(y - d.y) > 1) return x < d.x ? Math.PI / 2 : -Math.PI / 2;
      if (Math.abs(y - d.y) <= 3) return y < d.y ? 0 : Math.PI;
      const dx = d.pc.x - x, dy = d.pc.y - y;
      return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dy > 0 ? 0 : Math.PI);
    };
    const spots = [];
    const pr = id === 'ironhold' ? [5, 4] : [4, 3];
    for (let y = d.pc.y - pr[1]; y <= d.pc.y + pr[1]; y++) for (let x = d.pc.x - pr[0]; x <= d.pc.x + pr[0]; x++) spots.push([x, y, 0.85]);
    for (let k = -d.hw + 2; k <= d.hw - 2; k += 2) for (const side of [-2, 2]) spots.push([d.x + k, d.y + side, 0.5]);
    for (let k = -d.hh + 2; k <= d.hh - 2; k += 2) for (const side of [-2, 2]) spots.push([d.x + side, d.y + k, 0.5]);
    // Stalls may back onto houses, but keep a gap from each other and from the market and carriage.
    const okStall = (x, y) => {
      if (Math.abs(x - d.x) > d.hw - 1 || Math.abs(y - d.y) > d.hh - 1) return false;
      if (!d.terraces && (Math.abs(x - d.x) <= 1 || Math.abs(y - d.y) <= 1)) return false;
      const i = idx(x, y);
      if (terrain[i] !== T.FLOOR || townBlocks.has(i) || (x === d.arrive.x && y === d.arrive.y)) return false;
      for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (services.has(idx(xx, yy)) || stallTiles.has(idx(xx, yy))) return false;
      return true;
    };
    const stallTiles = new Set();
    let gi = 0;
    for (const [x, y, p] of spots) {
      if (tr() > p || !okStall(x, y)) continue;
      stallTiles.add(idx(x, y));
      const goods = STALL_GOODS[id][gi++ % STALL_GOODS[id].length];
      townProps.push({ kind: 'stall', goods, x, y, rot: face(x, y), town: id });
      block(x, y);
    }
    for (const kind of extras[id]) {
      for (let tries = 0; tries < 60; tries++) {
        const x = d.x + Math.round((tr() * 2 - 1) * (d.hw - 1)), y = d.y + Math.round((tr() * 2 - 1) * (d.hh - 1));
        if (!ok(x, y)) continue;
        townProps.push({ kind, x, y, rot: Math.floor(tr() * 4) * Math.PI / 2, town: id });
        block(x, y);
        break;
      }
    }
    // Lamp posts along the main streets.
    for (let k = -d.hw + 3; k <= d.hw - 3; k += 5) for (const side of [-2, 2]) {
      const x = d.x + k, y = d.y + side;
      if (terrain[idx(x, y)] === T.FLOOR && !townBlocks.has(idx(x, y)) && !services.has(idx(x, y))) {
        townProps.push({ kind: 'lamp', x, y, rot: 0, town: id });
        block(x, y);
      }
    }
    // An animal pen just outside town.
    const pens = { ironhold: [d.x - d.hw - 9, d.y + 3], stonedeep: [d.x + d.hw + 2, d.y + 2], saltmere: [d.x - d.hw - 7, d.y - 3], thornwood: [d.x + d.hw + 2, d.y - 5], ratsnest: [d.x - d.hw - 7, d.y + 1],
      gloomwater: [d.x + d.hw + 2, d.y - 4], amberreach: [d.x - d.hw - 7, d.y + 2], frosthollow: [d.x - d.hw - 7, d.y] };
    const [px, py] = pens[id];
    let fits = true;
    for (let y = py; y < py + 4 && fits; y++) for (let x = px; x < px + 5; x++) {
      const i = idx(x, y);
      if (terrain[i] !== T.GRASS || tileRoad[i] < 1.8) { fits = false; break; }
    }
    if (fits) {
      for (let y = py; y < py + 4; y++) for (let x = px; x < px + 5; x++) {
        nodes.delete(idx(x, y));
        if (y === py || y === py + 3 || x === px || x === px + 4) block(x, y);
      }
      townProps.push({ kind: 'pen', x: px, y: py, w: 5, h: 4, town: id, animal: { ironhold: 'cow', stonedeep: 'pig', saltmere: 'chicken', thornwood: 'pig', ratsnest: 'chicken', gloomwater: 'pig', amberreach: 'chicken', frosthollow: 'cow' }[id] });
    }
  }

  // Saltmere's fishing dock runs out into the sea, with boats alongside.
  const sm = TOWN_DEFS.saltmere;
  const dockX = sm.x + 5;
  let wet = 0;
  for (let y = sm.y + sm.hh + 1; y < H - 2 && wet < 5; y++) {
    const i = idx(dockX, y);
    if (terrain[i] === T.WATER) { wet++; nodes.delete(i); }
    terrain[i] = terrain[i] === T.WATER ? T.BRIDGE : T.ROAD;
    if (wet === 3) {
      townProps.push({ kind: 'boat', x: dockX - 2, y, rot: 0, town: 'saltmere' });
      townProps.push({ kind: 'boat', x: dockX + 2, y: y + 1, rot: Math.PI, town: 'saltmere' });
    }
  }
}

// Lay out a town: market square, a landmark, then three-by-three house lots along the streets.
function layTown(id, d) {
  const tr = mulberry32(id.length * 977 + d.x);
  const inRect = (x, y, m = 0) => Math.abs(x - d.x) <= d.hw - m && Math.abs(y - d.y) <= d.hh - m;
  services.set(idx(d.pc.x - (d.terraces ? 4 : 3), d.pc.y - (d.terraces ? 1 : 3)), { type: 'market', town: id });
  services.set(idx(d.pc.x + (d.terraces ? 4 : 3), d.pc.y - (d.terraces ? 1 : 3)), { type: 'carriage', town: id });
  // People with a part in the story wait on the square.
  const npc = { ironhold: 'herald', frosthollow: 'elder', ratsnest: 'king' }[id];
  if (npc) services.set(idx(d.pc.x + 2, d.pc.y + 2), { type: 'npc', npc, town: id });
  const street = (x, y) => d.terraces ? Math.abs(x - d.x) <= 2 : Math.abs(x - d.x) <= 2 || Math.abs(y - d.y) <= 2;
  const big = id === 'ironhold';
  const plaza = (x, y) => Math.abs(x - d.pc.x) <= (big ? 5 : 4) && Math.abs(y - d.pc.y) <= (big ? 4 : 2);
  const reserved = new Set();
  const flat = (x, y, w, h) => {
    let lo = Infinity, hi = -Infinity;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const i = idx(xx, yy);
      if (terrain[i] !== T.FLOOR || services.has(i) || townBlocks.has(i) || reserved.has(i)) return false;
      lo = Math.min(lo, tileH[i]); hi = Math.max(hi, tileH[i]);
    }
    return hi - lo < 0.2;
  };

  // The landmark.
  const lm = LANDMARKS[id];
  if (lm.kind === 'lighthouse') {
    for (let r = 0; r < 12; r++) {
      let done = false;
      for (let k = 0; k < Math.max(1, r * 8) && !done; k++) {
        const a = k / Math.max(1, r * 8) * Math.PI * 2;
        const x = Math.round(d.x - d.hw + 3 + Math.cos(a) * r), y = Math.round(d.y + d.hh + 3 + Math.sin(a) * r);
        let ok = true, wet = false;
        for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) {
          const t = terrain[idx(xx, yy)];
          if (t !== T.SAND && t !== T.GRASS) ok = false;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([p, q]) => terrain[idx(xx + p, yy + q)] === T.WATER)) wet = true;
        }
        if (ok && wet) {
          for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) { nodes.delete(idx(xx, yy)); townBlocks.add(idx(xx, yy)); }
          townLandmarks.push({ town: id, kind: 'lighthouse', x, y, w: 3, h: 3 });
          done = true;
        }
      }
      if (done) break;
    }
  } else {
    const x = d.x + lm.dx, y = d.y + lm.dy;
    if (flat(x, y, lm.w, lm.h)) {
      for (let yy = y; yy < y + lm.h; yy++) for (let xx = x; xx < x + lm.w; xx++) townBlocks.add(idx(xx, yy));
      townLandmarks.push({ town: id, kind: lm.kind, x, y, w: lm.w, h: lm.h });
    }
  }

  // House lots, packed with one-tile alleys between them.
  for (let y = d.y - d.hh + 1; y <= d.y + d.hh - 3; y++) {
    for (let x = d.x - d.hw + 1; x <= d.x + d.hw - 3; x++) {
      if (!inRect(x, y, 1) && !d.terraces) continue;
      let ok = flat(x, y, 3, 3);
      for (let yy = y; yy < y + 3 && ok; yy++) for (let xx = x; xx < x + 3 && ok; xx++) if (street(xx, yy) || plaza(xx, yy)) ok = false;
      for (let yy = y - 1; yy < y + 4 && ok; yy++) for (let xx = x - 1; xx < x + 4 && ok; xx++) if (townBlocks.has(idx(xx, yy))) ok = false;
      if (ok && d.terraces) {
        // Houses back onto the terrace wall above, leaving a walkway in front.
        for (let xx = x; xx < x + 3; xx++) if (inRect(xx, y - 1) && terrain[idx(xx, y - 1)] !== T.WALL) ok = false;
      }
      if (!ok) continue;
      if (tr() < 0.15) { for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) reserved.add(idx(xx, yy)); continue; }
      const cx = x + 1, cy = y + 1;
      let rot;
      if (d.terraces) rot = 0;
      else if (Math.abs(cx - d.x) / d.hw < Math.abs(cy - d.y) / d.hh) rot = cx < d.x ? Math.PI / 2 : -Math.PI / 2;
      else rot = cy < d.y ? 0 : Math.PI;
      for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) townBlocks.add(idx(xx, yy));
      townHouses.push({ x, y, w: 3, h: 3, rot, town: id, seed: tr() });
    }
  }
}
