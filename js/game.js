// Ironhold: game logic, state, input and on-screen UI. The map lives in world.js; drawing in render3d.js.
'use strict';

const SAVE_KEY = 'ironhold-save-v3';
const SETTINGS_KEY = 'ironhold-settings';
const DAY_SECONDS = 1200; // one full day and night takes 20 minutes

// Player preferences live apart from the save, so a reset keeps them.
const settings = Object.assign({ quality: 'medium', music: 0.5, sfx: 0.8, ambient: 0.7, muted: false }, (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; }
})());
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignore */ } }
const TICK = 100;
const PLAYER_R = 0.3;
const REACH = 2.1;

const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const fmt = n => Math.floor(n).toLocaleString();
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// "an ogre", "the wolf", but "The Bandit King" as it stands.
const aMonster = d => /^the /i.test(d.name) ? d.name : `${/^[aeiou]/i.test(d.name) ? 'an' : 'a'} ${d.name.toLowerCase()}`;
const theMonster = d => /^the /i.test(d.name) ? d.name : `the ${d.name.toLowerCase()}`;
const itemName = id => (ITEMS[id] ? ITEMS[id].name : id);
const skillName = id => SKILLS.find(s => s.id === id).name;
const $ = id => document.getElementById(id);

// Visual effect hooks; the 3D renderer replaces these.
const FX = { damage() {}, gain() {}, lunge() {} };

// ---------------------------------------------------------------- state
let state = null;
let monsters = [];
let action = null;
let messages = [];
let nextMonsterId = 1;
let uiDirty = true;
let panel = null;              // { kind, data }
let buildMode = null;          // { type, x, y, valid, reason, info }
let interactTarget = null;
let moving = false;
const keys = new Set();
const structIndex = new Map(); // tile idx -> struct
let lastEat = 0, lastRegen = 0, lastSpawn = 0, lastSave = 0, lastTick = 0, lastInteractScan = 0, lastPoiScan = 0;

function newState() {
  const xp = {};
  for (const s of SKILLS) xp[s.id] = 0;
  xp.hitpoints = xpForLevel(10);
  return {
    v: 4, px: HOMESTEAD.x + 0.5, py: HOMESTEAD.y + 2, face: Math.PI, camYaw: 0, hp: 10, gold: 20, xp,
    inv: {}, equip: { weapon: null, shield: null, head: null, body: null, legs: null, feet: null },
    style: 'attack',
    markets: {}, marketTimer: 0,
    structs: [{ id: 1, type: 'campfire', x: HOMESTEAD.x, y: HOMESTEAD.y, level: 1, pending: null, work: 0, workers: 0, acc: 0, on: true, recipe: 'cook_minnow' }],
    nextStructId: 2, store: {}, home: null,
    time: 0.3, weather: { kind: 'clear', left: 240 }, day: 1,
    pois: {}, opened: {}, shrineUsed: {}, bossBack: {},
    threat: 8, raidTimer: 0, unpaid: false,
    discovered: { ironhold: true },
    stats: { kills: 0, earned: 0 },
    savedAt: Date.now(), seenHelp: false,
    story: { winter: 0, side: 0, choice: null, forgeLit: false, journal: [], quests: {}, tracked: null, seeds: {}, dug: {}, runes: {}, solved: {}, upg: { stamina: 0, pack: 0 } },
    sailing: false,
    caravans: [], myTown: null,
    mounted: false, pet: null, ach: {}, bestiary: {}, seen: {},
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
    // Saves from before the world grew: move everything onto the stretched map.
    if ((s.v || 0) < 4) {
      s.px = s.px * SC + OX; s.py = s.py * SC + OY;
      for (const st of s.structs || []) { st.x = PX(st.x); st.y = PY(st.y); }
      s.v = 4;
    }
    state = Object.assign(newState(), s);
    state.xp = Object.assign(newState().xp, s.xp || {});
    state.equip = Object.assign(newState().equip, s.equip || {});
    state.story = Object.assign(newState().story, s.story || {});
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
    FX.gain(state.px, state.py, `${skillName(skill)} ${after}!`, 'level');
    toast(`${skillName(skill)} level ${after}!`, 'level');
    Sound.sfx('levelup');
    if (skill === 'hitpoints') state.hp += after - before;
  }
  uiDirty = true;
}

function combatLevel() {
  return Math.floor(0.25 * (lvl('defence') + lvl('hitpoints')) + 0.325 * (lvl('attack') + lvl('strength')));
}

const have = id => state.inv[id] || 0;
function addItem(id, n = 1, quiet = false) { state.inv[id] = have(id) + n; uiDirty = true; if (!quiet && n > 0) lootChip(id, n); }
function removeItem(id, n = 1) {
  state.inv[id] = have(id) - n;
  if (state.inv[id] <= 0) delete state.inv[id];
  uiDirty = true;
}
function packCap() {
  let bonus = 0;
  for (const id in state.inv) if (ITEMS[id] && ITEMS[id].pack) bonus = Math.max(bonus, ITEMS[id].pack);
  return EMPIRE.packBase + bonus + 10 * ((state.story.upg || {}).pack || 0);
}
const packUsed = () => Object.values(state.inv).reduce((a, b) => a + b, 0);
const packFree = () => Math.max(0, packCap() - packUsed());

// Storehouse stock is shared by every storehouse you own.
const storeUsed = () => Object.values(state.store).reduce((a, b) => a + b, 0);
function storeCap() {
  let c = 0;
  for (const s of state.structs) if (s.type === 'storehouse' && s.level) c += STRUCTS.storehouse.storage[s.level - 1];
  return c;
}
function addStore(id, n) { state.store[id] = (state.store[id] || 0) + n; uiDirty = true; }
function takeStore(id, n) { state.store[id] -= n; if (state.store[id] <= 0) delete state.store[id]; uiDirty = true; }
function nearStorehouse(x, y) {
  return state.structs.some(s => s.type === 'storehouse' && s.level && Math.hypot(structCenter(s).x - x, structCenter(s).y - y) <= EMPIRE.storeRadius);
}

// Counting and paying can draw on the storehouse when you're close to one.
function count(id, useStore) { return have(id) + (useStore ? state.store[id] || 0 : 0); }
function hasAll(req, useStore) {
  for (const k in req) {
    if (k === 'gold') { if (state.gold < req[k]) return false; }
    else if (count(k, useStore) < req[k]) return false;
  }
  return true;
}
function payAll(req, useStore) {
  for (const k in req) {
    if (k === 'gold') { state.gold -= req[k]; continue; }
    const fromPack = Math.min(have(k), req[k]);
    if (fromPack) removeItem(k, fromPack);
    if (req[k] > fromPack && useStore) takeStore(k, req[k] - fromPack);
  }
}
const costText = req => Object.entries(req).map(([k, v]) => k === 'gold' ? `${fmt(v)}g` : `${v} ${itemName(k)}`).join(', ');
function costHtml(req, useStore) {
  return Object.entries(req).map(([k, v]) => {
    const ok = k === 'gold' ? state.gold >= v : count(k, useStore) >= v;
    return `<span class="${ok ? '' : 'bad'}">${k === 'gold' ? fmt(v) + 'g' : `${v} ${esc(itemName(k))} (${count(k, useStore)})`}</span>`;
  }).join(', ');
}

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
  const fam = fullSet();
  if (fam) { const b = setBonus(fam) || {}; s.acc += b.acc || 0; s.str += b.str || 0; s.def += b.def || 0; }
  return s;
}
// The armour family you're wearing head to toe, if any.
function fullSet() {
  const fams = ARMOR_SLOTS.map(sl => state.equip[sl] && ITEMS[state.equip[sl]].family);
  return fams[0] && fams.every(f => f === fams[0]) ? fams[0] : null;
}

function equip(id) {
  const it = ITEMS[id];
  if (!it || !it.slot || !have(id)) return;
  const sk = SLOT_SKILL[it.slot];
  if (lvl(sk) < it.req) { log(`You need ${skillName(sk)} level ${it.req} to use the ${it.name}.`, 'warn'); return; }
  const old = state.equip[it.slot];
  if (old) addItem(old, 1, true);
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
  Sound.sfx('eat');
  log(`You eat the ${ITEMS[id].name}. (+${ITEMS[id].heal} HP)`, 'good');
}

// Messages: big moments get a banner (with the story text underneath), everything else a short hint above the hotbar.
let pendingSub = null, lastBanner = null;
function log(text, cls = '') {
  messages.push({ text, cls, t: Date.now() });
  if (messages.length > 60) messages.shift();
  if (typeof document === 'undefined' || !$('hints')) return;
  if (cls === 'level') {
    if (lastBanner && Date.now() - lastBanner.at < 80 && !lastBanner.hasSub) { bannerSub(lastBanner, text); return; }
    pendingSub = text;
    setTimeout(() => { if (pendingSub === text) { pendingSub = null; hint(text, 'level'); } }, 0);
    return;
  }
  hint(text, cls);
}
function hint(text, cls = '') {
  const box = $('hints');
  for (const el of [...box.children]) if (el.textContent === text) el.remove();
  const el = document.createElement('div');
  el.className = `hint ${cls}`;
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  const life = Math.min(6500, 2400 + text.length * 30);
  setTimeout(() => el.classList.add('out'), life);
  setTimeout(() => el.remove(), life + 600);
}
function bannerSub(el, text) { el.hasSub = true; el.insertAdjacentHTML('beforeend', `<div class="t-sub">${esc(text)}</div>`); }
// Items you pick up pop up as little icons, merging repeats.
function lootChip(id, n) {
  const box = $('loot');
  if (!box || !ITEMS[id]) return;
  let el = [...box.children].find(c => c.dataset.id === id && !c.classList.contains('out'));
  if (el) { el.dataset.n = +el.dataset.n + n; clearTimeout(el.t1); clearTimeout(el.t2); el.classList.remove('pop'); void el.offsetWidth; }
  else { el = document.createElement('div'); el.className = 'chip'; el.dataset.id = id; el.dataset.n = n; box.appendChild(el); }
  el.innerHTML = `${ico(id, 'ico')}<b>+${fmt(+el.dataset.n)}</b> ${esc(itemName(id))}`;
  el.classList.add('pop');
  while (box.children.length > 5) box.firstChild.remove();
  el.t1 = setTimeout(() => el.classList.add('out'), 2600);
  el.t2 = setTimeout(() => el.remove(), 3200);
}

// ---------------------------------------------------------------- structures
const structDef = s => STRUCTS[s.type];
function footprint(x, y, size) {
  const out = [];
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) out.push([x + dx, y + dy]);
  return out;
}
// Buildings placed before footprints grew keep their old size.
const LEGACY_SIZE = { storehouse: 2, house: 2, lumber_camp: 2, dock: 2, mine: 2, guard_tower: 1 };
const structSize = s => s.size || LEGACY_SIZE[s.type] || STRUCTS[s.type].size;
const structCenter = s => ({ x: s.x + (structSize(s) - 1) / 2, y: s.y + (structSize(s) - 1) / 2 });
function indexStructs() {
  structIndex.clear();
  for (const s of state.structs) for (const [x, y] of footprint(s.x, s.y, structSize(s))) structIndex.set(idx(x, y), s);
}
const structById = id => state.structs.find(s => s.id === id);
const workNeeded = s => Math.round(structDef(s).work * (1 + 0.6 * ((s.pending || 1) - 1)));
const buildPct = s => Math.floor(s.work / workNeeded(s) * 100);

function housingCap() {
  let c = 0;
  for (const s of state.structs) if (s.type === 'house' && s.level) c += STRUCTS.house.housing[s.level - 1];
  return c;
}
const workerTotal = () => state.structs.reduce((a, s) => a + (s.workers || 0), 0);
const guardTotal = () => state.structs.reduce((a, s) => a + (s.guards ? s.guards.length : 0), 0);
const staffCount = () => workerTotal() + guardTotal();
const wagesPerMin = () => workerTotal() * EMPIRE.wage.worker + guardTotal() * EMPIRE.wage.guard;
function upgradeCost(s) {
  const out = {}, base = structDef(s).cost;
  for (const k in base) out[k] = base[k] * (s.level + 1);
  return out;
}

// Nodes of a resource type close enough for a camp's workers to use.
function richness(s, res) {
  const size = structSize(s), cx = s.x + (size - 1) / 2, cy = s.y + (size - 1) / 2, r = EMPIRE.gatherRadius;
  let n = 0;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const node = nodes.get(idx(x, y));
    if (node && node.res === res && Math.hypot(x - cx, y - cy) <= r) n++;
  }
  return n;
}
function campOutputs(s) {
  const skill = structDef(s).gather;
  return Object.keys(RESOURCES).filter(r => RESOURCES[r].skill === skill && lvl(skill) >= RESOURCES[r].level && richness(s, r) > 0);
}
function stationRecipes(type) {
  const skill = STRUCTS[type].station;
  return Object.keys(RECIPES).filter(r => RECIPES[r].skill === skill && lvl(skill) >= RECIPES[r].level);
}

