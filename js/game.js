// Ironhold: an ASCII refinement empire. Engine, world, UI.
'use strict';

const SAVE_KEY = 'ironhold-save-v1';
const W = 160, H = 100;
const TOWN = { x: 80, y: 50, x0: 68, x1: 92, y0: 43, y1: 57 };
let VW = 61, VH = 27;
const TICK = 100;
const WORLD_SEED = 1337;

// ---------------------------------------------------------------- utilities
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const fmt = n => Math.floor(n).toLocaleString();
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const idx = (x, y) => y * W + x;
const distTown = (x, y) => Math.hypot(x - TOWN.x, (y - TOWN.y) * 1.6);
const inTown = (x, y) => x >= TOWN.x0 && x <= TOWN.x1 && y >= TOWN.y0 && y <= TOWN.y1;
const itemName = id => (ITEMS[id] ? ITEMS[id].name : id);
const skillName = id => SKILLS.find(s => s.id === id).name;

function valueNoise(seed) {
  const h = (x, y) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const sm = t => t * t * (3 - 2 * t);
  const n = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y) => 0.65 * n(x / 11, y / 7) + 0.35 * n(x / 4, y / 3);
}

// ---------------------------------------------------------------- world
const T = { GRASS: 0, WATER: 1, WALL: 2, FLOOR: 3, ROAD: 4, MOUNTAIN: 5, BRIDGE: 6 };
const WALKABLE = new Set([T.GRASS, T.FLOOR, T.ROAD, T.BRIDGE]);
const terrain = new Uint8Array(W * H);
const deco = new Uint8Array(W * H);
const nodes = new Map();    // idx -> { res, until }
const stations = new Map(); // idx -> station id
const sites = new Map();    // idx -> camp id
const sitePos = {};         // camp id -> {x,y}

function pickWeighted(r, list) {
  let roll = r(), acc = 0;
  for (const [v, w] of list) { acc += w; if (roll < acc) return v; }
  return list[list.length - 1][0];
}

function generateWorld() {
  const r = mulberry32(WORLD_SEED);
  const nf = valueNoise(1), nr = valueNoise(2), nw = valueNoise(3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = idx(x, y);
    deco[i] = Math.floor(r() * 10);
    if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) { terrain[i] = T.MOUNTAIN; continue; }
    terrain[i] = T.GRASS;
    const d = distTown(x, y);
    if (d < 16) continue;
    const dx = (x - TOWN.x) / W, dy = (y - TOWN.y) / H;
    const water = nw(x + 400, y + 400) + dy * 0.25;
    const forest = nf(x, y) - dx * 0.35;
    const rock = nr(x + 200, y + 200) + dx * 0.35;
    if (water > 0.74) { terrain[i] = T.WATER; continue; }
    if (forest > 0.6 && r() < 0.55) {
      const res = d < 34 ? pickWeighted(r, [['pine', 0.9], ['oak', 0.1]])
        : d < 55 ? pickWeighted(r, [['pine', 0.3], ['oak', 0.65], ['ironwood', 0.05]])
        : pickWeighted(r, [['oak', 0.5], ['ironwood', 0.5]]);
      nodes.set(i, { res, until: 0 });
    } else if (rock > 0.66 && r() < 0.35) {
      const res = d < 34 ? pickWeighted(r, [['copper', 0.88], ['iron', 0.12]])
        : d < 55 ? pickWeighted(r, [['copper', 0.15], ['iron', 0.5], ['coal', 0.35]])
        : pickWeighted(r, [['iron', 0.45], ['coal', 0.55]]);
      nodes.set(i, { res, until: 0 });
    }
  }
  // Hand-placed starter areas so the first minutes are always fun.
  const blob = (cx, cy, rx, ry, fn) => {
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) fn(x, y, idx(x, y));
    }
  };
  blob(57, 41, 6, 4, (x, y, i) => { if (r() < 0.55) nodes.set(i, { res: 'pine', until: 0 }); });
  blob(104, 41, 5, 3, (x, y, i) => { if (r() < 0.45) nodes.set(i, { res: 'copper', until: 0 }); });
  blob(80, 70, 9, 4, (x, y, i) => { terrain[i] = T.WATER; nodes.delete(i); });
  // Fishing spots on shoreline water.
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    const i = idx(x, y);
    if (terrain[i] !== T.WATER) continue;
    const shore = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => terrain[idx(x + a, y + b)] !== T.WATER);
    if (!shore) continue;
    const d = distTown(x, y);
    const nearPond = d < 34;
    if (r() < (nearPond ? 0.18 : 0.07)) {
      const res = d < 34 ? 'minnow' : d < 55 ? pickWeighted(r, [['minnow', 0.3], ['trout', 0.7]]) : pickWeighted(r, [['trout', 0.4], ['pike', 0.6]]);
      nodes.set(i, { res, until: 0 });
    }
  }
  // Town walls and floor.
  for (let y = TOWN.y0; y <= TOWN.y1; y++) for (let x = TOWN.x0; x <= TOWN.x1; x++) {
    const i = idx(x, y);
    nodes.delete(i);
    const edge = x === TOWN.x0 || x === TOWN.x1 || y === TOWN.y0 || y === TOWN.y1;
    terrain[i] = edge ? T.WALL : T.FLOOR;
  }
  // Roads out of each gate, bridging water.
  const road = (x, y) => {
    const i = idx(x, y);
    if (terrain[i] === T.MOUNTAIN || inTown(x, y)) return;
    terrain[i] = terrain[i] === T.WATER ? T.BRIDGE : T.ROAD;
    nodes.delete(i);
  };
  for (let y = 2; y < H - 2; y++) road(TOWN.x, y);
  for (let x = 2; x < W - 2; x++) road(x, TOWN.y);
  for (const [x, y] of [[TOWN.x, TOWN.y0], [TOWN.x, TOWN.y1], [TOWN.x0, TOWN.y], [TOWN.x1, TOWN.y]]) terrain[idx(x, y)] = T.FLOOR;
  // Stations.
  const place = (x, y, id) => stations.set(idx(x, y), id);
  place(73, 46, 'market'); place(76, 46, 'hall');
  place(85, 46, 'furnace'); place(88, 46, 'anvil');
  place(73, 54, 'sawmill'); place(87, 54, 'range');
  // Camp sites along the roads.
  const site = (x, y, id) => {
    const i = idx(x, y);
    terrain[i] = T.GRASS; nodes.delete(i);
    sites.set(i, id); sitePos[id] = { x, y };
  };
  site(58, 48, 'lumber');
  site(103, 48, 'mine');
  site(83, 65, 'fishery');
}

function walkableTerrain(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  return WALKABLE.has(terrain[idx(x, y)]);
}
function nodeActive(n, now) { return n && n.until <= now; }

// ---------------------------------------------------------------- state
let state = null;
let monsters = [];
let action = null;
let messages = [];
let nextMonsterId = 1;
let uiDirty = true;
let modal = null;          // { kind, data }
let hoverText = '';
let sidebarTab = 'skills';
let lastMove = 0;
let lastEat = 0;
let lastRegen = 0;
let lastSpawn = 0;
let lastSave = 0;
let lastTick = 0;

function newState() {
  const xp = {};
  for (const s of SKILLS) xp[s.id] = 0;
  xp.hitpoints = xpForLevel(10);
  const camps = {}, works = {};
  for (const id in CAMPS) camps[id] = { built: false, level: 0, workers: 0, guards: [], out: null, store: {}, acc: 0 };
  for (const id in WORKS) works[id] = { built: false, level: 0, workers: 0, recipe: null, on: true, acc: 0, starved: false };
  return {
    v: 1, x: TOWN.x, y: TOWN.y, hp: 10, gold: 25, xp,
    inv: { worn_axe: 1, worn_pickaxe: 1, fishing_rod: 1, minnow: 3 },
    equip: { weapon: null, shield: null, head: null, body: null },
    style: 'attack',
    market: { mult: {}, supply: {}, prev: {}, event: null, timer: 0 },
    empire: { camps, works, raidTimer: 0, unpaid: false },
    threat: 10,
    stats: { kills: 0, earned: 0 },
    savedAt: Date.now(),
    seenHelp: false,
  };
}

