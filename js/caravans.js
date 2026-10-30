// Trade caravans sent from your Trading Post, and the town you can found around a Town Hall.
'use strict';

// ---------------------------------------------------------------- routes
// Wagons follow the roads where they can: cheapest path where road tiles cost 1 and open ground 3.
const routeCache = new Map();
function caravanRoute(post, town) {
  const key = `${post.id}:${town}`;
  if (routeCache.has(key)) return routeCache.get(key);
  const size = structSize(post);
  const goal = TOWN_DEFS[town].arrive, gi = idx(goal.x, goal.y);
  const dist = new Uint32Array(W * H).fill(0xffffffff), from = new Int32Array(W * H).fill(-1);
  const buckets = [[]];
  // Start from every open tile around the post's footprint.
  for (let y = post.y - 1; y <= post.y + size; y++) for (let x = post.x - 1; x <= post.x + size; x++) {
    if (!walkableTerrain(x, y)) continue;
    const i = idx(x, y);
    dist[i] = 0; buckets[0].push(i);
  }
  let found = false;
  for (let d = 0; d < buckets.length && !found; d++) {
    const b = buckets[d];
    if (!b) continue;
    for (let k = 0; k < b.length; k++) {
      const i = b[k];
      if (dist[i] !== d) continue;
      if (i === gi) { found = true; break; }
      const x = i % W, y = (i - x) / W;
      for (const [a, bb] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + a, ny = y + bb;
        if (!walkableTerrain(nx, ny)) continue;
        const ni = idx(nx, ny), t = terrain[ni];
        const nd = d + (t === T.ROAD || t === T.BRIDGE || t === T.FLOOR ? 1 : 3);
        if (nd >= dist[ni]) continue;
        dist[ni] = nd; from[ni] = i;
        (buckets[nd] = buckets[nd] || []).push(ni);
      }
    }
  }
  let route = null;
  if (found) {
    const tiles = [];
    for (let i = gi; i !== -1; i = from[i]) tiles.push(i);
    tiles.reverse();
    // Keep every third tile; the renderer smooths between them.
    route = { pts: tiles.filter((_, k) => k % 3 === 0 || k === tiles.length - 1).map(i => [i % W, Math.floor(i / W)]), len: tiles.length };
  }
  routeCache.set(key, route);
  return route;
}
// Where along its route a caravan is, 0 = at the post, 1 = in town.
function routePoint(route, f) {
  const p = route.pts, u = clamp(f, 0, 1) * (p.length - 1), k = Math.min(p.length - 2, Math.floor(u)), r = u - k;
  if (p.length < 2) return { x: p[0][0], y: p[0][1], dx: 0, dy: 1 };
  const [x0, y0] = p[k], [x1, y1] = p[k + 1];
  return { x: x0 + (x1 - x0) * r, y: y0 + (y1 - y0) * r, dx: x1 - x0, dy: y1 - y0 };
}

// ---------------------------------------------------------------- caravans
const tradeTowns = () => Object.keys(TOWN_DEFS).filter(id => state.discovered[id]);
const postCaravans = post => state.caravans.filter(c => c.post === post.id);

// Each Trading Post runs one wagon per level.
function ensureCaravans() {
  state.caravans = state.caravans.filter(c => { const p = structById(c.post); return p && p.level; });
  for (const s of state.structs) {
    const def = structDef(s);
    if (!def.caravans || !s.level) continue;
    const want = def.caravans[s.level - 1];
    while (postCaravans(s).length < want) {
      state.caravans.push({ id: state.nextStructId++, post: s.id, town: tradeTowns().find(t => t !== 'ratsnest') || 'ironhold', cargo: null, buy: null,
        guards: 0, repeat: false, phase: 'idle', t: 0, dur: 0, load: {}, gold: 0, note: '' });
    }
  }
}

function ambushChance(c, route) {
  if (state.story.choice === 'paid') return 0;
  let p = (0.05 + route.len / 4000 + state.threat / 400) * (1 - 0.22 * c.guards);
  if (state.story.choice === 'slain') p *= 0.4;
  return clamp(p, 0, 0.6);
}

function sendCaravan(c, report) {
  const post = structById(c.post);
  if (!post || !post.level || c.phase !== 'idle') return false;
  if (!c.cargo) { c.note = 'Choose something to sell first.'; return false; }
  const route = caravanRoute(post, c.town);
  if (!route) { c.note = `No road reaches ${TOWNS[c.town].name} from here.`; return false; }
  const n = Math.min(EMPIRE.caravanLoad, state.store[c.cargo] || 0);
  if (n <= 0) { c.note = `No ${itemName(c.cargo).toLowerCase()} in the storehouse.`; return false; }
  const fee = c.guards * EMPIRE.caravanGuardFee;
  if (state.gold < fee) { c.note = `The guards want ${fee} gold up front.`; return false; }
  state.gold -= fee;
  takeStore(c.cargo, n);
  c.load = { [c.cargo]: n };
  c.gold = 0;
  c.phase = 'out'; c.t = 0; c.dur = route.len / EMPIRE.caravanSpeed;
  c.note = '';
  if (!report) { log(`A caravan sets off for ${TOWNS[c.town].name} with ${n} ${itemName(c.cargo).toLowerCase()}.`, 'good'); Sound.sfx('coins'); }
  return true;
}