function placementCheck(type, x, y) {
  const def = STRUCTS[type];
  if (lvl('construction') < def.con) return `Needs Construction ${def.con}`;
  if (def.unique && state.structs.some(s => s.type === type)) return 'You already have one';
  if (def.charter) { const why = charterProblem(); if (why) return why; }
  if (!hasAll(def.cost, nearStorehouse(x, y))) return 'Not enough materials';
  const tiles = footprint(x, y, def.size);
  let lo = Infinity, hi = -Infinity;
  for (const [tx, ty] of tiles) {
    if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return 'Out of bounds';
    const i = idx(tx, ty), t = terrain[i];
    if (t === T.ROAD || t === T.BRIDGE) return "Can't build on roads";
    if (t !== T.GRASS && t !== T.SAND) return 'Needs open ground';
    if (nodes.has(i) || structIndex.has(i) || services.has(i) || townBlocks.has(i)) return 'Something is in the way';
    if (townAt(tx, ty, 5)) return 'Too close to a town';
    if (Math.abs(tx - state.px) < 0.5 + PLAYER_R && Math.abs(ty - state.py) < 0.5 + PLAYER_R) return "You're standing there";
    lo = Math.min(lo, tileH[i]); hi = Math.max(hi, tileH[i]);
  }
  if (hi - lo > 0.8) return 'Ground is too steep';
  if (def.nearWater) {
    const wet = tiles.some(([tx, ty]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => terrain[idx(tx + a, ty + b)] === T.WATER));
    if (!wet) return 'Must be built next to water';
  }
  const cx = x + (def.size - 1) / 2, cy = y + (def.size - 1) / 2;
  if (Math.hypot(cx - state.px, cy - state.py) > 14) return 'Too far away';
  return null;
}

function startBuildMode(type) {
  closePanel();
  if (action && action.type !== 'combat') action = null;
  const x = Math.round(state.px + Math.sin(state.face) * 3), y = Math.round(state.py + Math.cos(state.face) * 3);
  buildMode = { type, x, y, valid: false, reason: '', info: '' };
  updateBuildMode();
}
function setBuildCursor(x, y) {
  if (!buildMode) return;
  const s = STRUCTS[buildMode.type].size;
  buildMode.x = Math.round(x - (s - 1) / 2);
  buildMode.y = Math.round(y - (s - 1) / 2);
  updateBuildMode();
}
function updateBuildMode() {
  const reason = placementCheck(buildMode.type, buildMode.x, buildMode.y);
  buildMode.valid = !reason;
  buildMode.reason = reason || '';
  const def = STRUCTS[buildMode.type];
  buildMode.info = '';
  if (def.gather) {
    const fake = { type: buildMode.type, x: buildMode.x, y: buildMode.y, size: def.size };
    const res = Object.keys(RESOURCES).filter(r => RESOURCES[r].skill === def.gather);
    buildMode.info = res.map(r => [richness(fake, r), RESOURCES[r].name.toLowerCase()]).filter(([n]) => n).map(([n, name]) => `${n} ${name}`).join(', ') || 'nothing to gather';
  }
}
function placeStructure() {
  if (!buildMode) return;
  updateBuildMode();
  if (!buildMode.valid) { log(`Can't build here: ${buildMode.reason}.`, 'warn'); return; }
  const def = STRUCTS[buildMode.type];
  payAll(def.cost, nearStorehouse(buildMode.x, buildMode.y));
  const s = { id: state.nextStructId++, type: buildMode.type, x: buildMode.x, y: buildMode.y, size: def.size, level: 0, pending: 1, work: 0, workers: 0, acc: 0 };
  if (def.guards) s.guards = [];
  if (def.station) s.on = true;
  state.structs.push(s);
  indexStructs();
  uiDirty = true;
  // Walls and gates go up at once, and you can keep placing them.
  if (def.instant) {
    s.level = 1; s.pending = null;
    addXp('construction', 4 + def.con);
    Sound.sfx('build');
    updateBuildMode();
    return;
  }
  log(`${def.name} site placed. Press E at it to build.`, 'good');
  Sound.sfx('place');
  buildMode = null;
}

function startConstruct(s) {
  if (!s.pending) return;
  action = { type: 'construct', sid: s.id, from: Date.now(), next: Date.now() + 1000 };
}
function processConstruct(now) {
  const s = structById(action.sid);
  if (!s || !s.pending) { action = null; return; }
  const c = structCenter(s);
  if (Math.hypot(c.x - state.px, c.y - state.py) > 3.5) { action = null; return; }
  s.work++;
  Sound.sfx('build');
  addXp('construction', 5 + structDef(s).con * 1.5);
  if (s.work >= workNeeded(s)) {
    s.level = s.pending;
    s.pending = null;
    s.work = 0;
    FX.gain(state.px, state.py, 'Built!', 'level');
    Sound.sfx('built');
    toast(s.level === 1 ? `${structDef(s).name} built` : `${structDef(s).name} upgraded`, 'good');
    if (s.type === 'house' && !state.home) state.home = s.id;
    if (structDef(s).gather && !s.out) s.out = campOutputs(s)[0] || null;
    if (structDef(s).station && !s.recipe) s.recipe = stationRecipes(s.type)[0] || null;
    if (structDef(s).caravans) ensureCaravans();
    action = null;
    if (s.type === 'town_hall' && s.level === 1 && !state.myTown) { openPanel('charter'); return; }
    uiDirty = true;
    return;
  }
  action.from = now;
  action.next = now + 1000;
}

function structAction(act, s, arg) {
  if (!s) return;
  const def = structDef(s);
  switch (act) {
    case 'upgrade': {
      if (s.level >= STRUCT_MAX_LEVEL || s.pending) return;
      const cost = upgradeCost(s), useStore = nearStorehouse(s.x, s.y), need = def.con + s.level * 5;
      if (lvl('construction') < need) { log(`Needs Construction ${need}.`, 'warn'); return; }
      if (!hasAll(cost, useStore)) { log(`You need ${costText(cost)}.`, 'warn'); return; }
      payAll(cost, useStore);
      s.pending = s.level + 1;
      s.work = 0;
      closePanel();
      log(`Upgrade started. Press E at the ${def.name} to build it.`, 'good');
      break;
    }
    case 'hire': {
      if (s.workers >= def.workers[s.level - 1]) { log('No room for more workers here. Upgrade it first.', 'warn'); return; }
      if (staffCount() >= housingCap()) { log('No free beds. Build or upgrade a Cottage.', 'warn'); return; }
      const c = EMPIRE.hireCost(workerTotal());
      if (state.gold < c) { log(`Hiring costs ${c} gold.`, 'warn'); return; }
      state.gold -= c; s.workers++;
      log(`You hired a worker for the ${def.name}.`);
      break;
    }
    case 'fire': if (s.workers > 0) { s.workers--; log('You let a worker go.'); } break;
    case 'guard': {
      if (s.guards.length >= def.guards[s.level - 1]) { log('No room for more guards. Upgrade first.', 'warn'); return; }
      if (staffCount() >= housingCap()) { log('No free beds. Build or upgrade a Cottage.', 'warn'); return; }
      const swords = Object.keys(state.inv).filter(k => ITEMS[k] && ITEMS[k].sword).sort((a, b) => ITEMS[b].tier - ITEMS[a].tier);
      if (!swords.length) { log('Each guard needs a sword in your pack.', 'warn'); return; }
      if (state.gold < EMPIRE.guardCost) { log(`Hiring a guard costs ${EMPIRE.guardCost} gold.`, 'warn'); return; }
      state.gold -= EMPIRE.guardCost;
      removeItem(swords[0]);
      s.guards.push(ITEMS[swords[0]].tier);
      log(`You hired a guard armed with a ${itemName(swords[0]).toLowerCase()}.`);
      break;
    }
    case 'dismiss': if (s.guards.length) { s.guards.shift(); log('You dismissed a guard.'); } break;
    case 'cycle': {
      const opts = def.gather ? campOutputs(s) : stationRecipes(s.type);
      if (!opts.length) { log('Nothing available here yet.', 'warn'); return; }
      const cur = def.gather ? s.out : s.recipe;
      const next = opts[(opts.indexOf(cur) + 1) % opts.length];
      if (def.gather) s.out = next; else { s.recipe = next; s.acc = 0; }
      break;
    }
    case 'toggle': s.on = !s.on; break;
    case 'use': openPanel('craft', { sid: s.id }); return;
    case 'cv': caravanAction(s, arg); break;
    case 'charter': openPanel('charter'); return;
    case 'hallmarket': openPanel('market', { town: 'mytown' }); return;
    case 'hallcarriage': openPanel('carriage', { town: 'mytown' }); return;
    case 'demolish': {
      if (!confirm(`Demolish the ${def.name}? You get half the materials back.`)) return;
      for (const k in def.cost) {
        const n = Math.floor(def.cost[k] * Math.max(1, s.level) / 2);
        if (n > 0) addItem(k, n);
      }
      state.structs = state.structs.filter(o => o !== s);
      if (state.home === s.id) state.home = null;
      if (state.myTown && state.myTown.hall === s.id) { log(`Without its hall, ${state.myTown.name} is just a settlement again.`, 'warn'); state.myTown = null; defineMyTown(); }
      ensureCaravans();
      indexStructs();
      closePanel();
      log(`You demolished the ${def.name}.`);
      break;
    }
    case 'deposit': {
      if (arg === 'all') depositAll();
      else { const [id, n] = arg.split(':'); depositItem(id, +n); }
      break;
    }
    case 'withdraw': {
      const [id, nStr] = arg.split(':');
      const n = Math.min(+nStr, state.store[id] || 0, packFree());
      if (n <= 0) { log(packFree() ? 'Nothing to take.' : 'Your pack is full.', 'warn'); return; }
      takeStore(id, n); addItem(id, n, true);
      break;
    }
  }
  uiDirty = true;
}
function depositItem(id, n) {
  const room = storeCap() - storeUsed();
  n = Math.min(n, have(id), room);
  if (n <= 0) { if (!room) log('The storehouse is full.', 'warn'); return; }
  removeItem(id, n); addStore(id, n);
}
function depositAll() {
  for (const id of Object.keys(state.inv)) {
    const it = ITEMS[id];
    if (it.tool || it.slot || it.pack || it.heal) continue;
    depositItem(id, have(id));
  }
}

// ---------------------------------------------------------------- movement & collision
const nodeActive = (n, now) => !!n && n.until <= now;
const SOLID_RES = new Set(['pine', 'oak', 'ironwood', 'copper', 'iron', 'coal', 'starrock']);
// Afloat you can only go where the water is open; on foot, frozen lakes count as ground.
const sailable = (x, y) => x >= 0 && y >= 0 && x < W && y < H && terrain[idx(x, y)] === T.WATER && !iceAt(x, y);
function solidTile(x, y, now) {
  if (state.sailing) return !sailable(x, y) || structIndex.has(idx(x, y));
  if (!walkableTerrain(x, y) && !iceAt(x, y)) return true;
  const i = idx(x, y), n = nodes.get(i);
  if (n && SOLID_RES.has(n.res) && n.until <= now) return true;
  const st = structIndex.get(i);
  return services.has(i) || townBlocks.has(i) || (!!st && !structDef(st).passable);
}
function collides(px, py, now) {
  for (let ty = Math.round(py - PLAYER_R); ty <= Math.round(py + PLAYER_R); ty++) {
    for (let tx = Math.round(px - PLAYER_R); tx <= Math.round(px + PLAYER_R); tx++) {
      if (!solidTile(tx, ty, now)) continue;
      const cx = clamp(px, tx - 0.5, tx + 0.5), cy = clamp(py, ty - 0.5, ty + 0.5);
      if ((px - cx) ** 2 + (py - cy) ** 2 < PLAYER_R * PLAYER_R) return true;
    }
  }
  return false;
}

function movePlayer(dt, now) {
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  moving = !!(f || r);
  if (!moving) return;
  const yaw = state.camYaw;
  let dx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
  let dy = -Math.cos(yaw) * f - Math.sin(yaw) * r;
  const len = Math.hypot(dx, dy);
  dx /= len; dy /= len;
  const step = dt * (state.sailing ? (keys.has('shift') ? 9 : 7) : state.mounted ? (keys.has('shift') ? 11 : 8) : keys.has('shift') ? 6.5 : 4) * (combat.blocking ? 0.45 : 1);
  if (!collides(state.px + dx * step, state.py, now)) state.px += dx * step;
  if (!collides(state.px, state.py + dy * step, now)) state.py += dy * step;
  state.face = Math.atan2(dx, dy);
  if (action && action.type !== 'combat') action = null;
}

const inAnyTown = () => !!townAt(Math.round(state.px), Math.round(state.py), 1);

// ---------------------------------------------------------------- interaction
function describeTarget(t) {
  if (!t) return '';
  if (t.kind === 'monster') { const d = MONSTERS[t.m.type]; return `Attack ${d.name} (lvl ${d.level})`; }
  if (t.kind === 'node') {
    const r = RESOURCES[t.n.res];
    const verb = r.skill === 'woodcutting' ? 'Chop' : r.skill === 'mining' ? 'Mine' : r.skill === 'fishing' ? 'Fish at' : 'Gather from';
    return `${verb} ${r.name.toLowerCase()}${r.skill && lvl(r.skill) < r.level ? ` (needs ${skillName(r.skill)} ${r.level})` : ''}`;
  }
  if (t.kind === 'service') {
    if (t.svc.type === 'market') return `Trade at the ${TOWNS[t.svc.town].name} market`;
    if (t.svc.type === 'carriage') return 'Hire a carriage';
    if (t.svc.type === 'chest') return state.opened[t.svc.poi] ? 'Search the empty chest' : t.svc.poi.endsWith('_hoard') ? 'Open the hoard' : 'Open the old chest';
    if (t.svc.type === 'portal') return t.svc.label;
    if (t.svc.type === 'board') return 'Read the notice board';
    if (t.svc.type === 'dig') return state.story.dug[t.svc.id] ? 'A dug-up cairn' : 'Dig beneath the old cairn';
    if (t.svc.type === 'rune') { const r = (state.story.runes[t.svc.poi] || {})[t.svc.dir] || 'Sun'; return `Turn the rune stone (shows the ${r})`; }
    if (t.svc.type === 'npc') return Story.npcHere(t.svc.npc) ? `Talk to ${NPC_NAMES[t.svc.npc]}` : 'Look at the empty throne';
    if (t.svc.type === 'forge') return state.story.forgeLit ? 'Look at the Firstforge' : 'Use the Firstforge';
    return 'Pray at the shrine';
  }
  if (t.kind === 'sail') return 'Launch your sailboat';
  if (t.kind === 'land') return 'Go ashore';
  if (t.kind === 'struct') {
    const def = structDef(t.s);
    if (t.s.pending) return `${t.s.level ? 'Upgrade' : 'Build'} ${def.name} (${buildPct(t.s)}%)`;
    return `Use ${def.name}`;
  }
  return '';
}