function save() {
  state.savedAt = Date.now();
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  lastSave = Date.now();
}

function load() {
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
  if (!raw) return false;
  try {
    const s = JSON.parse(raw);
    const fresh = newState();
    // Merge so that saves from older versions pick up new fields.
    state = Object.assign(fresh, s);
    state.xp = Object.assign(fresh.xp, s.xp || {});
    state.equip = Object.assign(newState().equip, s.equip || {});
    for (const id in CAMPS) state.empire.camps[id] = Object.assign(newState().empire.camps[id], (s.empire && s.empire.camps && s.empire.camps[id]) || {});
    for (const id in WORKS) state.empire.works[id] = Object.assign(newState().empire.works[id], (s.empire && s.empire.works && s.empire.works[id]) || {});
    return true;
  } catch (e) {
    return false;
  }
}

// ---------------------------------------------------------------- skills & items
function levelOf(xp) {
  let l = 1;
  while (l < MAX_LEVEL && xp >= xpForLevel(l + 1)) l++;
  return l;
}
const lvl = s => levelOf(state.xp[s]);
const maxHp = () => lvl('hitpoints');

function addXp(skill, amount) {
  const before = lvl(skill);
  state.xp[skill] += amount;
  const after = lvl(skill);
  if (after > before) {
    log(`Level up! ${skillName(skill)} is now level ${after}.`, 'level');
    if (skill === 'hitpoints') state.hp += after - before;
  }
  uiDirty = true;
}

function combatLevel() {
  return Math.floor(0.25 * (lvl('defence') + lvl('hitpoints')) + 0.325 * (lvl('attack') + lvl('strength')));
}

const have = id => state.inv[id] || 0;
function addItem(id, n = 1) { state.inv[id] = have(id) + n; uiDirty = true; }
function removeItem(id, n = 1) {
  state.inv[id] = have(id) - n;
  if (state.inv[id] <= 0) delete state.inv[id];
  uiDirty = true;
}
function hasAll(req, mult = 1) {
  for (const k in req) {
    if (k === 'gold') { if (state.gold < req[k] * mult) return false; }
    else if (have(k) < req[k] * mult) return false;
  }
  return true;
}
function payAll(req) {
  for (const k in req) {
    if (k === 'gold') state.gold -= req[k];
    else removeItem(k, req[k]);
  }
}
const costText = req => Object.entries(req).map(([k, v]) => k === 'gold' ? `${fmt(v)}g` : `${v} ${itemName(k)}`).join(', ');

function bestTool(kind) {
  let best = null;
  const skill = TOOL_SKILL[kind];
  for (const id in state.inv) {
    const it = ITEMS[id];
    if (it && it.tool === kind && lvl(skill) >= it.req && (!best || it.tier > ITEMS[best].tier)) best = id;
  }
  return best;
}

function equipStats() {
  const s = { acc: 0, str: 0, def: 0 };
  for (const slot in state.equip) {
    const id = state.equip[slot];
    if (!id) continue;
    const st = ITEMS[id].stats || {};
    s.acc += st.acc || 0; s.str += st.str || 0; s.def += st.def || 0;
  }
  return s;
}

function equip(id) {
  const it = ITEMS[id];
  if (!it || !it.slot || !have(id)) return;
  const sk = SLOT_SKILL[it.slot];
  if (lvl(sk) < it.req) { log(`You need ${skillName(sk)} level ${it.req} to wear the ${it.name}.`, 'warn'); return; }
  const old = state.equip[it.slot];
  if (old) addItem(old);
  removeItem(id);
  state.equip[it.slot] = id;
  log(`You equip the ${it.name}.`);
}
function unequip(slot) {
  const id = state.equip[slot];
  if (!id) return;
  addItem(id);
  state.equip[slot] = null;
  log(`You remove the ${itemName(id)}.`);
}

function eat(id) {
  const now = Date.now();
  if (now - lastEat < 1200) return;
  if (!id) {
    // Eat the smallest food that doesn't overheal much, else the biggest.
    const foods = Object.keys(state.inv).filter(k => ITEMS[k] && ITEMS[k].heal).sort((a, b) => ITEMS[a].heal - ITEMS[b].heal);
    if (!foods.length) { log('You have no food.', 'warn'); return; }
    const missing = maxHp() - state.hp;
    id = foods.find(f => ITEMS[f].heal >= missing) || foods[foods.length - 1];
  }
  if (!have(id) || !ITEMS[id].heal) return;
  if (state.hp >= maxHp()) { log('You are already at full health.'); return; }
  removeItem(id);
  state.hp = Math.min(maxHp(), state.hp + ITEMS[id].heal);
  lastEat = now;
  log(`You eat the ${ITEMS[id].name}. (+${ITEMS[id].heal} HP)`, 'good');
}

// ---------------------------------------------------------------- messages
function log(text, cls = '') {
  messages.push({ text, cls });
  if (messages.length > 80) messages.shift();
  uiDirty = true;
}

// ---------------------------------------------------------------- monsters
function monsterAt(x, y) { return monsters.find(m => m.x === x && m.y === y && m.hp > 0); }

function blocked(x, y, forMonster) {
  if (!walkableTerrain(x, y)) return true;
  const i = idx(x, y);
  if (nodeActive(nodes.get(i), Date.now())) return true;
  if (stations.has(i) || sites.has(i)) return true;
  if (monsterAt(x, y)) return true;
  if (forMonster) {
    if (x === state.x && y === state.y) return true;
    if (distTown(x, y) < 15) return true;
  }
  return false;
}

function spawnMonster(nearPlayerOk) {
  for (let tries = 0; tries < 30; tries++) {
    const x = randInt(3, W - 4), y = randInt(3, H - 4);
    const d = distTown(x, y);
    if (d < 20 || blocked(x, y, true)) continue;
    if (!nearPlayerOk && Math.abs(x - state.x) < 34 && Math.abs(y - state.y) < 16) continue;
    const type = d < 36 ? pickWeighted(Math.random, [['goblin', 0.65], ['wolf', 0.35]])
      : d < 56 ? pickWeighted(Math.random, [['goblin', 0.1], ['wolf', 0.4], ['bandit', 0.5]])
      : pickWeighted(Math.random, [['wolf', 0.1], ['bandit', 0.45], ['ogre', 0.45]]);
    monsters.push({ id: nextMonsterId++, type, x, y, hx: x, hy: y, hp: MONSTERS[type].hp, aggro: false, nextMove: 0, nextAtk: 0 });
    return;
  }
}

function stepToward(m, tx, ty) {
  const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
  const opts = Math.abs(tx - m.x) > Math.abs(ty - m.y) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
  for (const [a, b] of opts) {
    if ((a || b) && !blocked(m.x + a, m.y + b, true)) { m.x += a; m.y += b; return; }
  }
}

function updateMonsters(now) {
  const cl = combatLevel();
  for (const m of monsters) {
    if (m.hp <= 0) continue;
    const def = MONSTERS[m.type];
    const dist = Math.abs(m.x - state.x) + Math.abs(m.y - state.y);
    if (!m.aggro && def.aggressive && dist <= 6 && cl <= def.level * 2 + 4 && !inTown(state.x, state.y)) {
      m.aggro = true;
      log(`A ${def.name.toLowerCase()} notices you!`, 'warn');
    }
    if (m.aggro && (dist > 15 || inTown(state.x, state.y) || Math.abs(m.x - m.hx) + Math.abs(m.y - m.hy) > 25)) m.aggro = false;
    if (now >= m.nextMove) {
      if (m.aggro) {
        if (dist > 1) stepToward(m, state.x, state.y);
        m.nextMove = now + def.move;
      } else {
        // Wander, but drift back toward home when strayed too far.
        if (Math.abs(m.x - m.hx) + Math.abs(m.y - m.hy) > 8) stepToward(m, m.hx, m.hy);
        else if (Math.random() < 0.4) {
          const [a, b] = [[1, 0], [-1, 0], [0, 1], [0, -1]][randInt(0, 3)];
          if (!blocked(m.x + a, m.y + b, true)) { m.x += a; m.y += b; }
        }
        m.nextMove = now + 1200 + Math.random() * 2000;
      }
    }
    const adj = Math.abs(m.x - state.x) + Math.abs(m.y - state.y) === 1;
    if (m.aggro && adj && now >= m.nextAtk) {
      monsterAttack(m);
      m.nextAtk = now + def.speed;
      if (!action) { action = { type: 'combat', id: m.id, next: now + 600 }; }
    }
  }
  monsters = monsters.filter(m => m.hp > 0);
}