function simCaravans(dt, report) {
  for (const c of state.caravans) {
    const post = structById(c.post);
    if (!post) continue;
    if (c.phase === 'idle') {
      // Repeating caravans set off again as soon as there are goods to carry.
      if (c.repeat) { c.wait = (c.wait || 0) - dt; if (c.wait <= 0) { c.wait = 10; sendCaravan(c, report); } }
      continue;
    }
    const route = caravanRoute(post, c.town);
    if (!route) { c.phase = 'idle'; continue; }
    c.t += dt / c.dur;
    if (c.t < 1) continue;
    const town = TOWNS[c.town].name;
    if (c.phase === 'out') {
      if (Math.random() < ambushChance(c, route)) {
        logOrReport(report, `Bandits ambushed your caravan on the road to ${town} and took the goods!`, 'bad');
        c.load = {}; c.gold = 0;
      } else {
        for (const id in c.load) {
          for (let k = 0; k < c.load[id]; k++) { c.gold += sellPrice(c.town, id); state.markets[c.town].supply[id] += 1; }
        }
        c.load = {};
        if (c.buy) {
          const price = buyPrice(c.town, c.buy), n = Math.min(EMPIRE.caravanLoad, Math.floor(c.gold / price));
          if (n > 0) { c.gold -= n * price; c.load = { [c.buy]: n }; }
        }
      }
      c.phase = 'back'; c.t = 0;
    } else {
      const got = [];
      if (c.gold > 0) { state.gold += c.gold; state.stats.earned += c.gold; got.push(`${fmt(c.gold)} gold`); }
      for (const id in c.load) {
        const n = Math.min(c.load[id], Math.max(0, storeCap() - storeUsed()));
        if (n > 0) { addStore(id, n); got.push(`${n} ${itemName(id).toLowerCase()}`); if (report) report.produced[id] = (report.produced[id] || 0) + n; }
      }
      logOrReport(report, `Your caravan is back from ${town}${got.length ? ` with ${got.join(' and ')}` : ', empty-handed'}.`, got.length ? 'gold' : 'dim');
      c.load = {}; c.gold = 0;
      c.phase = 'idle'; c.t = 0; c.wait = 0;
    }
  }
}

function caravanAction(post, arg) {
  const [k, field] = arg.split(':');
  const c = postCaravans(post)[+k];
  if (!c) return;
  const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
  if (field === 'send') { if (!sendCaravan(c, null) && c.note) log(c.note, 'warn'); }
  else if (c.phase !== 'idle' && field !== 'repeat') log('Wait until the caravan is home to change its orders.', 'warn');
  else if (field === 'town') c.town = cycle(tradeTowns(), c.town);
  else if (field === 'cargo') {
    const goods = Object.keys(state.store).filter(id => !ITEMS[id].quest).sort((a, b) => itemName(a).localeCompare(itemName(b)));
    c.cargo = goods.length ? cycle(goods, c.cargo) : null;
  } else if (field === 'buy') c.buy = cycle([null, ...TOWNS[c.town].sells], c.buy);
  else if (field === 'more') c.guards = Math.min(3, c.guards + 1);
  else if (field === 'less') c.guards = Math.max(0, c.guards - 1);
  if (field === 'repeat') c.repeat = !c.repeat;
  if (field === 'town' && c.buy && !TOWNS[c.town].sells.includes(c.buy)) c.buy = null;
}