function findInteract(now) {
  const px = state.px, py = state.py, fx = Math.sin(state.face), fy = Math.cos(state.face);
  let best = null, bestScore = Infinity;
  const consider = (x, y, t, reach) => {
    const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
    if (d > reach) return;
    const dot = d > 0.01 ? (dx * fx + dy * fy) / d : 1;
    const score = d - dot * 0.7;
    if (score < bestScore) { bestScore = score; best = t; }
  };
  for (const m of monsters) if (m.hp > 0 && Math.abs(m.x - px) < 3 && Math.abs(m.y - py) < 3) consider(m.x, m.y, { kind: 'monster', m }, 2.4);
  const tx = Math.round(px), ty = Math.round(py);
  for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const i = idx(x, y), n = nodes.get(i);
    if (nodeActive(n, now)) consider(x, y, { kind: 'node', i, n, x, y }, RESOURCES[n.res].skill === 'fishing' ? 2.3 : REACH);
    const svc = services.get(i);
    if (svc) consider(x, y, { kind: 'service', svc, x, y }, REACH);
    const s = structIndex.get(i);
    if (s) consider(x, y, { kind: 'struct', s, x, y }, REACH);
  }
  // Launching or beaching the boat uses the tile straight ahead; whatever is nearest wins.
  const ax = Math.round(px + fx * 1.1), ay = Math.round(py + fy * 1.1);
  if (!state.sailing && have('sailboat') && sailable(ax, ay) && terrain[idx(ax, ay)] === T.WATER) consider(ax, ay, { kind: 'sail', x: ax, y: ay }, REACH);
  else if (state.sailing && (walkableTerrain(ax, ay) || iceAt(ax, ay))) {
    state.sailing = false;
    const clear = !collides(ax, ay, now);
    state.sailing = true;
    if (clear) consider(ax, ay, { kind: 'land', x: ax, y: ay }, REACH);
  }
  return best;
}

function interact(t) {
  if (!t) return;
  if (state.mounted && (t.kind === 'node' || t.kind === 'monster' || t.kind === 'sail' || (t.kind === 'struct' && t.s.pending) || (t.kind === 'service' && t.svc.type === 'portal'))) dismount('You hop down from your horse.');
  if (t.kind === 'monster') startCombat(t.m);
  else if (t.kind === 'node') startGather(t.i);
  else if (t.kind === 'sail' || t.kind === 'land') {
    state.sailing = t.kind === 'sail';
    if (state.sailing) state.stats.sailed = true;
    state.px = t.x; state.py = t.y;
    action = null;
    Sound.sfx('splash');
    log(state.sailing ? 'You push off and raise the sail.' : 'You drag the boat up the shore.', 'dim');
  }
  else if (t.kind === 'service') {
    if (t.svc.type === 'chest') openChest(t.svc.poi);
    else if (t.svc.type === 'npc') openPanel('talk', { npc: t.svc.npc });
    else if (t.svc.type === 'forge') Story.useForge();
    else if (t.svc.type === 'board') openPanel('board', { town: t.svc.town });
    else if (t.svc.type === 'dig') Story.dig(t.svc);
    else if (t.svc.type === 'rune') Story.turnRune(t.svc);
    else if (t.svc.type === 'portal') {
      state.px = t.svc.to.x; state.py = t.svc.to.y;
      action = null;
      for (const m of monsters) m.aggro = false;
      Sound.sfx('open');
      const dg = inDungeonRect(Math.round(state.px), Math.round(state.py));
      log(dg ? `You descend into ${dg.name}. Torches flicker in the dark...` : 'You climb back into the daylight.', dg ? 'warn' : 'good');
    }
    else if (t.svc.type === 'shrine') pray(t.svc.poi);
    else openPanel(t.svc.type, { town: t.svc.town });
  }
  else if (t.kind === 'struct') { if (t.s.pending) startConstruct(t.s); else openPanel('struct', { sid: t.s.id }); }
}

// Called by the renderer when the world is clicked.
function clickWorld(pick) {
  if (buildMode) { placeStructure(); return; }
  if (!pick) return;
  const now = Date.now();
  let t = null;
  if (pick.monsterId != null) {
    const m = monsters.find(mm => mm.id === pick.monsterId && mm.hp > 0);
    if (m) t = { kind: 'monster', m, x: m.x, y: m.y };
  } else {
    const i = idx(pick.x, pick.y);
    if (structIndex.has(i)) t = { kind: 'struct', s: structIndex.get(i), x: pick.x, y: pick.y };
    else if (services.has(i)) t = { kind: 'service', svc: services.get(i), x: pick.x, y: pick.y };
    else if (nodeActive(nodes.get(i), now)) t = { kind: 'node', i, n: nodes.get(i), x: pick.x, y: pick.y };
  }
  if (!t) return;
  if (Math.hypot(t.x - state.px, t.y - state.py) > (t.kind === 'node' ? 2.6 : 2.8)) { log('That is too far away. Walk closer.', 'dim'); return; }
  interact(t);
}

// ---------------------------------------------------------------- gathering & crafting
function startGather(i) {
  const n = nodes.get(i), r = RESOURCES[n.res];
  if (r.skill && lvl(r.skill) < r.level) { log(`You need ${skillName(r.skill)} level ${r.level} for the ${r.name.toLowerCase()}.`, 'warn'); return; }
  if (r.tool && !bestTool(r.tool)) {
    log(r.tool === 'rod' ? 'You need a fishing rod. Make one at a Workbench.' : `You need ${r.tool === 'axe' ? 'an axe' : 'a pickaxe'}. Press C to craft a stone one.`, 'warn');
    return;
  }
  if (!packFree()) { log('Your pack is full.', 'warn'); return; }
  if (action && action.type === 'gather' && action.i === i) return;
  action = { type: 'gather', i, from: Date.now(), next: Date.now() + gatherTime(r) };
}
const gatherTime = r => r.time || 2400 - ITEMS[bestTool(r.tool)].tier * 300;

function processGather(now) {
  const n = nodes.get(action.i);
  if (!nodeActive(n, now)) { action = null; return; }
  const r = RESOURCES[n.res];
  const x = action.i % W, y = Math.floor(action.i / W);
  if (Math.hypot(x - state.px, y - state.py) > 2.8) { action = null; return; }
  if (r.tool && !bestTool(r.tool)) { action = null; return; }
  const tier = r.tool ? ITEMS[bestTool(r.tool)].tier : 0;
  const chance = r.skill ? clamp(0.3 + (lvl(r.skill) - r.level) * 0.025 + tier * 0.07, 0.05, 0.95) : 1;
  if (r.skill === 'woodcutting') Sound.sfx('chop');
  else if (r.skill === 'mining') Sound.sfx('mine');
  if (Math.random() < chance) {
    if (r.skill === 'fishing') Sound.sfx('splash');
    else if (!r.skill) Sound.sfx('pick');
    addItem(r.item);
    if (r.skill) addXp(r.skill, r.xp);
    if (r.stone && Math.random() < r.stone && packFree()) addItem('stone');
    if (Math.random() < r.deplete) {
      n.until = now + r.respawn * 1000;
      action = null;
      if (r.skill === 'woodcutting') Sound.sfx('treefall');
      return;
    }
    if (!packFree()) { log('Your pack is full.', 'warn'); action = null; return; }
  }
  action.from = now;
  action.next = now + gatherTime(r);
}

function craftContext(sid) {
  if (sid == null) return { station: null, useStore: false };
  const s = structById(sid);
  return { station: s, useStore: !!s && nearStorehouse(s.x, s.y) };
}

function startCraft(recipeId, n, sid) {
  const r = RECIPES[recipeId], ctx = craftContext(sid);
  if (lvl(r.skill) < r.level) { log(`You need ${skillName(r.skill)} level ${r.level}.`, 'warn'); return; }
  if (!hasAll(r.inputs, ctx.useStore)) { log(`You need ${costText(r.inputs)}.`, 'warn'); return; }
  if (action && action.type !== 'combat') action = null;
  action = { type: 'craft', recipe: recipeId, left: n, sid, from: Date.now(), next: Date.now() + 1200 };
  closePanel();
}

function processCraft(now) {
  const r = RECIPES[action.recipe], ctx = craftContext(action.sid);
  if (action.sid != null && !ctx.station) { action = null; return; }
  if (!hasAll(r.inputs, ctx.useStore)) { log('You run out of materials.', 'dim'); action = null; return; }
  const outN = Object.values(r.outputs).reduce((a, b) => a + b, 0);
  let fromPack = 0;
  for (const k in r.inputs) fromPack += Math.min(have(k), r.inputs[k]);
  if (packFree() + fromPack < outN && !(ctx.useStore && storeCap() - storeUsed() >= outN)) { log('Your pack is full.', 'warn'); action = null; return; }
  payAll(r.inputs, ctx.useStore);
  Sound.sfx({ smithing: 'anvil', smelting: 'furnace', carpentry: 'saw', cooking: 'sizzle', crafting: 'craft' }[r.skill]);
  const give = (id, k) => (packFree() >= k || !ctx.useStore ? addItem(id, k) : addStore(id, k));
  if (r.burn && Math.random() < Math.max(0, 0.45 - (lvl(r.skill) - r.level) * 0.04)) {
    give('burnt_fish', 1);
    FX.gain(state.px, state.py, 'Burnt!');
    addXp(r.skill, 1);
  } else {
    for (const k in r.outputs) { give(k, r.outputs[k]); FX.gain(state.px, state.py, `+${r.outputs[k]} ${itemName(k)}`); }
    addXp(r.skill, r.xp);
  }
  action.left--;
  if (action.left <= 0 || !hasAll(r.inputs, ctx.useStore)) { action = null; return; }
  action.from = now;
  action.next = now + 1200;
}

// ---------------------------------------------------------------- monsters & combat
function monsterAt(x, y) { return monsters.find(m => m.x === x && m.y === y && m.hp > 0); }
function monsterBlocked(x, y, now) {
  if (solidTile(x, y, now)) return true;
  if (townAt(x, y, 3)) return true;
  if (x === Math.round(state.px) && y === Math.round(state.py)) return true;
  return !!monsterAt(x, y);
}

function spawnMonster(far) {
  for (let tries = 0; tries < 25; tries++) {
    const x = randInt(2, W - 3), y = randInt(2, H - 3);
    if (far && Math.abs(x - state.px) < 40 && Math.abs(y - state.py) < 40) continue;
    const table = spawnTable(x, y);
    if (!table || monsterBlocked(x, y, Date.now())) continue;
    const type = pickWeighted(Math.random, table);
    // With the Bandit King gone, his gangs thin out.
    if (type === 'bandit' && state.story.choice === 'slain' && Math.random() < 0.6) continue;
    monsters.push({ id: nextMonsterId++, type, x, y, hx: x, hy: y, hp: MONSTERS[type].hp, aggro: false, nextMove: 0, nextAtk: 0 });
    return;
  }
}

function stepToward(m, tx, ty, now) {
  const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
  const opts = Math.abs(tx - m.x) > Math.abs(ty - m.y) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
  for (const [a, b] of opts) {
    if ((a || b) && !monsterBlocked(m.x + a, m.y + b, now)) { m.x += a; m.y += b; return; }
  }
}

function updateMonsters(now) {
  const cl = combatLevel(), safe = inAnyTown() || state.sailing;
  for (const m of monsters) {
    if (m.hp <= 0) continue;
    if (Math.abs(m.x - state.px) > 50 || Math.abs(m.y - state.py) > 50) continue;
    const def = MONSTERS[m.type];
    const dist = Math.hypot(m.x - state.px, m.y - state.py);
    if (m.stunUntil > now) continue;
    if (monsterSpecial(m, def, now, dist)) continue;
    if (!m.aggro && def.aggressive && dist <= 6 && cl <= def.level * 2 + 4 && !safe) {
      m.aggro = true;
      log(`${cap(aMonster(def))} is coming for you!`, 'warn');
      Sound.sfx('growl');
    }
    if (m.aggro && (dist > 16 || safe || Math.hypot(m.x - m.hx, m.y - m.hy) > (def.boss ? 9 : 28))) m.aggro = false;
    if (now >= m.nextMove) {
      if (m.aggro) {
        if (dist > 1.3) stepToward(m, Math.round(state.px), Math.round(state.py), now);
        m.nextMove = now + def.move;
      } else {
        if (Math.hypot(m.x - m.hx, m.y - m.hy) > 8) stepToward(m, m.hx, m.hy, now);
        else if (Math.random() < 0.4) {
          const [a, b] = [[1, 0], [-1, 0], [0, 1], [0, -1]][randInt(0, 3)];
          if (!monsterBlocked(m.x + a, m.y + b, now)) { m.x += a; m.y += b; }
        }
        m.nextMove = now + 1200 + Math.random() * 2000;
      }
    }
    if (m.aggro && dist <= 1.6 && now >= m.nextAtk) {
      monsterAttack(m);
      m.nextAtk = now + def.speed;
      // Fight back automatically, unless that hit just sent you home.
      if (!action && m.aggro) action = { type: 'combat', id: m.id, next: now + 600 };
    }
  }
  monsters = monsters.filter(m => m.hp > 0);
}