function hitChance(atkRoll, defRoll) {
  return atkRoll > defRoll ? 1 - (defRoll + 2) / (2 * (atkRoll + 1)) : atkRoll / (2 * (defRoll + 1));
}

function playerAttack(m) {
  const def = MONSTERS[m.type], eq = equipStats();
  const atkL = lvl('attack') + (state.style === 'attack' ? 3 : 0);
  const strL = lvl('strength') + (state.style === 'strength' ? 3 : 0);
  const hit = Math.random() < hitChance((atkL + 8) * (64 + eq.acc), (def.def + 8) * 64);
  const maxHit = Math.max(1, Math.floor(0.5 + (strL + 8) * (64 + eq.str) / 640));
  const dmg = hit ? randInt(1, maxHit) : 0;
  m.aggro = true;
  m.flash = Date.now() + 250;
  if (dmg > 0) {
    m.hp -= dmg;
    addXp(state.style, dmg * 4);
    addXp('hitpoints', dmg * 1.33);
  }
  if (m.hp <= 0) killMonster(m);
}

function monsterAttack(m) {
  const def = MONSTERS[m.type], eq = equipStats();
  const defL = lvl('defence') + (state.style === 'defence' ? 3 : 0);
  const hit = Math.random() < hitChance((def.atk + 8) * 64, (defL + 8) * (64 + eq.def));
  const dmg = hit ? randInt(1, def.maxHit) : 0;
  if (dmg > 0) {
    state.hp -= dmg;
    playerFlash = Date.now() + 250;
    uiDirty = true;
    if (state.hp <= 0) die(def);
  }
}
let playerFlash = 0;

function killMonster(m) {
  const def = MONSTERS[m.type];
  state.stats.kills++;
  const loot = [];
  const coins = randInt(def.coins[0], def.coins[1]);
  if (coins > 0) { state.gold += coins; loot.push(`${coins} gold`); }
  for (const [id, chance] of def.drops) {
    if (Math.random() < chance) { addItem(id); loot.push(itemName(id)); }
  }
  if (def.threat) state.threat = Math.max(0, state.threat + def.threat);
  log(`You defeat the ${def.name.toLowerCase()}${loot.length ? '. Loot: ' + loot.join(', ') : '.'}`, 'good');
  action = null;
}

function die(killer) {
  const lost = Math.floor(state.gold * 0.1);
  state.gold -= lost;
  state.hp = maxHp();
  state.x = TOWN.x; state.y = TOWN.y;
  action = null;
  for (const m of monsters) m.aggro = false;
  log(`You were slain by a ${killer.name.toLowerCase()}! You wake in town, ${lost} gold lighter.`, 'bad');
}

// ---------------------------------------------------------------- player actions
function tryMove(dx, dy) {
  const now = Date.now();
  if (now - lastMove < 110) return;
  lastMove = now;
  const tx = state.x + dx, ty = state.y + dy;
  const i = idx(tx, ty);
  const m = monsterAt(tx, ty);
  if (m) { startCombat(m); return; }
  const n = nodes.get(i);
  if (nodeActive(n, now)) { startGather(i); return; }
  if (stations.has(i)) { openStation(stations.get(i)); return; }
  if (sites.has(i)) { openModal('empire', { focus: sites.get(i) }); return; }
  if (blocked(tx, ty)) return;
  state.x = tx; state.y = ty;
  if (action) { action = null; }
  uiDirty = true;
}

function startCombat(m) {
  if (inTown(state.x, state.y)) return;
  action = { type: 'combat', id: m.id, next: Date.now() + 300 };
  m.aggro = true;
}

function startGather(i) {
  const n = nodes.get(i), r = RESOURCES[n.res];
  if (lvl(r.skill) < r.level) { log(`You need ${skillName(r.skill)} level ${r.level} for the ${r.name.toLowerCase()}.`, 'warn'); return; }
  const tool = bestTool(r.tool);
  if (!tool) { log(`You need ${r.tool === 'rod' ? 'a fishing rod' : 'an ' + r.tool} for that.`, 'warn'); return; }
  if (action && action.type === 'gather' && action.i === i) return;
  action = { type: 'gather', i, next: Date.now() + gatherTime(tool) };
  const verb = { woodcutting: 'chop at', mining: 'mine', fishing: 'fish at' }[r.skill];
  log(`You ${verb} the ${r.name.toLowerCase()}...`);
}
const gatherTime = tool => 2400 - ITEMS[tool].tier * 300;

function processGather(now) {
  const n = nodes.get(action.i);
  if (!nodeActive(n, now)) { action = null; return; }
  const r = RESOURCES[n.res];
  const tool = bestTool(r.tool);
  if (!tool) { action = null; return; }
  const chance = clamp(0.3 + (lvl(r.skill) - r.level) * 0.025 + ITEMS[tool].tier * 0.07, 0.05, 0.95);
  if (Math.random() < chance) {
    addItem(r.item);
    addXp(r.skill, r.xp);
    log(`You get some ${itemName(r.item).toLowerCase()}.`);
    if (Math.random() < r.deplete) {
      n.until = now + r.respawn * 1000;
      log(r.skill === 'woodcutting' ? 'The tree falls.' : 'The rock is exhausted.', 'dim');
      action = null;
      return;
    }
  }
  action.next = now + gatherTime(tool);
}

function processCombat(now) {
  const m = monsters.find(mm => mm.id === action.id && mm.hp > 0);
  if (!m) { action = null; return; }
  const dist = Math.abs(m.x - state.x) + Math.abs(m.y - state.y);
  if (dist > 8) { action = null; return; }
  if (dist !== 1) return;
  const weaponTier = state.equip.weapon ? ITEMS[state.equip.weapon].tier : 0;
  playerAttack(m);
  if (action) action.next = now + 2400 - weaponTier * 150;
}

function startCraft(recipeId, n) {
  const r = RECIPES[recipeId];
  if (lvl(r.skill) < r.level) { log(`You need ${skillName(r.skill)} level ${r.level}.`, 'warn'); return; }
  if (!hasAll(r.inputs)) { log(`You need ${costText(r.inputs)}.`, 'warn'); return; }
  action = { type: 'craft', recipe: recipeId, left: n, next: Date.now() + 1200 };
  closeModal();
  log(`You start making ${itemName(Object.keys(r.outputs)[0]).toLowerCase()}...`);
}

function processCraft(now) {
  const r = RECIPES[action.recipe];
  if (!hasAll(r.inputs)) { log('You run out of materials.', 'dim'); action = null; return; }
  payAll(r.inputs);
  if (r.burn && Math.random() < Math.max(0, 0.45 - (lvl(r.skill) - r.level) * 0.04)) {
    addItem('burnt_fish');
    log('You accidentally burn the fish.', 'dim');
    addXp(r.skill, 1);
  } else {
    for (const k in r.outputs) addItem(k, r.outputs[k]);
    addXp(r.skill, r.xp);
  }
  action.left--;
  if (action.left <= 0 || !hasAll(r.inputs)) {
    log(`You finish crafting.`, 'dim');
    action = null;
    return;
  }
  action.next = now + 1200;
}