function caravanHtml(post) {
  ensureCaravans();
  let html = `<h3>Caravans</h3><p class="small dim">Each wagon carries up to ${EMPIRE.caravanLoad} goods from your storehouse, sells them at the market price,
    and can spend the takings on goods to bring home. Guards cost ${EMPIRE.caravanGuardFee}g a trip each and make ambushes much less likely.</p>`;
  postCaravans(post).forEach((c, k) => {
    const route = caravanRoute(post, c.town);
    const status = c.phase === 'idle' ? '<span class="dim">Waiting at the post</span>'
      : `${c.phase === 'out' ? `On the road to ${TOWNS[c.town].name}` : `Heading home from ${TOWNS[c.town].name}`} (${Math.floor(c.t * 100)}%)`;
    const est = c.cargo ? Math.min(EMPIRE.caravanLoad, state.store[c.cargo] || 0) * sellPrice(c.town, c.cargo) : 0;
    const a = f => `data-sact="cv" data-arg="${k}:${f}"`;
    html += `<div class="caravan"><p><b>Wagon ${k + 1}</b>: ${status}</p>
      <p class="small">To <b>${TOWNS[c.town].name}</b> <button ${a('town')}>Change</button>
        ${route ? `<span class="dim">about ${Math.round(route.len / EMPIRE.caravanSpeed * 2 / 60)} min there and back, ${Math.round(ambushChance(c, route) * 100)}% ambush risk</span>` : '<span class="bad">no road</span>'}</p>
      <p class="small">Sells <b>${c.cargo ? `${ico(c.cargo)} ${esc(itemName(c.cargo))}` : 'nothing'}</b> <button ${a('cargo')}>Change</button>
        ${c.cargo ? `<span class="dim">${fmt(state.store[c.cargo] || 0)} in store, worth about ${fmt(est)}g there</span>` : ''}</p>
      <p class="small">Brings back <b>${c.buy ? `${ico(c.buy)} ${esc(itemName(c.buy))}` : 'gold only'}</b> <button ${a('buy')}>Change</button></p>
      <p class="small">Guards: <b>${c.guards}</b> <button ${a('less')}>-</button><button ${a('more')}>+</button></p>
      <p><button ${a('send')} ${c.phase === 'idle' ? '' : 'disabled'}>Send now</button> <button ${a('repeat')}>${c.repeat ? 'Repeating: on' : 'Repeating: off'}</button></p>
      ${c.note ? `<p class="small warn">${esc(c.note)}</p>` : ''}</div>`;
  });
  return html;
}

// ---------------------------------------------------------------- your own town
const townHall = () => state.myTown && structById(state.myTown.hall);
function townXY(id) {
  if (id === 'mytown') { const h = townHall(); const c = h ? structCenter(h) : { x: HOMESTEAD.x, y: HOMESTEAD.y }; return { x: c.x, y: c.y, arrive: { x: Math.round(c.x), y: Math.round(c.y) + 3 } }; }
  return TOWN_DEFS[id];
}
function myTownAt(x, y) {
  const h = townHall();
  if (!h) return false;
  const c = structCenter(h);
  return Math.hypot(c.x - x, c.y - y) < 20;
}
// Your town trades like any other once it has a name.
function defineMyTown() {
  if (!state.myTown) { delete TOWNS.mytown; return; }
  TOWNS.mytown = { name: state.myTown.name, kind: 'yours', desc: 'Your own town. Its market pays a fair price for anything, and your townsfolk pay taxes.',
    buy: { default: 0.95, quest: 0 }, markup: 1.25, sells: ['pine_plank', 'oak_plank', 'iron_bar', 'trout', 'fishing_rod'] };
  state.discovered.mytown = true;
}
function charterProblem() {
  const def = STRUCTS.town_hall;
  const folk = staffCount(), built = state.structs.filter(s => s.level && !STRUCTS[s.type].wall).length;
  if (folk < def.charter.folk) return `Needs ${def.charter.folk} townsfolk (you have ${folk})`;
  if (built < def.charter.buildings) return `Needs ${def.charter.buildings} finished buildings (you have ${built})`;
  return null;
}
function foundTown(name) {
  const h = state.structs.find(s => s.type === 'town_hall' && s.level);
  if (!h || state.myTown) return;
  name = (name || '').trim().replace(/[<>]/g, '').slice(0, 24) || 'Newhold';
  state.myTown = { name, hall: h.id, day: state.day };
  defineMyTown();
  marketInit();
  closePanel();
  log(`The charter is signed: ${name} is now a town! Settlers will move in, traders will come, and your townsfolk will pay taxes.`, 'level');
  toast(`${name} is founded!`, 'level');
  Sound.sfx('levelup');
}
const taxPerMin = () => (townHall() && townHall().level ? EMPIRE.taxPerFolk * staffCount() * (1 + 0.25 * (townHall().level - 1)) : 0);
function simTown(dt, report) {
  const tax = taxPerMin() * dt / 60;
  if (tax <= 0) return;
  state.gold += tax;
  if (report) report.taxes = (report.taxes || 0) + tax;
}
function charterHtml() {
  return ['Found your town', `<p>Your Town Hall stands finished. All it needs now is a name, and a charter with the royal seal.</p>
    <p><input id="town-name" class="name-input" maxlength="24" value="Newhold" aria-label="Town name"></p>
    <p><button data-found="1" class="big">Sign the charter</button></p>`];
}
function hallHtml(s) {
  if (!state.myTown) return '<p><button data-sact="charter" class="big">Name your town</button></p>';
  return `<p>The town of <b>${esc(state.myTown.name)}</b>, founded on day ${state.myTown.day}. ${staffCount()} townsfolk pay
    <b class="gold">${taxPerMin().toFixed(1)}g a minute</b> in taxes.</p>
    <p><button data-sact="hallmarket">Town market</button> <button data-sact="hallcarriage">Carriage</button></p>`;
}