function hitChance(atkRoll, defRoll) {
  return atkRoll > defRoll ? 1 - (defRoll + 2) / (2 * (atkRoll + 1)) : atkRoll / (2 * (defRoll + 1));
}

function startCombat(m) {
  if (inAnyTown() || state.sailing) return;
  action = { type: 'combat', id: m.id, next: Date.now() + 300 };
  m.aggro = true;
}

function processCombat(now) {
  const m = monsters.find(mm => mm.id === action.id && mm.hp > 0);
  if (!m) { action = null; return; }
  const dist = Math.hypot(m.x - state.px, m.y - state.py);
  if (dist > 8) { action = null; return; }
  if (dist > 1.8) return;
  if (!moving) state.face = Math.atan2(m.x - state.px, m.y - state.py);
  if (combat.blocking || combat.dodgeLeft > 0) { action.next = now + 250; return; }
  const def = MONSTERS[m.type], eq = equipStats();
  const atkL = lvl('attack') + (state.style === 'attack' ? 3 : 0);
  const strL = lvl('strength') + (state.style === 'strength' ? 3 : 0);
  const hit = Math.random() < hitChance((atkL + 8) * (64 + eq.acc), (def.def + 8) * 64);
  const maxHit = Math.max(1, Math.floor(0.5 + (strL + 8) * (64 + eq.str) / 640));
  let dmg = hit ? randInt(1, maxHit) : 0;
  // Only Frostbane bites through the Frost Wurm's frozen hide.
  if (m.type === 'wurm' && dmg > 1 && state.equip.weapon !== 'frostbane') {
    dmg = 1;
    if (!action.warned) { action.warned = true; log('Your blade skitters off the Wurm\'s frozen hide! Only a Firstsmith blade could cut it.', 'warn'); }
  }
  m.aggro = true;
  FX.damage(m.x, m.y, dmg);
  Sound.sfx(dmg ? 'hit' : 'miss');
  if (dmg > 0) {
    m.hp -= dmg;
    addXp(state.style, dmg * 4);
    addXp('hitpoints', dmg * 1.33);
  }
  if (m.hp <= 0) { killMonster(m); return; }
  petAttack(m);
  if (m.hp <= 0) return;
  const weaponTier = state.equip.weapon ? ITEMS[state.equip.weapon].tier : 0;
  action.next = now + 2400 - weaponTier * 150;
}

function monsterAttack(m) {
  const def = MONSTERS[m.type], eq = equipStats();
  const defL = lvl('defence') + (state.style === 'defence' ? 3 : 0);
  dismount('You leap down from your horse to fight.');
  if (invulnerable(Date.now())) { FX.lunge(m); FX.damage(state.px, state.py, 0, true); state.stats.dodges = (state.stats.dodges || 0) + 1; return; }
  const hit = Math.random() < hitChance((def.atk + 8) * 64, (defL + 8) * (64 + eq.def));
  const dmg = hit ? Math.round(randInt(1, def.maxHit) * blockFactor(m.x, m.y)) : 0;
  FX.lunge(m);
  FX.damage(state.px, state.py, dmg, true);
  Sound.sfx(dmg ? 'hurt' : 'block');
  if (dmg > 0) {
    state.hp -= dmg;
    uiDirty = true;
    if (state.hp <= 0) die(def);
  }
}

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
  if (def.boss) { state.bossBack[m.type] = Date.now() + 5 * 60 * 1000; toast(`${cap(theMonster(def))} falls!`, 'level'); }
  Sound.sfx('defeat');
  recordKill(m.type);
  Story.onKill(m.type);
  log(`You defeat ${theMonster(def)}${loot.length ? '. Loot: ' + loot.join(', ') : '.'}`, 'good');
  action = null;
}

function respawnPoint() {
  const home = state.home && structById(state.home);
  if (home && home.level) {
    for (const [x, y] of [[home.x - 1, home.y], [home.x + 2, home.y], [home.x, home.y - 1], [home.x, home.y + 2]]) {
      if (!collides(x, y, Date.now())) return { x, y };
    }
  }
  return { x: HOMESTEAD.x + 0.5, y: HOMESTEAD.y + 2 };
}

function die(killer) {
  const lost = Math.floor(state.gold * 0.1);
  state.gold -= lost;
  state.hp = maxHp();
  const p = respawnPoint();
  state.px = p.x; state.py = p.y;
  state.sailing = false;
  action = null;
  for (const m of monsters) m.aggro = false;
  Sound.sfx('death');
  log(`You were slain by ${aMonster(killer)}! You wake up ${lost ? lost + ' gold lighter' : 'bruised'}.`, 'bad');
}

// ---------------------------------------------------------------- exploration
const CHEST_LOOT = [['pine_plank', 6], ['copper_bar', 4], ['iron_bar', 2], ['trout', 3], ['rough_gem', 1], ['wolf_pelt', 1], ['oak_plank', 3]];
const HOARD_LOOT = [['steel_bar', 4], ['gold_bar', 2], ['rough_gem', 2], ['ancient_coin', 2], ['frostwood_plank', 4], ['star_fragment', 1]];
function openChest(poi) {
  if (Story.onChest(poi)) { state.opened[poi] = true; return; }
  if (state.opened[poi]) { log('The chest is empty. Someone got here first... you.', 'dim'); return; }
  state.opened[poi] = true;
  // Dungeon hoards are much richer than chests out in the open.
  const hoard = poi.endsWith('_hoard'), table = hoard ? HOARD_LOOT : CHEST_LOOT;
  const gold = hoard ? randInt(300, 600) : randInt(40, 160);
  state.gold += gold;
  const got = [`${gold} gold`];
  for (let k = 0; k < (hoard ? 3 : 2); k++) {
    const [id, n] = table[randInt(0, table.length - 1)];
    addItem(id, n);
    got.push(`${n} ${itemName(id)}`);
  }
  Sound.sfx('chest');
  log(`You open the chest and find ${got.join(', ')}!`, 'gold');
  toast('Treasure found!', 'gold');
}
function pray(poi) {
  const now = Date.now();
  if (state.shrineUsed[poi] && now - state.shrineUsed[poi] < 120000) { log('The shrine is quiet. Come back later.', 'dim'); return; }
  state.shrineUsed[poi] = now;
  state.hp = maxHp();
  Sound.sfx('shrine');
  log('A warm light washes over you. Your wounds are healed.', 'good');
  FX.gain(state.px, state.py, 'Healed', 'level');
  Story.atShrine(poi);
}
function scanPois() {
  for (const p of pois) {
    if (state.pois[p.id] || Math.hypot(p.x - state.px, p.y - state.py) > 8) continue;
    state.pois[p.id] = true;
    toast(`Discovered: ${p.name}`, 'level');
    Sound.sfx('discover');
  }
  if (!state.pois.summit && Math.hypot(PEAK.x - state.px, PEAK.y - state.py) < 5) {
    state.pois.summit = true;
    toast('You reached the summit of Mount Skyhorn!', 'level');
    Sound.sfx('discover');
  }
}
// One Frost Drake guards the summit; it returns a while after being slain.
// Bosses guard the summit and the dungeons' deepest rooms, returning a while after being slain.
function ensureBosses(now) {
  const spots = [{ type: 'drake', x: PEAK.x, y: PEAK.y + 2 }, ...DUNGEONS.map(d => ({ type: d.boss, x: d.bossRoom.x, y: d.bossRoom.y }))];
  for (const b of spots) {
    if (now < (state.bossBack[b.type] || 0) || monsters.some(m => m.type === b.type) || monsterBlocked(b.x, b.y, now)) continue;
    monsters.push({ id: nextMonsterId++, type: b.type, x: b.x, y: b.y, hx: b.x, hy: b.y, hp: MONSTERS[b.type].hp, aggro: false, nextMove: 0, nextAtk: 0 });
  }
  // The Bandit King waits at the Red Stones once you refuse him.
  const rs = pois.find(p => p.id === 'redstones');
  if (state.story.side === 2 && rs && !monsters.some(m => m.type === 'banditking') && !monsterBlocked(rs.x, rs.y + 1, now)) {
    monsters.push({ id: nextMonsterId++, type: 'banditking', x: rs.x, y: rs.y + 1, hx: rs.x, hy: rs.y + 1, hp: MONSTERS.banditking.hp, aggro: false, nextMove: 0, nextAtk: 0 });
  }
  // Keep the dungeons stocked with their monsters.
  for (const d of DUNGEONS) {
    if (monsters.filter(m => m.type === d.monster && inDungeonRect(m.x, m.y) === d).length >= 9) continue;
    for (let tries = 0; tries < 20; tries++) {
      const x = d.x0 + randInt(1, d.w - 2), y = d.y0 + randInt(1, d.h - 2);
      if (!dungeonMask[idx(x, y)] || Math.hypot(x - d.start.x, y - d.start.y) < 9 || monsterBlocked(x, y, now)) continue;
      monsters.push({ id: nextMonsterId++, type: d.monster, x, y, hx: x, hy: y, hp: MONSTERS[d.monster].hp, aggro: false, nextMove: 0, nextAtk: 0 });
      break;
    }
  }
}