// ---------------------------------------------------------------- market
function marketInit() {
  const m = state.market;
  for (const id in ITEMS) {
    if (m.mult[id] == null) m.mult[id] = 0.85 + Math.random() * 0.3;
    if (m.prev[id] == null) m.prev[id] = m.mult[id];
    if (m.supply[id] == null) m.supply[id] = 0;
  }
}

function marketDrift() {
  const m = state.market;
  for (const id in ITEMS) {
    m.prev[id] = m.mult[id];
    const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 0.08;
    m.mult[id] = clamp(m.mult[id] + (1 - m.mult[id]) * 0.06 + noise, 0.5, 2.0);
    m.supply[id] *= 0.92;
  }
  if (m.event && --m.event.left <= 0) m.event = null;
  if (!m.event && Math.random() < 0.06) {
    const pool = Object.keys(ITEMS).filter(k => !ITEMS[k].tool || ITEMS[k].tier > 0);
    const id = pool[randInt(0, pool.length - 1)];
    const boom = Math.random() < 0.65;
    m.mult[id] = boom ? 1.9 : 0.55;
    m.event = { id, boom, left: 6 };
    return boom ? `Market news: a royal order drives up the price of ${itemName(id).toLowerCase()}!`
      : `Market news: a glut of ${itemName(id).toLowerCase()} floods the stalls.`;
  }
  return null;
}

function sellPrice(id) {
  const m = state.market;
  return Math.max(1, Math.round(ITEMS[id].value * m.mult[id] / (1 + m.supply[id] / 60)));
}
const buyPrice = id => Math.ceil(ITEMS[id].value * state.market.mult[id] * 1.5);

function sell(id, n) {
  n = Math.min(n, have(id));
  let total = 0;
  for (let k = 0; k < n; k++) {
    total += sellPrice(id);
    state.market.supply[id] += 1;
  }
  if (!n) return;
  removeItem(id, n);
  state.gold += total;
  state.stats.earned += total;
  log(`Sold ${n} ${itemName(id)} for ${fmt(total)} gold.`, 'gold');
}

function buy(id, n) {
  let bought = 0, total = 0;
  for (let k = 0; k < n; k++) {
    const p = buyPrice(id);
    if (state.gold < p) break;
    state.gold -= p; total += p; bought++;
  }
  if (!bought) { log('You cannot afford that.', 'warn'); return; }
  addItem(id, bought);
  log(`Bought ${bought} ${itemName(id)} for ${fmt(total)} gold.`, 'gold');
}

// ---------------------------------------------------------------- empire
function campOutputs(id) {
  return Object.keys(RESOURCES).filter(r => RESOURCES[r].skill === CAMPS[id].skill && lvl(RESOURCES[r].skill) >= RESOURCES[r].level);
}
function worksRecipes(id) {
  return Object.keys(RECIPES).filter(r => RECIPES[r].skill === WORKS[id].skill && lvl(RECIPES[r].skill) >= RECIPES[r].level);
}
const campStored = c => Object.values(c.store).reduce((a, b) => a + b, 0);

function wagesPerMin() {
  const E = state.empire;
  let w = 0;
  for (const id in E.camps) { const c = E.camps[id]; if (c.built) w += c.workers * EMPIRE.wage.gatherer + c.guards.length * EMPIRE.wage.guard; }
  for (const id in E.works) { const k = E.works[id]; if (k.built && k.on) w += k.workers * EMPIRE.wage.refiner; }
  return w;
}

// Advance the empire by dt seconds. `report` collects totals for offline summaries.
function simEmpire(dt, report) {
  const E = state.empire;
  const wage = wagesPerMin() * dt / 60;
  if (wage > 0) {
    if (state.gold < wage) {
      if (!E.unpaid) logOrReport(report, 'Your workers are unpaid and have stopped working!', 'bad');
      E.unpaid = true;
      return;
    }
    state.gold -= wage;
    if (report) report.wages += wage;
  }
  E.unpaid = false;
  for (const id in E.camps) {
    const c = E.camps[id];
    if (!c.built || !c.workers || !c.out) continue;
    c.acc += c.workers * EMPIRE.ratePerWorker * (1 + 0.25 * (c.level - 1)) * dt / 60;
    const n = Math.floor(c.acc);
    c.acc -= n;
    const room = EMPIRE.campCap(c.level) - campStored(c);
    const add = Math.min(n, Math.max(0, room));
    if (add > 0) {
      const item = RESOURCES[c.out].item;
      c.store[item] = (c.store[item] || 0) + add;
      if (report) report.produced[item] = (report.produced[item] || 0) + add;
    }
  }
  for (const id in E.works) {
    const k = E.works[id];
    if (!k.built || !k.on || !k.workers || !k.recipe) continue;
    k.acc += k.workers * EMPIRE.ratePerWorker * (1 + 0.25 * (k.level - 1)) * dt / 60;
    const n = Math.floor(k.acc);
    k.acc -= n;
    const r = RECIPES[k.recipe];
    k.starved = false;
    for (let j = 0; j < n; j++) {
      if (!hasAll(r.inputs)) { k.starved = true; k.acc = 0; break; }
      payAll(r.inputs);
      for (const o in r.outputs) {
        addItem(o, r.outputs[o]);
        if (report) report.produced[o] = (report.produced[o] || 0) + r.outputs[o];
      }
      if (report) for (const i in r.inputs) report.consumed[i] = (report.consumed[i] || 0) + r.inputs[i];
    }
  }
  state.threat = Math.min(100, state.threat + 0.5 * dt / 60);
  E.raidTimer += dt;
  while (E.raidTimer >= EMPIRE.raidInterval) {
    E.raidTimer -= EMPIRE.raidInterval;
    rollRaids(report);
  }
}

function logOrReport(report, text, cls) {
  if (report) report.events.push(text);
  else log(text, cls);
}

function rollRaids(report) {
  const E = state.empire;
  for (const id in E.camps) {
    const c = E.camps[id], def = CAMPS[id];
    if (!c.built) continue;
    const chance = (0.03 + state.threat / 400) * def.danger;
    if (Math.random() >= chance) continue;
    const strength = 4 + state.threat * 0.25 + Math.random() * 8 * def.danger;
    const defense = c.guards.reduce((a, t) => a + EMPIRE.guardPower(t), 0);
    if (defense >= strength) {
      state.threat = Math.max(0, state.threat - 5);
      logOrReport(report, `Bandits raided your ${def.name} but your guards drove them off!`, 'good');
      continue;
    }
    const frac = 0.4 + Math.random() * 0.4;
    let stolen = 0;
    for (const k in c.store) { const s = Math.floor(c.store[k] * frac); c.store[k] -= s; stolen += s; }
    let extra = '';
    if (c.workers > 0 && Math.random() < 0.25) { c.workers--; extra += ' A worker fled.'; }
    if (c.guards.length && Math.random() < 0.3) { c.guards.pop(); extra += ' A guard was killed.'; }
    state.threat = Math.max(0, state.threat - 15);
    logOrReport(report, `Bandits raided your ${def.name} and stole ${stolen} goods!${extra}`, 'bad');
  }
}

function upgradeCost(base, level) {
  const out = {};
  for (const k in base) out[k] = Math.round(base[k] * (k === 'gold' ? Math.pow(2.5, level) : level + 1));
  return out;
}