// Time of day: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
const daylight = () => clamp(Math.sin((state.time - 0.25) * Math.PI * 2) * 2.2 + 0.3, 0, 1);
const isNight = () => daylight() < 0.25;
function clockText() {
  const mins = Math.floor(state.time * 24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}
const WEATHERS = [['clear', 0.5], ['cloudy', 0.22], ['rain', 0.16], ['fog', 0.12]];
function advanceTime(dt) {
  const before = state.time;
  state.time = (state.time + dt / DAY_SECONDS) % 1;
  if (state.time < before) state.day++;
  state.weather.left -= dt;
  if (state.weather.left <= 0) {
    const kind = pickWeighted(Math.random, SEASON_WEATHER[seasonIdx()]);
    if (kind !== state.weather.kind && kind === 'rain') log('Dark clouds roll in. It starts to rain.', 'dim');
    state.weather = { kind, left: 150 + Math.random() * 240 };
  }
}

// What the music and ambience should be doing right now.
function soundScene() {
  const tx = Math.round(state.px), ty = Math.round(state.py);
  const fighting = (action && action.type === 'combat') || monsters.some(m => m.aggro && Math.hypot(m.x - state.px, m.y - state.py) < 10);
  const town = townAt(tx, ty, 3);
  let water = 0, fire = 0;
  for (let y = ty - 5; y <= ty + 5; y++) for (let x = tx - 5; x <= tx + 5; x++) {
    if (x < 0 || y < 0 || x >= W || y >= H || terrain[idx(x, y)] !== T.WATER) continue;
    water = Math.max(water, 1 - Math.hypot(x - state.px, y - state.py) / 6);
  }
  for (const s of state.structs) {
    if ((s.type === 'campfire' || s.type === 'furnace') && s.level) fire = Math.max(fire, 1 - Math.hypot(s.x - state.px, s.y - state.py) / 7);
  }
  const night = isNight();
  return {
    mood: fighting ? 'combat' : town ? 'town' : night ? 'night' : 'wilds',
    town, water, fire, night, rain: state.weather.kind === 'rain',
    wind: clamp(groundHeight(state.px, state.py) / 20, 0.15, 1), forest: biome[idx(tx, ty)] === BIOME.FOREST,
  };
}

// ---------------------------------------------------------------- markets
function marketInit() {
  for (const town in TOWNS) {
    const m = state.markets[town] = state.markets[town] || { mult: {}, supply: {}, prev: {}, event: null };
    for (const id in ITEMS) {
      if (m.mult[id] == null) m.mult[id] = 0.85 + Math.random() * 0.3;
      if (m.prev[id] == null) m.prev[id] = m.mult[id];
      if (m.supply[id] == null) m.supply[id] = 0;
    }
  }
}

function marketDrift() {
  const news = [];
  for (const town in TOWNS) {
    const m = state.markets[town];
    for (const id in ITEMS) {
      m.prev[id] = m.mult[id];
      const noise = (Math.random() + Math.random() + Math.random() - 1.5) * 0.08;
      m.mult[id] = clamp(m.mult[id] + (1 - m.mult[id]) * 0.06 + noise, 0.5, 2.0);
      m.supply[id] *= 0.92;
    }
    if (m.event && --m.event.left <= 0) m.event = null;
    if (!m.event && Math.random() < 0.03) {
      const pool = Object.keys(ITEMS).filter(k => ITEMS[k].value >= 5);
      const id = pool[randInt(0, pool.length - 1)];
      const boom = Math.random() < 0.65;
      m.mult[id] = boom ? 1.9 : 0.55;
      m.event = { id, boom, left: 8 };
      news.push(boom ? `News from ${TOWNS[town].name}: a big order drives up the price of ${itemName(id).toLowerCase()}!`
        : `News from ${TOWNS[town].name}: a glut of ${itemName(id).toLowerCase()} floods the market.`);
    }
  }
  return news;
}

function townBuyMult(town, id) {
  const b = TOWNS[town].buy, c = itemCategory(id);
  // Frosthollow pays double for food while the winter deepens.
  const winter = (town === 'frosthollow' && c === 'food' && state.story.winter > 0 ? 1.6 : 1) * (c === 'food' && seasonIdx() === 3 ? 1.25 : 1);
  return winter * (b[c] != null ? b[c] : b.default != null ? b.default : 1);
}
function sellPrice(town, id) {
  const m = state.markets[town];
  return Math.max(1, Math.round(ITEMS[id].value * townBuyMult(town, id) * m.mult[id] / (1 + m.supply[id] / 60)));
}
const buyPrice = (town, id) => Math.ceil(ITEMS[id].value * state.markets[town].mult[id] * TOWNS[town].markup);

function sell(town, id, n) {
  if (ITEMS[id].quest) return;
  n = Math.min(n, have(id));
  if (!n) return;
  let total = 0;
  for (let k = 0; k < n; k++) { total += sellPrice(town, id); state.markets[town].supply[id] += 1; }
  removeItem(id, n);
  state.gold += total;
  state.stats.earned += total;
  log(`Sold ${n} ${itemName(id)} for ${fmt(total)} gold.`, 'gold');
  Sound.sfx('coins');
}

function buy(town, id, n) {
  n = Math.min(n, packFree());
  if (!n) { log('Your pack is full.', 'warn'); return; }
  let bought = 0, total = 0;
  for (let k = 0; k < n; k++) {
    const p = buyPrice(town, id);
    if (state.gold < p) break;
    state.gold -= p; total += p; bought++;
  }
  if (!bought) { log('You cannot afford that.', 'warn'); return; }
  addItem(id, bought);
  log(`Bought ${bought} ${itemName(id)} for ${fmt(total)} gold.`, 'gold');
  Sound.sfx('coins');
}

const carriageFee = (from, to) => 15 + Math.round(Math.hypot(townXY(from).x - townXY(to).x, townXY(from).y - townXY(to).y) / 4);
function travel(from, to) {
  const fee = carriageFee(from, to);
  if (state.gold < fee) { log(`The carriage costs ${fee} gold.`, 'warn'); return; }
  state.gold -= fee;
  const dest = townXY(to).arrive;
  state.px = dest.x; state.py = dest.y;
  if (collides(state.px, state.py, Date.now())) { state.px += 0.5; state.py += 1; }
  action = null;
  closePanel();
  log(`You ride the carriage to ${TOWNS[to].name}.`, 'good');
  Sound.sfx('coins');
}

// ---------------------------------------------------------------- empire simulation
function structDanger(s) {
  const c = structCenter(s), i = idx(Math.round(c.x), Math.round(c.y));
  const dCap = Math.hypot(c.x - TOWN_DEFS.ironhold.x, c.y - TOWN_DEFS.ironhold.y);
  return 0.6 + dCap / 120 + (biome[i] === BIOME.BADLANDS ? 0.6 : 0) + (biome[i] === BIOME.HIGHLANDS ? 0.4 : 0);
}
function towerDefense(s) {
  const c = structCenter(s);
  let d = 0;
  for (const t of state.structs) {
    if (t.type !== 'guard_tower' || !t.level) continue;
    const tc = structCenter(t);
    if (Math.hypot(tc.x - c.x, tc.y - c.y) <= EMPIRE.towerRadius) d += t.guards.reduce((a, g) => a + EMPIRE.guardPower(g), 0);
  }
  // Walls slow the raiders down, up to a point.
  let walls = 0;
  for (const t of state.structs) if (STRUCTS[t.type].wall && t.level && Math.hypot(t.x - c.x, t.y - c.y) <= EMPIRE.towerRadius) walls += t.level * EMPIRE.wallPower;
  return d + Math.min(30, walls);
}

// Advance the empire by dt seconds. `report` collects totals for offline summaries.
function simEmpire(dt, report) {
  simCaravans(dt, report);
  simTown(dt, report);
  const wage = wagesPerMin() * dt / 60;
  if (wage > 0) {
    if (state.gold < wage) {
      if (!state.unpaid) logOrReport(report, 'Your workers are unpaid and have stopped working!', 'bad');
      state.unpaid = true;
      return;
    }
    state.gold -= wage;
    if (report) report.wages += wage;
  }
  state.unpaid = false;
  const capN = storeCap();
  for (const s of state.structs) {
    const def = structDef(s);
    if (!s.level || !s.workers) continue;
    if (s.damaged > 0) { s.damaged = Math.max(0, s.damaged - dt); continue; }
    const rate = s.workers * EMPIRE.ratePerWorker * (1 + 0.25 * (s.level - 1)) * dt / 60;
    if (def.gather && s.out) {
      s.acc += rate * Math.min(1, richness(s, s.out) / 5);
      const n = Math.floor(s.acc);
      s.acc -= n;
      const add = Math.min(n, Math.max(0, capN - storeUsed()));
      if (add > 0) {
        const item = RESOURCES[s.out].item;
        addStore(item, add);
        if (report) report.produced[item] = (report.produced[item] || 0) + add;
      }
      if (n) s.blocked = n > add ? 'full' : null;
    } else if (def.station && s.recipe && s.on) {
      s.acc += rate;
      const n = Math.floor(s.acc);
      s.acc -= n;
      const r = RECIPES[s.recipe];
      if (n) s.blocked = null;
      for (let j = 0; j < n; j++) {
        let ok = true;
        for (const k in r.inputs) if ((state.store[k] || 0) < r.inputs[k]) ok = false;
        if (!ok) { s.blocked = 'materials'; s.acc = 0; break; }
        for (const k in r.inputs) { takeStore(k, r.inputs[k]); if (report) report.consumed[k] = (report.consumed[k] || 0) + r.inputs[k]; }
        for (const o in r.outputs) { addStore(o, r.outputs[o]); if (report) report.produced[o] = (report.produced[o] || 0) + r.outputs[o]; }
      }
    }
  }
  state.threat = Math.min(100, state.threat + 0.5 * dt / 60);
  state.raidTimer += dt;
  while (state.raidTimer >= EMPIRE.raidInterval) {
    state.raidTimer -= EMPIRE.raidInterval;
    rollRaids(report);
  }
}

function logOrReport(report, text, cls) {
  if (report) { report.events.push(text); return; }
  log(text, cls);
  if (cls === 'bad') { Sound.sfx('alarm'); toast(text, 'bad'); }
}

function rollRaids(report) {
  if (state.story.choice === 'paid') return; // the Bandit King keeps his word
  for (const s of state.structs) {
    const def = structDef(s);
    if (!s.level || !(def.gather || s.type === 'storehouse')) continue;
    const danger = structDanger(s);
    if (Math.random() >= (0.02 + state.threat / 400) * danger) continue;
    const strength = 4 + state.threat * 0.25 + Math.random() * 8 * danger;
    if (towerDefense(s) >= strength) {
      state.threat = Math.max(0, state.threat - 5);
      logOrReport(report, `Bandits attacked your ${def.name}, but your guards drove them off!`, 'good');
      continue;
    }
    state.threat = Math.max(0, state.threat - 15);
    if (s.type === 'storehouse') {
      const frac = 0.15 + Math.random() * 0.2;
      let stolen = 0;
      for (const k of Object.keys(state.store)) { const n = Math.floor(state.store[k] * frac); if (n) { takeStore(k, n); stolen += n; } }
      logOrReport(report, `Bandits raided your Storehouse and stole ${stolen} goods!`, 'bad');
    } else {
      s.damaged = 180;
      let extra = '';
      if (s.workers > 0 && Math.random() < 0.3) { s.workers--; extra = ' A worker quit.'; }
      logOrReport(report, `Bandits wrecked your ${def.name}! It's out of action for 3 minutes.${extra}`, 'bad');
    }
  }
}

function runOffline() {
  const elapsed = Math.min((Date.now() - state.savedAt) / 1000, EMPIRE.offlineCapHours * 3600);
  if (elapsed < 30) return null;
  const report = { seconds: elapsed, produced: {}, consumed: {}, wages: 0, events: [] };
  for (let t = 0; t < elapsed; t += 10) { simEmpire(Math.min(10, elapsed - t), report); advanceTime(Math.min(10, elapsed - t)); }
  for (let k = 0; k < Math.min(200, Math.floor(elapsed / 30)); k++) marketDrift();
  for (const town in TOWNS) state.markets[town].event = null;
  if (!Object.keys(report.produced).length && !report.events.length && !report.wages && !report.taxes) return null;
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
    else if (action.type === 'construct') processConstruct(now);
  }
  updateMonsters(now);

  if (now - lastSpawn > 1000) {
    lastSpawn = now;
    if (monsters.length < 380) spawnMonster(true);
  }
  if (now - lastRegen > 6000) {
    lastRegen = now;
    if (state.hp < maxHp()) { state.hp++; uiDirty = true; }
  }
  if (dt > 0 && dt < 5) { simEmpire(dt, null); advanceTime(dt); extrasTick(dt); }
  if (now - lastPoiScan > 500) {
    lastPoiScan = now;
    scanPois();
    Story.tick();
    ensureBosses(now);
    // Teleports, carriages and the like put you back on your feet.
    if (state.sailing && !sailable(Math.round(state.px), Math.round(state.py))) state.sailing = false;
    Sound.update(soundScene());
  }

  state.marketTimer += dt;
  if (state.marketTimer >= 30) {
    state.marketTimer = 0;
    for (const n of marketDrift()) log(n, 'gold');
    if (panel && panel.kind === 'market') uiDirty = true;
  }

  const town = townAt(Math.round(state.px), Math.round(state.py), 2);
  if (town && !state.discovered[town]) {
    state.discovered[town] = true;
    log(TOWNS[town].desc, 'level');
    toast(`Discovered: ${TOWNS[town].name}`, 'level');
    Sound.sfx('discover');
  }

  if (now - lastInteractScan > 150) {
    lastInteractScan = now;
    if (buildMode) updateBuildMode();
    interactTarget = buildMode ? null : findInteract(now);
  }

  if (now - lastSave > 15000) save();
  renderHud();
  if (uiDirty) { renderPanel(); uiDirty = false; }
}

// Movement runs every animation frame so walking is smooth, in small steps so slow frames don't tunnel through walls.
function frameMove(dt) {
  const now = Date.now();
  let left = Math.min(dt, 0.25);
  updateStamina(left);
  while (left > 0) { const step = Math.min(left, 0.05); if (!dodgeMove(step, now)) movePlayer(step, now); left -= step; }
}

// ---------------------------------------------------------------- HUD
function bar(cur, max, cls, label) {
  const pct = clamp(cur / max * 100, 0, 100);
  return `<div class="bar ${cls}"><div style="width:${pct}%"></div><span>${label != null ? label : `${fmt(cur)} / ${fmt(max)}`}</span></div>`;
}

let lastHudKey = '';
const ico = (id, cls = 'ico') => `<img class="${cls}" src="${Icons.item(id)}" alt="">`;
function renderHud() {
  const key = [Math.floor(state.gold), state.hp, packUsed(), packCap(), state.style, Math.floor(state.threat), wagesPerMin(), state.unpaid, combatLevel()].join('|');
  if (key !== lastHudKey) {
    lastHudKey = key;
    $('hud-stats').innerHTML = `
      ${bar(Math.max(0, state.hp), maxHp(), 'hp', `${Math.max(0, state.hp)} / ${maxHp()} HP`)}
      <div class="stat-row">
        <span title="Gold">${Icons.ui('coin')}<b class="gold">${fmt(state.gold)}</b></span>
        <span title="Pack space">${Icons.ui('bag')}${packUsed()}/${packCap()}</span>
        <span title="Combat level and style (X to change)">${Icons.ui('sword')}${combatLevel()}&nbsp;<span class="dim">${cap(state.style)}</span></span>
      </div>
      <div class="stat-row small">
        <span title="Bandit threat: raids get likelier as it rises">${Icons.ui('skull')}Threat ${Math.floor(state.threat)}%</span>
        ${wagesPerMin() ? `<span title="Wages per minute">${Icons.ui('people')}${wagesPerMin()}g/min${state.unpaid ? ' <b class="bad">UNPAID</b>' : ''}</span>` : ''}
      </div>`;
  }
  // Only the quest you chose to track shows here.
  const q = Story.current();
  const qKey = q ? q.title + q.goal + q.progress : '';
  if ($('quest-track').dataset.key !== qKey) {
    $('quest-track').dataset.key = qKey;
    $('quest-track').classList.toggle('hidden', !q);
    $('quest-track').innerHTML = q ? `<b>${esc(q.title)}</b>${q.progress ? ` <span class="dim small">(${esc(q.progress)})</span>` : ''}<div class="small">${esc(q.goal)}</div>` : '';
  }
  const stamPct = Math.round(combat.stamina / staminaMax() * 100);
  if ($('hud-stam').dataset.v !== String(stamPct)) { $('hud-stam').dataset.v = stamPct; $('hud-stam').innerHTML = `<div class="bar stam" title="Stamina: dodge, block and specials use it"><div style="width:${stamPct}%"></div></div>`; }
  $('zone').textContent = state.myTown && myTownAt(state.px, state.py) ? state.myTown.name : regionName(state.px, state.py);
  const w = state.weather.kind;
  $('clock').innerHTML = `${Icons.ui(isNight() ? 'moon' : w === 'rain' ? 'rain' : w === 'clear' ? 'sun' : 'cloud')} ${seasonName()}, day ${state.day}, ${clockText()}`;

  const tgt = action && action.type === 'combat' ? monsters.find(m => m.id === action.id) : null;
  const tEl = $('hud-target');
  if (tgt) {
    const d = MONSTERS[tgt.type];
    tEl.innerHTML = `<div class="target-name">${d.name} <span class="dim">lvl ${d.level}</span></div>${bar(Math.max(0, tgt.hp), d.hp, 'enemy')}`;
    tEl.classList.remove('hidden');
  } else tEl.classList.add('hidden');

  let prompt = '', progress = -1;
  if (buildMode) {
    const def = STRUCTS[buildMode.type];
    prompt = `Placing <b>${def.name}</b>: ${buildMode.valid ? '<span class="good">click to place</span>' : `<span class="bad">${esc(buildMode.reason)}</span>`}` +
      `${buildMode.info ? `<br><span class="small">In range: ${esc(buildMode.info)}</span>` : ''}<br><span class="small dim">Right-click or Esc to cancel</span>`;
  } else if (action) {
    if (action.from && action.next > action.from) progress = clamp((Date.now() - action.from) / (action.next - action.from), 0, 1);
    if (action.type === 'gather') prompt = `${esc(describeTarget({ kind: 'node', n: nodes.get(action.i) }))}...`;
    else if (action.type === 'craft') prompt = `${ico(Object.keys(RECIPES[action.recipe].outputs)[0])} Making ${esc(itemName(Object.keys(RECIPES[action.recipe].outputs)[0]))} (${action.left} left)`;
    else if (action.type === 'construct') { const s = structById(action.sid); prompt = s ? `Building ${structDef(s).name}: ${buildPct(s)}%` : ''; }
    else if (action.type === 'combat') {
      const cd = Math.ceil((combat.specialAt - Date.now()) / 1000);
      prompt = (tgt && Math.hypot(tgt.x - state.px, tgt.y - state.py) > 1.8 ? 'Get closer to attack!' : combat.blocking ? '<b>Blocking</b>' : 'Fighting!') +
        `<br><span class="small"><kbd>Space</kbd> dodge <kbd>Q</kbd> block <kbd>R</kbd> ${specialFor().name}${cd > 0 ? ` (${cd}s)` : ''} <kbd>F</kbd> eat</span>`;
    }
  } else if (interactTarget) prompt = `<kbd>E</kbd> ${esc(describeTarget(interactTarget))}`;
  const html = prompt + (progress >= 0 ? `<div class="progress"><div style="width:${progress * 100}%"></div></div>` : '');
  const pEl = $('prompt');
  if (pEl.innerHTML !== html) pEl.innerHTML = html;
  pEl.classList.toggle('hidden', !prompt);
}

// Short banners for big moments: level ups, discoveries, raids.
function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="t-title">${esc(text)}</div>`;
  el.at = Date.now();
  if (pendingSub) { bannerSub(el, pendingSub); pendingSub = null; }
  $('toasts').appendChild(el);
  lastBanner = el;
  while ($('toasts').children.length > 2) $('toasts').firstChild.remove();
  // Give banners with story text long enough to read.
  setTimeout(() => {
    const life = el.hasSub ? 5200 : 2800;
    setTimeout(() => el.classList.add('out'), life);
    setTimeout(() => el.remove(), life + 700);
  }, 0);
}

// Minimap: a pre-rendered image of the whole map, rotated with the camera.
let mapImage = null;
function buildMapImage() {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    let r = tileRGB[i * 3], gg = tileRGB[i * 3 + 1], b = tileRGB[i * 3 + 2];
    const n = nodes.get(i);
    if (n && SOLID_RES.has(n.res)) {
      if (RESOURCES[n.res].skill === 'woodcutting') { r *= 0.55; gg *= 0.72; b *= 0.55; } else { r = 0.42; gg = 0.4; b = 0.38; }
    }
    if (townBlocks.has(i)) { r = 0.55; gg = 0.3; b = 0.25; }
    img.data[i * 4] = r * 255; img.data[i * 4 + 1] = gg * 255; img.data[i * 4 + 2] = b * 255; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  mapImage = cv;
}

const mapTownIds = () => [...Object.keys(TOWN_DEFS), ...(state.myTown ? ['mytown'] : [])];
function drawMinimap() {
  const cv = $('minimap'), g = cv.getContext('2d');
  const size = cv.width, scale = 2.2, yaw = state.camYaw;
  g.save();
  g.clearRect(0, 0, size, size);
  g.beginPath(); g.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#1d3a52'; g.fillRect(0, 0, size, size);
  g.translate(size / 2, size / 2);
  g.rotate(yaw);
  g.scale(scale, scale);
  g.imageSmoothingEnabled = false;
  g.drawImage(mapImage, -state.px - 0.5, -state.py - 0.5);
  for (const s of state.structs) {
    g.fillStyle = s.level ? '#ffd84a' : '#c9a86a';
    const sz = structSize(s);
    g.fillRect(s.x - state.px - 0.5, s.y - state.py - 0.5, sz, sz);
  }
  for (const m of monsters) {
    if (Math.abs(m.x - state.px) > 45 || Math.abs(m.y - state.py) > 45) continue;
    g.fillStyle = m.aggro ? '#ff3a2a' : '#b8443e';
    g.fillRect(m.x - state.px - 0.6, m.y - state.py - 0.6, 1.2, 1.2);
  }
  for (const id of mapTownIds()) {
    const d = townXY(id);
    if (Math.abs(d.x - state.px) > 60 || Math.abs(d.y - state.py) > 60) continue;
    g.save();
    g.translate(d.x - state.px, d.y - state.py);
    g.rotate(-yaw);
    g.scale(1 / scale, 1 / scale);
    g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#ffe9a8';
    const name = state.discovered[id] ? TOWNS[id].name : '?';
    g.strokeText(name, 0, 4); g.fillText(name, 0, 4);
    g.restore();
  }
  // The current objective: on the ring when it's off the edge.
  const tg = Story.target();
  if (tg) {
    let dx = tg.x - state.px, dy = tg.y - state.py;
    const rx = dx * Math.cos(yaw) - dy * Math.sin(yaw), ry = dx * Math.sin(yaw) + dy * Math.cos(yaw);
    let sx = rx * scale, sy = ry * scale;
    const lim = size / 2 - 12, dd = Math.hypot(sx, sy);
    if (dd > lim) { sx *= lim / dd; sy *= lim / dd; }
    g.restore(); g.save();
    g.translate(size / 2 + sx, size / 2 + sy);
    drawStar(g, 7);
  }
  g.restore();
  // Player arrow, pointing the way you face.
  g.save();
  g.translate(size / 2, size / 2);
  g.rotate(yaw - state.face + Math.PI);
  g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
  // North marker on the rim.
  const nx = size / 2 - Math.sin(yaw) * (size / 2 - 11), ny = size / 2 - Math.cos(yaw) * (size / 2 - 11);
  g.font = 'bold 12px system-ui, sans-serif'; g.textAlign = 'center';
  g.lineWidth = 3; g.strokeStyle = '#000'; g.fillStyle = '#ff6a5a';
  g.strokeText('N', nx, ny + 4); g.fillText('N', nx, ny + 4);
}

// ---------------------------------------------------------------- panels
function openPanel(kind, data = {}) {
  buildMode = null;
  Sound.sfx('open');
  panel = { kind, data };
  $('panel').classList.remove('hidden');
  $('panel-body').scrollTop = 0;
  uiDirty = true;
  renderPanel();
}
function closePanel() { panel = null; $('panel').classList.add('hidden'); }
function togglePanel(kind) { if (panel && panel.kind === kind) closePanel(); else openPanel(kind); }

const PANEL_ICONS = { pack: 'bag', skills: 'star', craft: 'anvil', build: 'hammer', struct: 'house', market: 'coin', carriage: 'wheel',
  empire: 'castle', help: 'book', offline: 'sun', map: 'map', settings: 'gear', quests: 'scroll', talk: 'people', records: 'trophy', board: 'scroll', offering: 'star' };
const PANEL_VIEWS = {
  pack: () => packHtml(), skills: () => skillsHtml(), craft: d => craftHtml(d), build: () => buildHtml(), struct: d => structHtml(d),
  market: d => marketHtml(d), carriage: d => carriageHtml(d), empire: () => empireHtml(), help: () => helpHtml(),
  offline: d => offlineHtml(d), map: () => mapHtml(), settings: () => settingsHtml(),
  quests: () => Story.questsHtml(), talk: d => Story.talkHtml(d), board: d => Story.boardHtml(d), offering: () => Story.offeringHtml(), charter: () => charterHtml(), records: () => recordsHtml(),
};
function renderPanel() {
  if (!panel) return;
  const body = $('panel-body');
  const keepScroll = body.scrollTop;
  const [title, html] = PANEL_VIEWS[panel.kind](panel.data);
  if (!title) { closePanel(); return; }
  $('panel-title').textContent = title;
  body.innerHTML = html;
  body.scrollTop = keepScroll;
  $('panel').classList.toggle('wide', ['map', 'help', 'offline', 'records'].includes(panel.kind));
  $('panel-icon').innerHTML = Icons.ui(PANEL_ICONS[panel.kind] || 'scroll');
  if (panel.kind === 'map') drawWorldMap();
}

function packHtml() {
  const ids = Object.keys(state.inv).sort((a, b) => itemCategory(a).localeCompare(itemCategory(b)) || itemName(a).localeCompare(itemName(b)));
  const eq = equipStats();
  let html = `<div class="pack-cap">${bar(packUsed(), packCap(), 'cap', `${packUsed()} / ${packCap()} carried`)}</div>`;
  html += ids.length ? `<div class="slots">${ids.map(id => {
    const it = ITEMS[id];
    const hint = it.heal ? ` (heals ${it.heal}, click to eat)` : it.mount ? ' (click or Z to ride)' : it.pet ? (state.pet === id ? ' (with you; click to send home)' : ' (click to bring along)') : it.slot ? ` (click to equip${it.stats ? ': ' + Object.entries(it.stats).map(([k, v]) => `${k} +${v}`).join(', ') : ''})` : it.tool ? ' (tool)' : it.pack ? ` (+${it.pack} pack space)` : '';
    return `<div class="slot${it.heal || it.slot || it.mount || it.pet ? ' click' : ''}${state.pet === id || (it.mount && state.mounted) ? ' active' : ''}${it.rare ? ' rare' : ''}" data-item="${id}" title="${esc(it.name + hint)}">${ico(id, '')}<span class="qty">${fmt(state.inv[id])}</span></div>`;
  }).join('')}</div>` : '<p class="dim">Your pack is empty. Gather sticks from bushes and stones from loose stones.</p>';
  html += '<h3>Equipped</h3><div class="slots equip">';
  for (const slot of EQUIP_SLOTS) {
    const id = state.equip[slot];
    html += `<div class="slot${id ? ' click' : ' empty'}" data-unequip="${slot}" title="${id ? esc(itemName(id)) + ' (click to remove)' : cap(slot)}">${id ? ico(id, '') : `<span class="slot-label">${cap(slot)}</span>`}</div>`;
  }
  const fam = fullSet(), fb = fam && setBonus(fam);
  html += `</div><p class="small">Accuracy +${eq.acc} | Power +${eq.str} | Armour +${eq.def}</p>${fb ? `<p class="small gold">Full set bonus: ${Object.entries(fb).map(([k, v]) => `${{ acc: 'accuracy', str: 'power', def: 'armour' }[k]} +${v}`).join(', ')}</p>` : '<p class="small dim">Wear a matching head, body, legs and feet for a set bonus.</p>'}<h3>Tools in use</h3><div class="slots equip">`;
  for (const t of ['axe', 'pickaxe', 'rod']) {
    const id = bestTool(t);
    html += `<div class="slot${id ? '' : ' empty'}" title="${id ? esc(itemName(id)) : 'No ' + t}">${id ? ico(id, '') : `<span class="slot-label">${cap(t)}</span>`}</div>`;
  }
  html += `</div><h3>Combat style</h3><div class="row">${['attack', 'strength', 'defence'].map(s => `<button data-style="${s}" class="${state.style === s ? 'on' : ''}">${cap(s)}</button>`).join('')}</div>
    <p class="small dim">Your style gets +3 effective levels and earns the XP.</p>`;
  return ['Pack & Gear', html];
}

function settingsHtml() {
  const slider = (key, label) => `<label class="setting"><span>${label}</span><input type="range" min="0" max="1" step="0.05" value="${settings[key]}" data-setting="${key}"><span class="dim">${Math.round(settings[key] * 100)}%</span></label>`;
  return ['Settings', `
    <h3>Graphics</h3>
    <div class="row">${['low', 'medium', 'high'].map(q => `<button data-quality="${q}" class="${settings.quality === q ? 'on' : ''}">${cap(q)}</button>`).join('')}</div>
    <p class="small dim">Low turns off shadows and most grass and wildlife. High draws the most detail and the furthest view.</p>
    <h3>Sound</h3>
    ${slider('music', 'Music')}${slider('sfx', 'Effects')}${slider('ambient', 'Ambience')}
    <p><button data-mute="1" class="${settings.muted ? 'on' : ''}">${settings.muted ? 'Unmute all' : 'Mute all'}</button></p>
    <h3>Game</h3>
    <p><button data-save="1">Save now</button> <button data-help="1">How to play</button> <button data-reset="1" class="danger">Start over</button></p>
    <p class="small dim">Your game saves automatically every 15 seconds and when you close the page.</p>`];
}

function skillsHtml() {
  let html = '';
  for (const group of ['combat', 'gathering', 'building', 'refining']) {
    html += `<div class="group">${cap(group)}</div>`;
    for (const s of SKILLS.filter(k => k.group === group)) {
      const xp = state.xp[s.id], l = levelOf(xp);
      const lo = xpForLevel(l), hi = xpForLevel(l + 1);
      const pct = l >= MAX_LEVEL ? 100 : (xp - lo) / (hi - lo) * 100;
      html += `<div class="skill" title="${fmt(xp)} XP${l < MAX_LEVEL ? `, ${fmt(hi - xp)} to next level` : ''}">
        <span>${Icons.ui('skill-' + s.id)} ${s.name}</span><span class="lv">${l}</span><div class="xpbar"><div style="width:${pct}%"></div></div></div>`;
    }
  }
  html += `<p class="small dim">Kills: ${state.stats.kills} | Lifetime sales: ${fmt(state.stats.earned)}g</p>`;
  return ['Skills', html];
}

function craftHtml(data) {
  const s = data.sid != null ? structById(data.sid) : null;
  const ctx = craftContext(data.sid);
  let recipes, title, intro;
  if (s) {
    const skill = structDef(s).station;
    recipes = Object.values(RECIPES).filter(r => r.skill === skill);
    title = structDef(s).name;
    intro = `${skillName(skill)} level ${lvl(skill)}.${ctx.useStore ? ' Using goods from your pack and storehouse.' : ' Tip: build a Storehouse nearby to use its goods here.'}`;
  } else {
    recipes = Object.values(RECIPES).filter(r => r.hand);
    title = 'Hand crafting';
    intro = 'Simple things you can make anywhere. Press B to build a Workbench, Sawbench, Furnace, Anvil and Campfire to make much more.';
  }
  let html = `<p class="small dim">${intro}</p><table class="list">`;
  for (const r of recipes) {
    const out = Object.keys(r.outputs)[0], it = ITEMS[out];
    const locked = lvl(r.skill) < r.level;
    let maxN = Infinity;
    for (const k in r.inputs) maxN = Math.min(maxN, Math.floor(count(k, ctx.useStore) / r.inputs[k]));
    const stats = it.stats ? ` <span class="dim">[${Object.entries(it.stats).map(([k, v]) => `${k} +${v}`).join(' ')}]</span>` : it.pack ? ` <span class="dim">[+${it.pack} pack space]</span>` : '';
    html += `<tr class="${locked ? 'locked' : ''}"><td class="icocell">${ico(out, 'ico big')}</td><td><b>${esc(it.name)}</b>${stats}<br><span class="small">${costHtml(r.inputs, ctx.useStore)}</span></td>
      <td class="small">Lvl ${r.level}<br>${r.xp} xp</td><td class="btns">${locked ? 'Locked' :
      `<button data-craft="${r.id}" data-n="1" ${maxN ? '' : 'disabled'}>1</button><button data-craft="${r.id}" data-n="${maxN}" ${maxN ? '' : 'disabled'}>All (${maxN})</button>`}</td></tr>`;
  }
  return [title, html + '</table>'];
}

function buildHtml() {
  const useStore = nearStorehouse(state.px, state.py);
  let html = `<p class="small dim">Pick something, then click on the ground to place it. Placing it uses the materials. Then press E at the site to hammer it together.
    Construction level ${lvl('construction')}.</p><table class="list">`;
  for (const type in STRUCTS) {
    const d = STRUCTS[type];
    const locked = lvl('construction') < d.con;
    const ok = !locked && hasAll(d.cost, useStore);
    html += `<tr class="${locked ? 'locked' : ''}"><td><b>${d.name}</b> <span class="dim small">${d.size}x${d.size}</span><br>
      <span class="small dim">${esc(d.desc)}</span><br><span class="small">${costHtml(d.cost, useStore)}</span></td>
      <td class="small">Con ${d.con}</td><td class="btns">${locked ? 'Locked' : `<button data-build="${type}" ${ok ? '' : 'disabled'}>Place</button>`}</td></tr>`;
  }
  return ['Build', html + '</table>'];
}

function structHtml(data) {
  const s = structById(data.sid);
  if (!s) return [null, ''];
  const def = structDef(s);
  let html = `<p class="small dim">${esc(def.desc)}</p>`;
  if (s.pending) html += `<p class="warn">${s.level ? 'Upgrade' : 'Construction'} ${buildPct(s)}% done. Press E at it to keep building.</p>`;
  if (!s.level) return [`${def.name} (site)`, html];
  html += `<p>Level ${s.level} / ${STRUCT_MAX_LEVEL}</p>`;
  if (def.station) html += `<p><button data-sact="use" class="big">Use the ${def.name}</button></p>`;
  if (def.workers) {
    html += `<h3>Workers</h3><p class="small">${s.workers}/${def.workers[s.level - 1]} working. Beds used: ${staffCount()}/${housingCap()}.
      <button data-sact="hire">Hire (${EMPIRE.hireCost(workerTotal())}g)</button><button data-sact="fire">Fire</button></p>`;
    if (!housingCap()) html += '<p class="small warn">Workers need beds. Build a Cottage first.</p>';
    if (!storeCap()) html += '<p class="small warn">Workers deliver to a Storehouse. Build one first.</p>';
    if (def.gather) {
      const opts = Object.keys(RESOURCES).filter(r => RESOURCES[r].skill === def.gather);
      html += `<p class="small">Gathering: <b>${s.out ? RESOURCES[s.out].name : 'nothing'}</b> <button data-sact="cycle">Change</button></p>
        <p class="small dim">In range: ${opts.map(r => `${richness(s, r)} ${RESOURCES[r].name.toLowerCase()}`).join(', ')}. Full speed needs 5 or more.</p>`;
    } else {
      const r = s.recipe && RECIPES[s.recipe];
      html += `<p class="small">Workers make: <b>${r ? esc(itemName(Object.keys(r.outputs)[0])) : 'nothing'}</b> ${r ? `<span class="dim">(uses ${costText(r.inputs)} from the storehouse)</span>` : ''}
        <button data-sact="cycle">Change</button> <button data-sact="toggle">${s.on ? 'Running' : 'Paused'}</button></p>`;
    }
    if (s.blocked === 'materials') html += '<p class="small bad">Out of materials in the storehouse.</p>';
    if (s.blocked === 'full') html += '<p class="small bad">The storehouse is full.</p>';
    if (s.damaged > 0) html += `<p class="small bad">Wrecked by bandits. Back in ${Math.ceil(s.damaged)}s.</p>`;
  }
  if (def.guards) {
    html += `<h3>Guards</h3><p class="small">${s.guards.length}/${def.guards[s.level - 1]} guards (defence ${s.guards.reduce((a, g) => a + EMPIRE.guardPower(g), 0)}).
      Each needs a sword from your pack and ${EMPIRE.guardCost}g. <button data-sact="guard">Hire guard</button><button data-sact="dismiss">Dismiss</button></p>`;
  }
  if (def.caravans) html += caravanHtml(s);
  if (s.type === 'town_hall') html += hallHtml(s);
  if (def.housing) html += `<p>Beds here: ${def.housing[s.level - 1]}. Beds used: ${staffCount()}/${housingCap()}.${state.home === s.id ? ' You respawn here.' : ''}</p>`;
  if (def.storage) {
    const items = Object.keys(state.store).sort((a, b) => itemName(a).localeCompare(itemName(b)));
    html += `<h3>Stock: ${storeUsed()} / ${storeCap()}</h3><p class="small dim">All your storehouses share one stock.</p>
      <button data-sact="deposit" data-arg="all">Deposit all materials</button><table class="list">`;
    html += items.map(id => `<tr><td>${ico(id)} ${esc(itemName(id))}</td><td>${fmt(state.store[id])}</td>
      <td class="btns"><button data-sact="withdraw" data-arg="${id}:1">Take 1</button><button data-sact="withdraw" data-arg="${id}:10">10</button><button data-sact="withdraw" data-arg="${id}:999999">All</button></td></tr>`).join('');
    html += '</table><h3>Your pack</h3><table class="list">';
    html += Object.keys(state.inv).map(id => `<tr><td>${ico(id)} ${esc(itemName(id))}</td><td>${fmt(have(id))}</td>
      <td class="btns"><button data-sact="deposit" data-arg="${id}:1">Store 1</button><button data-sact="deposit" data-arg="${id}:999999">All</button></td></tr>`).join('');
    html += '</table>';
  }
  if (s.level < STRUCT_MAX_LEVEL && !s.pending) {
    const cost = upgradeCost(s), useStore = nearStorehouse(s.x, s.y), need = def.con + s.level * 5;
    html += `<h3>Upgrade to level ${s.level + 1}</h3><p class="small">${costHtml(cost, useStore)}. Needs Construction ${need}.
      <button data-sact="upgrade" ${hasAll(cost, useStore) && lvl('construction') >= need ? '' : 'disabled'}>Upgrade</button></p>`;
  }
  html += '<p><button data-sact="demolish" class="danger">Demolish</button></p>';
  return [def.name, html];
}

function trend(town, id) {
  const m = state.markets[town], d = m.mult[id] - m.prev[id];
  return d > 0.01 ? '<span class="up">&#9650;</span>' : d < -0.01 ? '<span class="down">&#9660;</span>' : '<span class="dim">-</span>';
}

function marketHtml(data) {
  const town = data.town, info = TOWNS[town], m = state.markets[town];
  const likes = Object.entries(info.buy).filter(([k, v]) => k !== 'default' && v > 1).map(([k]) => k);
  const dislikes = Object.entries(info.buy).filter(([k, v]) => k !== 'default' && v < 1).map(([k]) => k);
  let html = `<p class="small dim">${esc(info.desc)}</p>`;
  if (likes.length) html += `<p class="small">Pays extra for: <b class="good">${likes.join(', ')}</b></p>`;
  if (dislikes.length) html += `<p class="small">Pays little for: <span class="bad">${dislikes.join(', ')}</span></p>`;
  if (m.event) html += `<p class="gold small">News: ${m.event.boom ? 'big order' : 'glut'} on ${esc(itemName(m.event.id))}!</p>`;
  html += '<h3>Sell</h3><table class="list">';
  const ids = Object.keys(state.inv).sort((a, b) => sellPrice(town, b) * have(b) - sellPrice(town, a) * have(a));
  if (!ids.length) html += '<tr><td class="dim">Nothing to sell.</td></tr>';
  for (const id of ids) {
    if (ITEMS[id].quest) continue;
    html += `<tr><td>${ico(id)} ${esc(itemName(id))} <span class="dim">x${fmt(have(id))}</span></td><td>${sellPrice(town, id)}g ${trend(town, id)}</td>
      <td class="btns"><button data-sell="${id}" data-n="1">1</button><button data-sell="${id}" data-n="10">10</button><button data-sell="${id}" data-n="999999">All</button></td></tr>`;
  }
  html += '</table><button data-sellall="1">Sell all goods (keeps tools, gear and food)</button><h3>Buy</h3><table class="list">';
  for (const id of info.sells) {
    html += `<tr><td>${ico(id)} ${esc(itemName(id))}</td><td>${buyPrice(town, id)}g ${trend(town, id)}</td>
      <td class="btns"><button data-buy="${id}" data-n="1">1</button><button data-buy="${id}" data-n="10">10</button></td></tr>`;
  }
  return [`${info.name} Market`, html + '</table>'];
}

function carriageHtml(data) {
  let html = '<p class="small dim">Ride to any town you have already visited.</p><table class="list">';
  for (const id in TOWNS) {
    if (id === data.town) continue;
    html += `<tr><td><b>${TOWNS[id].name}</b><br><span class="small dim">${esc(TOWNS[id].desc)}</span></td><td class="btns">${state.discovered[id]
      ? `<button data-travel="${id}">${carriageFee(data.town, id)}g</button>` : '<span class="dim small">Not visited yet</span>'}</td></tr>`;
  }
  return ['Carriage', html + '</table>'];
}

function empireHtml() {
  let html = `<p>Gold <b class="gold">${fmt(state.gold)}</b> | Wages ${wagesPerMin()}g/min ${state.unpaid ? '<b class="bad">UNPAID!</b>' : ''}<br>
    Beds ${staffCount()}/${housingCap()} | Storage ${storeUsed()}/${storeCap()} | Bandit threat ${Math.floor(state.threat)}%</p>
    <p class="small dim">Workers keep going while you're offline (up to ${EMPIRE.offlineCapHours}h). Bandits raid camps and storehouses; guard towers protect everything within ${EMPIRE.towerRadius} tiles.
    Walk to a building and press E to manage it.</p>`;
  if (!state.structs.length) html += '<p>You haven\'t built anything yet. Press <kbd>B</kbd> to start.</p>';
  html += '<table class="list">';
  for (const s of state.structs) {
    const def = structDef(s), c = structCenter(s);
    let status = s.pending ? `<span class="warn">${s.level ? 'Upgrading' : 'Building'} ${buildPct(s)}%</span>` : `Lvl ${s.level}`;
    if (s.workers) status += ` | ${s.workers} workers`;
    if (s.guards && s.guards.length) status += ` | ${s.guards.length} guards`;
    if (def.gather && s.out) status += ` | ${RESOURCES[s.out].name}`;
    if (def.station && s.recipe && s.workers) status += ` | ${esc(itemName(Object.keys(RECIPES[s.recipe].outputs)[0]))}`;
    if (s.damaged > 0) status += ' <span class="bad">wrecked</span>';
    if (s.blocked) status += ` <span class="bad">${s.blocked === 'full' ? 'storage full' : 'no materials'}</span>`;
    html += `<tr><td><b>${def.name}</b><br><span class="small">${status}</span></td><td class="small dim">${Math.round(Math.hypot(c.x - state.px, c.y - state.py))} tiles away</td></tr>`;
  }
  html += '</table>';
  if (Object.keys(state.store).length) html += `<h3>Storehouse stock</h3><p class="small">${Object.entries(state.store).map(([k, v]) => `${v} ${esc(itemName(k))}`).join(', ')}</p>`;
  return ['Your Empire', html];
}

function mapHtml() {
  return ['World Map', `<canvas id="worldmap" width="${W * 2}" height="${H * 2}"></canvas>
    <p class="small dim">The white dot is you. Yellow squares are your buildings. Towns you haven't visited show as "?".</p>`];
}
function drawStar(g, r) {
  g.beginPath();
  for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 - Math.PI / 2, rr = k % 2 ? r * 0.45 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  g.closePath(); g.fillStyle = '#ffd84a'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.fill(); g.stroke();
}
function drawWorldMap() {
  const cv = $('worldmap');
  if (!cv) return;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(mapImage, 0, 0, W * 2, H * 2);
  for (const s of state.structs) { g.fillStyle = '#ffd84a'; g.fillRect(s.x * 2 - 1, s.y * 2 - 1, 5, 5); }
  g.font = 'bold 14px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 3; g.strokeStyle = '#000';
  for (const id of mapTownIds()) {
    const d = townXY(id), name = state.discovered[id] ? TOWNS[id].name : '?';
    g.fillStyle = '#ffe9a8';
    g.fillRect(d.x * 2 - 4, d.y * 2 - 4, 8, 8);
    g.strokeText(name, d.x * 2, d.y * 2 - 9); g.fillText(name, d.x * 2, d.y * 2 - 9);
  }
  const tg = Story.target();
  if (tg) { g.save(); g.translate(tg.x * 2, tg.y * 2); drawStar(g, 10); g.restore(); }
  g.fillStyle = '#fff'; g.strokeStyle = '#000';
  g.beginPath(); g.arc(state.px * 2, state.py * 2, 5, 0, Math.PI * 2); g.fill(); g.stroke();
}