function empireAction(act, id) {
  const E = state.empire;
  const isCamp = !!CAMPS[id];
  const b = isCamp ? E.camps[id] : E.works[id];
  const def = isCamp ? CAMPS[id] : WORKS[id];
  switch (act) {
    case 'build': case 'upgrade': {
      if (b.level >= EMPIRE.maxLevel) return;
      const cost = upgradeCost(def.cost, b.level);
      if (!hasAll(cost)) { log(`You need ${costText(cost)}.`, 'warn'); return; }
      payAll(cost);
      b.level++;
      if (!b.built) {
        b.built = true;
        if (isCamp) b.out = campOutputs(id)[0] || null;
        else b.recipe = worksRecipes(id)[0] || null;
        log(`You built a ${def.name}!`, 'level');
      } else log(`${def.name} upgraded to level ${b.level}.`, 'level');
      break;
    }
    case 'hire': {
      if (b.workers >= EMPIRE.maxWorkers(b.level)) { log('No room for more workers. Upgrade first.', 'warn'); return; }
      const c = EMPIRE.hireCost(b.workers);
      if (state.gold < c) { log(`Hiring costs ${c} gold.`, 'warn'); return; }
      state.gold -= c; b.workers++;
      log(`You hired a worker for the ${def.name}.`);
      break;
    }
    case 'fire': if (b.workers > 0) { b.workers--; log('You let a worker go.'); } break;
    case 'guard': {
      if (b.guards.length >= EMPIRE.maxGuards(b.level)) { log('No room for more guards. Upgrade first.', 'warn'); return; }
      const swords = Object.keys(state.inv).filter(k => ITEMS[k] && ITEMS[k].sword).sort((a, c) => ITEMS[c].tier - ITEMS[a].tier);
      if (!swords.length) { log('Each guard needs a sword. Smith one at the anvil.', 'warn'); return; }
      if (state.gold < EMPIRE.guardCost) { log(`Hiring a guard costs ${EMPIRE.guardCost} gold.`, 'warn'); return; }
      state.gold -= EMPIRE.guardCost;
      removeItem(swords[0]);
      b.guards.push(ITEMS[swords[0]].tier);
      log(`You hired a guard armed with a ${itemName(swords[0]).toLowerCase()}.`);
      break;
    }
    case 'dismiss': if (b.guards.length) { b.guards.shift(); log('You dismissed a guard.'); } break;
    case 'collect': {
      const got = [];
      for (const k in b.store) if (b.store[k] > 0) { addItem(k, b.store[k]); got.push(`${b.store[k]} ${itemName(k)}`); }
      b.store = {};
      log(got.length ? `Collected ${got.join(', ')}.` : 'Nothing to collect.', got.length ? 'good' : 'dim');
      break;
    }
    case 'cycle': {
      const opts = isCamp ? campOutputs(id) : worksRecipes(id);
      if (!opts.length) return;
      const cur = isCamp ? b.out : b.recipe;
      const next = opts[(opts.indexOf(cur) + 1) % opts.length];
      if (isCamp) b.out = next; else { b.recipe = next; b.acc = 0; }
      break;
    }
    case 'toggle': b.on = !b.on; break;
  }
  uiDirty = true;
}

function collectAll() {
  for (const id in state.empire.camps) if (state.empire.camps[id].built) empireAction('collect', id);
}

// ---------------------------------------------------------------- offline progress
function runOffline() {
  const elapsed = Math.min((Date.now() - state.savedAt) / 1000, EMPIRE.offlineCapHours * 3600);
  if (elapsed < 30) return null;
  const report = { seconds: elapsed, produced: {}, consumed: {}, wages: 0, events: [] };
  const goldBefore = state.gold;
  const step = 10;
  for (let t = 0; t < elapsed; t += step) simEmpire(Math.min(step, elapsed - t), report);
  const drifts = Math.min(200, Math.floor(elapsed / 30));
  for (let k = 0; k < drifts; k++) marketDrift();
  state.market.event = null;
  report.goldDelta = state.gold - goldBefore;
  return report;
}

// ---------------------------------------------------------------- main loop
function update() {
  const now = Date.now();
  const dt = lastTick ? (now - lastTick) / 1000 : 0;
  lastTick = now;

  if (action && now >= action.next) {
    if (action.type === 'gather') processGather(now);
    else if (action.type === 'combat') processCombat(now);
    else if (action.type === 'craft') processCraft(now);
  }
  updateMonsters(now);

  if (now - lastSpawn > 2000) {
    lastSpawn = now;
    if (monsters.length < 70) spawnMonster(false);
  }
  if (now - lastRegen > 6000) {
    lastRegen = now;
    if (state.hp < maxHp()) { state.hp++; uiDirty = true; }
  }
  if (dt > 0 && dt < 5) simEmpire(dt, null);

  state.market.timer += dt;
  if (state.market.timer >= 30) {
    state.market.timer = 0;
    const news = marketDrift();
    if (news) log(news, 'gold');
    if (modal && modal.kind === 'market') uiDirty = true;
  }
  if (now - lastSave > 15000) save();

  renderMap();
  if (uiDirty) { renderUI(); uiDirty = false; }
}

// ---------------------------------------------------------------- rendering
const $ = id => document.getElementById(id);

const TERRAIN_DRAW = {
  [T.GRASS]: i => (deco[i] < 2 ? [',', 'grass2'] : deco[i] === 9 ? ['"', 'grass3'] : ['.', 'grass']),
  [T.WATER]: i => ['~', deco[i] % 2 ? 'water' : 'water2'],
  [T.WALL]: () => ['#', 'wall'],
  [T.FLOOR]: () => ['.', 'floor'],
  [T.ROAD]: () => ['=', 'road'],
  [T.MOUNTAIN]: () => ['^', 'mountain'],
  [T.BRIDGE]: () => ['=', 'bridge'],
};

function cellAt(x, y, now, mIndex) {
  if (x === state.x && y === state.y) return ['@', now < playerFlash ? 'player hurt' : 'player'];
  const i = idx(x, y);
  const m = mIndex.get(i);
  if (m) {
    const d = MONSTERS[m.type];
    return [d.ch, `mon ${d.cls}${m.aggro ? ' aggro' : ''}${now < (m.flash || 0) ? ' hurt' : ''}`];
  }
  if (stations.has(i)) return [STATIONS[stations.get(i)].ch, 'station'];
  if (sites.has(i)) {
    const id = sites.get(i);
    return [CAMPS[id].site, state.empire.camps[id].built ? 'site built' : 'site'];
  }
  const n = nodes.get(i);
  if (n) {
    const r = RESOURCES[n.res];
    if (nodeActive(n, now)) return [r.ch, r.cls];
    if (r.skill === 'woodcutting') return [';', 'stump'];
    if (r.skill === 'mining') return ['_', 'spent'];
  }
  return TERRAIN_DRAW[terrain[i]](i);
}

function camera() {
  return {
    x: clamp(state.x - Math.floor(VW / 2), 0, W - VW),
    y: clamp(state.y - Math.floor(VH / 2), 0, H - VH),
  };
}

function renderMap() {
  const now = Date.now(), cam = camera();
  const mIndex = new Map();
  for (const m of monsters) if (m.hp > 0) mIndex.set(idx(m.x, m.y), m);
  let html = '';
  for (let vy = 0; vy < VH; vy++) {
    let cur = null, buf = '';
    for (let vx = 0; vx < VW; vx++) {
      const [ch, cls] = cellAt(cam.x + vx, cam.y + vy, now, mIndex);
      if (cls !== cur) {
        if (buf) html += `<span class="${cur}">${esc(buf)}</span>`;
        cur = cls; buf = '';
      }
      buf += ch;
    }
    html += `<span class="${cur}">${esc(buf)}</span>\n`;
  }
  $('map').innerHTML = html;
  $('status').textContent = statusText(now);
}

function statusText(now) {
  let zone = inTown(state.x, state.y) ? 'Town of Ironhold' : (() => {
    const d = distTown(state.x, state.y);
    return d < 20 ? 'Town outskirts' : d < 36 ? 'The Green Wilds' : d < 56 ? 'Bandit Marches' : 'The Deep Wilds (danger!)';
  })();
  let act = '';
  if (action) {
    if (action.type === 'gather') act = ` | Gathering: ${RESOURCES[nodes.get(action.i).res].name}`;
    if (action.type === 'craft') act = ` | Crafting: ${itemName(Object.keys(RECIPES[action.recipe].outputs)[0])} (${action.left} left)`;
    if (action.type === 'combat') act = ' | In combat';
  }
  return `${zone} (${state.x},${state.y})${act}${hoverText ? ' | ' + hoverText : ''}`;
}