function helpHtml() {
  return ['How to play', `
  <p>You wake beside a campfire in a quiet clearing south-west of Ironhold, with empty pockets and big dreams. Gather, craft, build, trade, and grow a medieval industrial empire.</p>
  <h3>Controls</h3>
  <p><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move, hold <kbd>Shift</kbd> to run | <b>drag the mouse</b> to swing the camera | <b>mouse wheel</b> to zoom<br>
  <kbd>E</kbd> use whatever is in front of you (or click it) | <kbd>F</kbd> eat | <kbd>X</kbd> combat style<br>
  <kbd>Space</kbd> dodge roll | hold <kbd>Q</kbd> to block (much better with a shield) | <kbd>R</kbd> weapon special | <kbd>Z</kbd> ride your horse<br>
  <kbd>B</kbd> build | <kbd>C</kbd> craft | <kbd>I</kbd> pack | <kbd>K</kbd> skills | <kbd>G</kbd> empire | <kbd>J</kbd> quests | <kbd>O</kbd> records | <kbd>M</kbd> map | <kbd>H</kbd> help | <kbd>Esc</kbd> close, or open settings</p>
  <h3>Getting started</h3>
  <ol>
    <li>Gather <b>sticks</b> from the bushes and <b>stones</b> from the loose stones around your camp. Walk up to them and press <kbd>E</kbd>.</li>
    <li>Press <kbd>C</kbd> and craft a <b>stone axe</b> and a <b>stone pickaxe</b>.</li>
    <li>Chop pine trees. Then press <kbd>B</kbd> and build a <b>Workbench</b> and a <b>Sawbench</b> wherever you like.</li>
    <li>Work towards a <b>Storehouse</b>, a <b>Furnace</b> and an <b>Anvil</b>. Smith copper tools to chop and mine faster.</li>
    <li>Build a <b>Cottage</b> for beds, then <b>Lumber Camps</b>, <b>Mines</b> and <b>Fishing Docks</b> near resources, and hire workers.</li>
    <li>Sell goods in towns. Each town pays more for different things: timber in the mountain town, metal at the forest lodge, rare loot at the black market.</li>
    <li>Bandits raid camps and storehouses. Smith swords and build <b>Guard Towers</b>.</li>
  </ol>
  <h3>Quests and secrets</h3>
  <p>There is no set path. Read the <b>notice boards</b> on every town square for work and rumours, and talk to people with a <b>!</b> over their heads.
  The Royal Herald in Ironhold knows of trouble in the north, if you want it: the Long Winter can be tackled in any order, or not at all.
  New quests aren't tracked until you choose: press <kbd>J</kbd> and click <b>Track</b> to show one under your stats and as a gold star on the map.</p>
  <p>The world hides <b>star seeds</b> on peaks, islands and lonely corners (offer five at any shrine for more stamina or pack space),
  <b>cairns</b> with buried treasure (bring a pickaxe), and <b>stone circles</b> whose altars hold riddles: turn the rune stones to answer them.</p>
  <h3>Caravans and your own town</h3>
  <p>Build a <b>Trading Post</b> to send wagon caravans along the roads: they sell goods from your storehouse in any town you've visited and can bring back what you choose. Hire caravan guards against ambushes.
  Once you have 6 townsfolk and 8 buildings, build a <b>Town Hall</b> and name your town: it gets its own market, a carriage stop and tax income, and settlers move in. Ring it with <b>Walls</b> and <b>Gates</b> to help your guards hold off raids.</p>
  <h3>Sailing</h3>
  <p>Craft a <b>sailboat</b> at a workbench (Crafting 18) or buy one in Saltmere. Face open water and press <kbd>E</kbd> to launch it, and <kbd>E</kbd> again facing the shore to land. Boats are fast, can reach fishing spots far from shore, and monsters can't follow you onto the water.</p>
  <h3>The world</h3>
  <p>Ironhold, the capital, is a short walk north-east of your camp. North over the mountains is <b>Stonedeep</b>, and past it the ogre-haunted highlands.
  To the east looms <b>Mount Skyhorn</b>: a trail spirals to its summit, where starstone veins and a Frost Drake await.
  Old ruins, standing stones, abandoned camps and shrines are scattered across the land, and some hide treasure.
  West is the great forest and <b>Thornwood</b>. South-west on the coast is <b>Saltmere</b>. East across the badlands is the bandit market, <b>Rat's Nest</b>.
  Further out lie <b>Gloomwater</b> in the western marsh, <b>Amberreach</b> in the eastern desert, <b>Frosthollow</b> in the far northern taiga, and the Corsair Isles off the south coast. Two dungeons lie beneath the marsh and the taiga.
  Once you've visited a town, its carriage can take you back there.</p>
  <p class="small dim">Progress saves to this browser every 15 seconds.</p>
  <button data-close="1">Let's go</button>`];
}