function describe(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return '';
  if (x === state.x && y === state.y) return 'You';
  const i = idx(x, y), now = Date.now();
  const m = monsterAt(x, y);
  if (m) { const d = MONSTERS[m.type]; return `${d.name} (lvl ${d.level}) ${Math.max(0, m.hp)}/${d.hp} HP`; }
  if (stations.has(i)) { const s = STATIONS[stations.get(i)]; return `${s.name}: ${s.desc}`; }
  if (sites.has(i)) { const c = CAMPS[sites.get(i)]; return `${c.name} site`; }
  const n = nodes.get(i);
  if (n) {
    const r = RESOURCES[n.res];
    return nodeActive(n, now) ? `${r.name} (${skillName(r.skill)} ${r.level})` : `Depleted ${r.name.toLowerCase()}`;
  }
  return { [T.GRASS]: 'Grass', [T.WATER]: 'Water', [T.WALL]: 'Town wall', [T.FLOOR]: 'Cobbles', [T.ROAD]: 'Road', [T.MOUNTAIN]: 'Mountains', [T.BRIDGE]: 'Bridge' }[terrain[i]];
}

function bar(cur, max, cls) {
  const pct = clamp(cur / max * 100, 0, 100);
  return `<div class="bar ${cls}"><div style="width:${pct}%"></div><span>${fmt(cur)} / ${fmt(max)}</span></div>`;
}

function renderUI() {
  $('gold').textContent = fmt(state.gold);
  $('hpbar').innerHTML = bar(Math.max(0, state.hp), maxHp(), 'hp');
  $('combat').textContent = `Combat lvl ${combatLevel()} | Style: ${cap(state.style)}`;
  $('threat').innerHTML = `Bandit threat: ${bar(state.threat, 100, 'threat')}`;
  $('wages').textContent = `Wages: ${wagesPerMin()}g/min${state.empire.unpaid ? ' (UNPAID!)' : ''}`;

  const tgt = action && action.type === 'combat' ? monsters.find(m => m.id === action.id) : null;
  $('target').innerHTML = tgt ? `<b>${MONSTERS[tgt.type].name}</b> (lvl ${MONSTERS[tgt.type].level})${bar(Math.max(0, tgt.hp), MONSTERS[tgt.type].hp, 'enemy')}` : '';

  for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b.dataset.tab === sidebarTab);
  $('tabbody').innerHTML = sidebarTab === 'skills' ? skillsHtml() : sidebarTab === 'inv' ? invHtml() : gearHtml();

  $('log').innerHTML = messages.slice(-40).map(m => `<div class="${m.cls}">${esc(m.text)}</div>`).join('');
  $('log').scrollTop = $('log').scrollHeight;

  if (modal) renderModal();
}

function skillsHtml() {
  let html = '';
  for (const group of ['combat', 'gathering', 'refining']) {
    html += `<div class="group">${cap(group)}</div>`;
    for (const s of SKILLS.filter(k => k.group === group)) {
      const xp = state.xp[s.id], l = levelOf(xp);
      const lo = xpForLevel(l), hi = xpForLevel(l + 1);
      const pct = l >= MAX_LEVEL ? 100 : (xp - lo) / (hi - lo) * 100;
      html += `<div class="skill" title="${fmt(xp)} XP${l < MAX_LEVEL ? `, ${fmt(hi - xp)} to next level` : ''}">
        <span>${s.name}</span><span class="lv">${l}</span>
        <div class="xpbar"><div style="width:${pct}%"></div></div></div>`;
    }
  }
  return html;
}

function invHtml() {
  const ids = Object.keys(state.inv).sort((a, b) => itemName(a).localeCompare(itemName(b)));
  if (!ids.length) return '<div class="dim">Your pack is empty.</div>';
  return '<div class="dim small">Click food to eat, gear to equip.</div>' + ids.map(id => {
    const it = ITEMS[id];
    const tag = it.heal ? `<span class="tag">+${it.heal}hp</span>` : it.slot ? '<span class="tag">equip</span>' : it.tool ? '<span class="tag">tool</span>' : it.rare ? '<span class="tag rare">rare</span>' : '';
    return `<div class="item${it.heal || it.slot ? ' click' : ''}" data-item="${id}"><span>${esc(it.name)} ${tag}</span><span>x${fmt(state.inv[id])}</span></div>`;
  }).join('');
}

function gearHtml() {
  const eq = equipStats();
  let html = '';
  for (const slot of ['weapon', 'shield', 'head', 'body']) {
    const id = state.equip[slot];
    html += `<div class="item${id ? ' click' : ''}" data-unequip="${slot}"><span class="dim">${cap(slot)}</span><span>${id ? esc(itemName(id)) : '-'}</span></div>`;
  }
  html += `<div class="small">Accuracy +${eq.acc} | Power +${eq.str} | Armour +${eq.def}</div>`;
  html += '<div class="group">Tools (best is used)</div>';
  for (const t of ['axe', 'pickaxe', 'rod']) html += `<div class="item"><span class="dim">${cap(t)}</span><span>${bestTool(t) ? esc(itemName(bestTool(t))) : 'none'}</span></div>`;
  html += `<div class="group">Combat style</div>
    <div class="row">${['attack', 'strength', 'defence'].map(s => `<button data-style="${s}" class="${state.style === s ? 'on' : ''}">${cap(s)}</button>`).join('')}</div>
    <div class="small dim">Your style gets +3 effective levels and earns the XP.</div>
    <div class="small">Kills: ${state.stats.kills} | Lifetime sales: ${fmt(state.stats.earned)}g</div>`;
  return html;
}

// ---------------------------------------------------------------- modals
function openStation(id) {
  if (id === 'market') openModal('market');
  else if (id === 'hall') openModal('empire', {});
  else openModal('craft', { station: id });
}
function openModal(kind, data = {}) { modal = { kind, data }; $('modal').classList.remove('hidden'); renderModal(); }
function closeModal() { modal = null; $('modal').classList.add('hidden'); }

function renderModal() {
  const body = $('modal-body');
  const keepScroll = body.scrollTop;
  let html = '';
  if (modal.kind === 'craft') html = craftHtml(modal.data.station);
  else if (modal.kind === 'market') html = marketHtml();
  else if (modal.kind === 'empire') html = empireHtml();
  else if (modal.kind === 'help') html = helpHtml();
  else if (modal.kind === 'offline') html = offlineHtml(modal.data);
  body.innerHTML = html;
  body.scrollTop = keepScroll;
  if (modal.data.focus) {
    const el = document.getElementById('b-' + modal.data.focus);
    if (el) el.scrollIntoView({ block: 'center' });
    modal.data.focus = null;
  }
}

function craftHtml(stationId) {
  const st = STATIONS[stationId];
  const recipes = Object.values(RECIPES).filter(r => r.skill === st.skill);
  let html = `<h2>${st.name}</h2><p class="dim">${st.desc} ${skillName(st.skill)} level ${lvl(st.skill)}.</p><table class="list">`;
  for (const r of recipes) {
    const out = Object.keys(r.outputs)[0];
    const locked = lvl(r.skill) < r.level;
    let maxN = Infinity;
    for (const k in r.inputs) maxN = Math.min(maxN, Math.floor(have(k) / r.inputs[k]));
    const ins = Object.entries(r.inputs).map(([k, v]) => `<span class="${have(k) >= v ? '' : 'bad'}">${v} ${esc(itemName(k))} (${have(k)})</span>`).join(', ');
    const it = ITEMS[out];
    const stats = it.stats ? ` <span class="dim">[${Object.entries(it.stats).map(([k, v]) => `${k} +${v}`).join(' ')}]</span>` : '';
    html += `<tr class="${locked ? 'locked' : ''}"><td><b>${esc(it.name)}</b>${stats}<br><span class="small">${ins}</span></td>
      <td class="small">Lvl ${r.level}<br>${r.xp} xp</td><td class="btns">${locked ? 'Locked' :
      `<button data-craft="${r.id}" data-n="1" ${maxN ? '' : 'disabled'}>1</button><button data-craft="${r.id}" data-n="5" ${maxN ? '' : 'disabled'}>5</button><button data-craft="${r.id}" data-n="${maxN}" ${maxN ? '' : 'disabled'}>All (${maxN})</button>`}</td></tr>`;
  }
  return html + '</table>';
}

function trend(id) {
  const m = state.market, d = m.mult[id] - m.prev[id];
  return d > 0.01 ? '<span class="up">&#9650;</span>' : d < -0.01 ? '<span class="down">&#9660;</span>' : '<span class="dim">-</span>';
}

function marketHtml() {
  const m = state.market;
  let html = `<h2>Ironhold Market</h2><p class="dim">Prices drift every 30 seconds. Selling a lot at once pushes the price down; it recovers over time.</p>`;
  if (m.event) html += `<p class="gold">News: ${m.event.boom ? 'Royal order' : 'Glut'} on ${esc(itemName(m.event.id))}!</p>`;
  html += '<h3>Sell</h3><table class="list">';
  const ids = Object.keys(state.inv).filter(id => !ITEMS[id].tool || ITEMS[id].tier > 0).sort((a, b) => sellPrice(b) * have(b) - sellPrice(a) * have(a));
  if (!ids.length) html += '<tr><td class="dim">Nothing to sell.</td></tr>';
  for (const id of ids) {
    html += `<tr><td>${esc(itemName(id))} <span class="dim">x${fmt(have(id))}</span></td><td>${sellPrice(id)}g ${trend(id)}</td>
      <td class="btns"><button data-sell="${id}" data-n="1">1</button><button data-sell="${id}" data-n="10">10</button><button data-sell="${id}" data-n="999999">All</button></td></tr>`;
  }
  html += '</table><button data-sellall="1">Sell all raw &amp; refined goods (keeps gear, food, tools)</button><h3>Buy</h3><table class="list">';
  for (const id of BUYABLE) {
    html += `<tr><td>${esc(itemName(id))}</td><td>${buyPrice(id)}g ${trend(id)}</td>
      <td class="btns"><button data-buy="${id}" data-n="1">1</button><button data-buy="${id}" data-n="10">10</button></td></tr>`;
  }
  return html + '</table>';
}

function empireHtml() {
  const E = state.empire;
  let html = `<h2>Guild Hall: Your Empire</h2>
    <p>Gold: <b class="gold">${fmt(state.gold)}</b> | Wages: ${wagesPerMin()}g/min ${E.unpaid ? '<b class="bad">UNPAID: workers idle!</b>' : ''}
    | Bandit threat: ${Math.floor(state.threat)}/100</p>
    <p class="dim small">Workers produce ${EMPIRE.ratePerWorker}/min each (+25% per building level), even while you're offline (up to ${EMPIRE.offlineCapHours}h).
    Camps in the wilds fill a stockpile you must collect, and bandits raid them. Each guard costs ${EMPIRE.guardCost}g plus a sword, and more sword tiers mean stronger guards.
    Killing bandits lowers the threat. Town works use goods from your pack.</p>
    <button data-collectall="1">Collect from all camps</button><h3>Camps (wilds)</h3>`;
  for (const id in CAMPS) {
    const c = E.camps[id], def = CAMPS[id];
    html += `<div class="card" id="b-${id}"><div class="cardhead"><b>${def.name}</b> <span class="dim">[${def.site} on map]</span>${c.built ? ` <span>Lvl ${c.level}</span>` : ''}</div>`;
    if (!c.built) {
      html += `<div class="small">Gathers ${skillName(def.skill).toLowerCase()} resources. Cost: ${costText(def.cost)}</div>
        <button data-emp="build" data-id="${id}" ${hasAll(def.cost) ? '' : 'disabled'}>Build</button></div>`;
      continue;
    }
    const stored = campStored(c), capN = EMPIRE.campCap(c.level);
    const defense = c.guards.reduce((a, t) => a + EMPIRE.guardPower(t), 0);
    html += `<div class="small">Output: <b>${c.out ? RESOURCES[c.out].name : 'none'}</b> <button data-emp="cycle" data-id="${id}">Change</button></div>
      <div class="small">Workers: ${c.workers}/${EMPIRE.maxWorkers(c.level)}
        <button data-emp="hire" data-id="${id}">Hire (${EMPIRE.hireCost(c.workers)}g)</button><button data-emp="fire" data-id="${id}">Fire</button></div>
      <div class="small">Guards: ${c.guards.length}/${EMPIRE.maxGuards(c.level)} (defence ${defense})
        <button data-emp="guard" data-id="${id}">Hire guard</button><button data-emp="dismiss" data-id="${id}">Dismiss</button></div>
      <div class="small">Stockpile: ${stored}/${capN} ${Object.entries(c.store).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${esc(itemName(k))}`).join(', ')}
        <button data-emp="collect" data-id="${id}">Collect</button></div>`;
    html += upgradeHtml(id, c, def) + '</div>';
  }
  html += '<h3>Works (inside the walls, safe)</h3>';
  for (const id in WORKS) {
    const k = E.works[id], def = WORKS[id];
    html += `<div class="card" id="b-${id}"><div class="cardhead"><b>${def.name}</b>${k.built ? ` <span>Lvl ${k.level}</span>` : ''}</div>`;
    if (!k.built) {
      html += `<div class="small">Automates ${skillName(def.skill).toLowerCase()}. Cost: ${costText(def.cost)}</div>
        <button data-emp="build" data-id="${id}" ${hasAll(def.cost) ? '' : 'disabled'}>Build</button></div>`;
      continue;
    }
    const r = k.recipe && RECIPES[k.recipe];
    html += `<div class="small">Making: <b>${r ? esc(itemName(Object.keys(r.outputs)[0])) : 'none'}</b> ${r ? `<span class="dim">(uses ${costText(r.inputs)})</span>` : ''}
        <button data-emp="cycle" data-id="${id}">Change</button>
        <button data-emp="toggle" data-id="${id}">${k.on ? 'Running' : 'Paused'}</button>
        ${k.starved && k.on && k.workers ? '<span class="bad">Out of materials!</span>' : ''}</div>
      <div class="small">Workers: ${k.workers}/${EMPIRE.maxWorkers(k.level)}
        <button data-emp="hire" data-id="${id}">Hire (${EMPIRE.hireCost(k.workers)}g)</button><button data-emp="fire" data-id="${id}">Fire</button></div>`;
    html += upgradeHtml(id, k, def) + '</div>';
  }
  return html + '<p class="dim small">You can only assign outputs and recipes that you know yourself. Train your skills to unlock more.</p>';
}

function upgradeHtml(id, b, def) {
  if (b.level >= EMPIRE.maxLevel) return '<div class="small dim">Max level</div>';
  const cost = upgradeCost(def.cost, b.level);
  return `<div class="small">Upgrade to lvl ${b.level + 1}: ${costText(cost)} <button data-emp="upgrade" data-id="${id}" ${hasAll(cost) ? '' : 'disabled'}>Upgrade</button></div>`;
}

function helpHtml() {
  return `<h2>Ironhold</h2>
  <p>You are one peasant with a worn axe and big dreams. Gather, refine, sell, hire, and grow a medieval industrial empire.</p>
  <h3>Controls</h3>
  <p><b>Arrows / WASD</b> move. <b>Walk into</b> trees, rocks, fishing spots, stations or monsters to interact.
  Gathering repeats automatically until you move. <b>F</b> eat food | <b>C</b> cycle combat style | <b>E</b> empire panel |
  <b>?</b> help | <b>Esc</b> close. Hover the map to inspect tiles.</p>
  <h3>Legend</h3>
  <pre class="legend"><span class="player">@</span> you          <span class="station">$</span> market   <span class="station">H</span> guild hall