function offlineHtml(r) {
  const h = Math.floor(r.seconds / 3600), mn = Math.floor(r.seconds % 3600 / 60);
  const prod = Object.entries(r.produced).map(([k, v]) => `<li>${ico(k)} +${fmt(v)} ${esc(itemName(k))}</li>`).join('');
  const used = Object.entries(r.consumed).map(([k, v]) => `<li>${ico(k)} -${fmt(v)} ${esc(itemName(k))}</li>`).join('');
  return ['Welcome back!', `<p>You were away for ${h}h ${mn}m${r.seconds >= EMPIRE.offlineCapHours * 3600 ? ' (capped)' : ''}.</p>
    ${prod ? `<h3>Your workers produced</h3><ul>${prod}</ul>` : '<p class="dim">Your workers produced nothing.</p>'}
    ${used ? `<h3>Materials used</h3><ul>${used}</ul>` : ''}
    ${r.wages ? `<p>Wages paid: ${fmt(r.wages)}g</p>` : ''}
    ${r.taxes ? `<p class="gold">Taxes collected: ${fmt(r.taxes)}g</p>` : ''}
    ${r.events.length ? `<h3>Events</h3><ul>${r.events.slice(0, 12).map(e => `<li>${esc(e)}</li>`).join('')}${r.events.length > 12 ? `<li>...and ${r.events.length - 12} more</li>` : ''}</ul>` : ''}
    <p class="small dim">Everything went into your storehouse.</p><button data-close="1">Continue</button>`];
}

// ---------------------------------------------------------------- input
const MOVE_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift', 'q'];
function onKeyDown(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Typing in a text box (like naming your town) shouldn't trigger shortcuts.
  if (e.target.id === 'town-name') { if (e.key === 'Enter') foundTown(e.target.value); return; }
  const k = e.key.toLowerCase();
  if (MOVE_KEYS.includes(k)) {
    keys.add(k);
    if (k.startsWith('arrow')) e.preventDefault();
    return;
  }
  if (e.repeat) return;
  if (k === ' ') { e.preventDefault(); dodge(); return; }
  if (k === 'r') { specialAttack(); return; }
  if (k === 'escape') { if (buildMode) buildMode = null; else if (panel) closePanel(); else openPanel('settings'); return; }
  if (k === 'e') interact(interactTarget);
  else if (k === 'f') eat();
  else if (k === 'x') { const order = ['attack', 'strength', 'defence']; state.style = order[(order.indexOf(state.style) + 1) % 3]; log(`Combat style: ${cap(state.style)}.`); }
  else if (k === 'b') togglePanel('build');
  else if (k === 'c') toggleCraft();
  else if (k === 'i') togglePanel('pack');
  else if (k === 'k') togglePanel('skills');
  else if (k === 'g') togglePanel('empire');
  else if (k === 'm') togglePanel('map');
  else if (k === 'j') togglePanel('quests');
  else if (k === 'o') togglePanel('records');
  else if (k === 'z') toggleMount();
  else if (k === 'h' || k === '?') togglePanel('help');
  else return;
  uiDirty = true;
}
function onKeyUp(e) {
  const k = e.key.toLowerCase();
  keys.delete(k);
  // Shift changes e.key for letters, so clear both cases.
  if (k.length === 1) keys.delete(k.toUpperCase());
}
function toggleCraft() { if (panel && panel.kind === 'craft') closePanel(); else openPanel('craft', {}); }

function onPanelClick(e) {
  const b = e.target.closest('button, [data-item], [data-unequip]');
  if (!b || !panel) return;
  const d = b.dataset, town = panel.data.town;
  if (d.close) closePanel();
  else if (d.talk) Story.choose(d.talk);
  else if (d.board) Story.boardAction(d.board, d.q);
  else if (d.track) Story.track(d.track);
  else if (d.offer) Story.offer(d.offer);
  else if (d.found) foundTown($('town-name').value);
  else if (d.craft) startCraft(d.craft, +d.n, panel.data.sid);
  else if (d.build) startBuildMode(d.build);
  else if (d.sact) structAction(d.sact, structById(panel.data.sid), d.arg);
  else if (d.sell) sell(town, d.sell, +d.n);
  else if (d.sellall) { for (const id of Object.keys(state.inv)) { const it = ITEMS[id]; if (!it.tool && !it.slot && !it.heal && !it.pack && !it.quest && !it.boat && !it.mount && !it.pet) sell(town, id, have(id)); } }
  else if (d.buy) buy(town, d.buy, +d.n);
  else if (d.travel) travel(town, d.travel);
  else if (d.style) state.style = d.style;
  else if (d.item) { const it = ITEMS[d.item]; if (it.heal) eat(d.item); else if (it.slot) equip(d.item); else if (it.mount) toggleMount(); else if (it.pet) togglePet(d.item); }
  else if (d.unequip) unequip(d.unequip);
  else if (d.quality) { settings.quality = d.quality; saveSettings(); Render3D.setQuality(d.quality); }
  else if (d.mute) { settings.muted = !settings.muted; saveSettings(); Sound.applyVolumes(); }
  else if (d.save) { save(); log('Game saved.', 'dim'); toast('Game saved'); }
  else if (d.help) openPanel('help');
  else if (d.reset) resetGame();
  if (!d.item && !d.unequip) Sound.sfx('click');
  uiDirty = true;
}
function onPanelInput(e) {
  const key = e.target.dataset.setting;
  if (!key) return;
  settings[key] = +e.target.value;
  e.target.nextElementSibling.textContent = `${Math.round(settings[key] * 100)}%`;
  saveSettings();
  Sound.applyVolumes();
}
function resetGame() {
  if (!confirm('Erase your save and start over?')) return;
  try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  window.removeEventListener('beforeunload', save);
  location.reload();
}

// ---------------------------------------------------------------- boot
function init() {
  generateWorld();
  const loaded = load();
  if (!loaded) state = newState();
  defineMyTown();
  Story.init();
  marketInit();
  indexStructs();
  // Nothing grows through your buildings.
  for (const st of state.structs) for (const [x, y] of footprint(st.x, st.y, structSize(st))) nodes.delete(idx(x, y));
  if (collides(state.px, state.py, Date.now())) { const p = respawnPoint(); state.px = p.x; state.py = p.y; }
  state.hp = clamp(state.hp, 1, maxHp());
  buildMapImage();

  const report = loaded ? runOffline() : null;
  for (let k = 0; k < 330; k++) spawnMonster(true);

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());
  $('panel-body').addEventListener('click', onPanelClick);
  $('panel-close').addEventListener('click', closePanel);
  $('quest-track').addEventListener('click', () => { togglePanel('quests'); uiDirty = true; });
  for (const b of document.querySelectorAll('[data-open]')) {
    b.addEventListener('click', () => { if (b.dataset.open === 'craft') toggleCraft(); else togglePanel(b.dataset.open); uiDirty = true; });
  }
  $('panel-body').addEventListener('input', onPanelInput);
  for (const b of document.querySelectorAll('#hotbar [data-icon]')) b.insertAdjacentHTML('afterbegin', Icons.ui(b.dataset.icon));
  // Browsers only allow sound after the player interacts with the page.
  const unlock = () => Sound.unlock();
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  Sound.init();
  Render3D.init($('view'));

  log(loaded ? 'Welcome back.' : 'You wake by a campfire in a quiet clearing, with nothing but the clothes on your back.', 'level');
  if (report) openPanel('offline', report);
  else if (!state.seenHelp) { state.seenHelp = true; openPanel('help'); }

  lastSave = Date.now();
  setInterval(update, TICK);
  update();
  Render3D.start();
}

document.addEventListener('DOMContentLoaded', init);