<span class="pine">t</span> pine  <span class="oak">T</span> oak  <span class="ironwood">Y</span> ironwood   <span class="station">S</span> sawbench <span class="station">F</span> furnace
<span class="copper">*</span> copper <span class="iron">*</span> iron <span class="coal">*</span> coal     <span class="station">A</span> anvil    <span class="station">R</span> cook fire
<span class="fish1">%</span> minnow <span class="fish2">%</span> trout <span class="fish3">%</span> pike  <span class="site">L M P</span> camp sites
<span class="goblin">g</span> goblin <span class="wolf">w</span> wolf <span class="bandit">b</span> bandit <span class="ogre">O</span> ogre</pre>
  <h3>Getting started</h3>
  <ol>
    <li>Leave town west to the pine grove and chop logs. East of town is copper. South is a fishing pond.</li>
    <li>Saw logs into planks (S), smelt ore into bars (F), smith bars into gear (A), and cook fish (R).</li>
    <li>Sell at the market ($). Watch for price swings and royal orders.</li>
    <li>Build a Lumber Camp at the Guild Hall (H) or by walking into the L site, then hire workers.</li>
    <li>Bandits raid camps. Smith swords to arm guards. Wolves drop pelts for platebodies, and ogres in the deep wilds drop star fragments for starmetal.</li>
  </ol>
  <p class="dim small">Progress saves to this browser automatically every 15 seconds.</p>
  <button data-close="1">Begin</button>`;
}

function offlineHtml(r) {
  const h = Math.floor(r.seconds / 3600), mn = Math.floor(r.seconds % 3600 / 60);
  const prod = Object.entries(r.produced).map(([k, v]) => `<li>+${fmt(v)} ${esc(itemName(k))}</li>`).join('');
  const used = Object.entries(r.consumed).map(([k, v]) => `<li>-${fmt(v)} ${esc(itemName(k))}</li>`).join('');
  return `<h2>Welcome back!</h2><p>You were away for ${h}h ${mn}m${r.seconds >= EMPIRE.offlineCapHours * 3600 ? ' (capped)' : ''}.</p>
    ${prod ? `<h3>Your workers produced</h3><ul>${prod}</ul>` : '<p class="dim">Your workers produced nothing. Build camps at the Guild Hall!</p>'}
    ${used ? `<h3>Materials used by works</h3><ul>${used}</ul>` : ''}
    ${r.wages ? `<p>Wages paid: ${fmt(r.wages)}g</p>` : ''}
    ${r.events.length ? `<h3>Events</h3><ul>${r.events.slice(0, 12).map(e => `<li>${esc(e)}</li>`).join('')}${r.events.length > 12 ? `<li>...and ${r.events.length - 12} more</li>` : ''}</ul>` : ''}
    <p class="dim small">Camp goods wait in each camp's stockpile. Collect them at the Guild Hall.</p>
    <button data-close="1">Continue</button>`;
}

// ---------------------------------------------------------------- input
const KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0], W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
};

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { closeModal(); return; }
  if (modal) return;
  if (KEYS[e.key]) { e.preventDefault(); tryMove(...KEYS[e.key]); return; }
  const k = e.key.toLowerCase();
  if (k === 'f') eat();
  else if (k === 'c') { const order = ['attack', 'strength', 'defence']; state.style = order[(order.indexOf(state.style) + 1) % 3]; log(`Combat style: ${cap(state.style)}.`); }
  else if (k === 'e') openModal('empire', {});
  else if (k === '?' || k === 'h') openModal('help');
  else return;
  uiDirty = true;
}

function onModalClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  if (d.close) closeModal();
  else if (d.craft) startCraft(d.craft, +d.n);
  else if (d.sell) sell(d.sell, +d.n);
  else if (d.sellall) {
    for (const id of Object.keys(state.inv)) {
      const it = ITEMS[id];
      if (!it.tool && !it.slot && !it.heal) sell(id, have(id));
    }
  } else if (d.buy) buy(d.buy, +d.n);
  else if (d.emp) empireAction(d.emp, d.id);
  else if (d.collectall) collectAll();
  uiDirty = true;
}

function onSideClick(e) {
  const tab = e.target.closest('.tab');
  if (tab) { sidebarTab = tab.dataset.tab; uiDirty = true; return; }
  const it = e.target.closest('[data-item]');
  if (it) { const id = it.dataset.item; if (ITEMS[id].heal) eat(id); else if (ITEMS[id].slot) equip(id); uiDirty = true; return; }
  const un = e.target.closest('[data-unequip]');
  if (un) { unequip(un.dataset.unequip); uiDirty = true; return; }
  const st = e.target.closest('[data-style]');
  if (st) { state.style = st.dataset.style; uiDirty = true; }
}

let charW = 0, charH = 0;
function measureChar() {
  const probe = document.createElement('span');
  probe.textContent = 'M'.repeat(20);
  probe.style.visibility = 'hidden';
  $('map').appendChild(probe);
  const r = probe.getBoundingClientRect();
  charW = r.width / 20; charH = r.height;
  probe.remove();
}

// Fit the viewport to the space available, keeping odd sizes so the player is centred.
function fitViewport() {
  measureChar();
  const avail = $('left').clientWidth - 14;
  const reserved = window.innerWidth <= 860 ? 450 : 300;
  const odd = n => (n % 2 ? n : n - 1);
  VW = odd(clamp(Math.floor(avail / charW), 31, 101));
  VH = odd(clamp(Math.floor((window.innerHeight - reserved) / charH), 15, 41));
}

function onMapHover(e) {
  if (!charW) measureChar();
  const rect = $('map').getBoundingClientRect();
  const style = getComputedStyle($('map'));
  const vx = Math.floor((e.clientX - rect.left - parseFloat(style.paddingLeft)) / charW);
  const vy = Math.floor((e.clientY - rect.top - parseFloat(style.paddingTop)) / charH);
  const cam = camera();
  hoverText = vx >= 0 && vy >= 0 && vx < VW && vy < VH ? describe(cam.x + vx, cam.y + vy) : '';
}

function setupDpad() {
  let timer = null;
  const stop = () => { clearInterval(timer); timer = null; };
  for (const b of document.querySelectorAll('[data-dir]')) {
    const dir = b.dataset.dir.split(',').map(Number);
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      tryMove(...dir);
      stop();
      timer = setInterval(() => tryMove(...dir), 130);
    });
    b.addEventListener('pointerup', stop);
    b.addEventListener('pointerleave', stop);
  }
  $('btn-eat').addEventListener('click', () => { eat(); uiDirty = true; });
}

// ---------------------------------------------------------------- boot
function init() {
  generateWorld();
  const loaded = load();
  if (!loaded) state = newState();
  marketInit();
  if (state.x == null || blocked(state.x, state.y)) { state.x = TOWN.x; state.y = TOWN.y; }
  state.hp = clamp(state.hp, 1, maxHp());

  const report = loaded ? runOffline() : null;
  for (let k = 0; k < 55; k++) spawnMonster(false);

  document.addEventListener('keydown', onKey);
  $('modal-body').addEventListener('click', onModalClick);
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $('side').addEventListener('click', onSideClick);
  $('map').addEventListener('mousemove', onMapHover);
  $('map').addEventListener('mouseleave', () => { hoverText = ''; });
  window.addEventListener('resize', fitViewport);
  fitViewport();
  $('btn-empire').addEventListener('click', () => openModal('empire', {}));
  $('btn-help').addEventListener('click', () => openModal('help'));
  $('btn-save').addEventListener('click', () => { save(); log('Game saved.', 'dim'); });
  $('btn-reset').addEventListener('click', () => {
    if (!confirm('Erase your save and start over?')) return;
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
    window.removeEventListener('beforeunload', save);
    location.reload();
  });
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  setupDpad();

  log(loaded ? 'Welcome back to Ironhold.' : 'You arrive in Ironhold with a worn axe, a worn pickaxe and a fishing rod.', 'level');
  if (report) openModal('offline', report);
  else if (!state.seenHelp) { state.seenHelp = true; openModal('help'); }

  lastSave = Date.now();
  setInterval(update, TICK);
  update();
}

document.addEventListener('DOMContentLoaded', init);
