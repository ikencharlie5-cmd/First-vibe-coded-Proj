// Active combat: stamina, dodge rolls, blocking, weapon specials, and the big monsters' telegraphed attacks.
'use strict';

// Star-seed blessings raise your stamina by 10 each.
const staminaMax = () => 100 + 10 * ((state && state.story.upg && state.story.upg.stamina) || 0);
const DODGE = { cost: 25, time: 0.32, speed: 13, iframes: 450 };
const SPECIAL = { cost: 60, cooldown: 8000 };
const combat = { stamina: 100, dodgeLeft: 0, dodgeX: 0, dodgeY: 0, iframesUntil: 0, blocking: false, specialAt: 0, rolled: 0 };

const invulnerable = now => now < combat.iframesUntil;

// What your weapon's special does, by weapon.
function specialFor() {
  const w = state.equip.weapon;
  if (w === 'frostbane') return { name: 'Frost Nova', radius: 3.5, mult: 1.5, stun: 4000, all: true };
  if (w && ITEMS[w].sword) return { name: 'Whirlwind', radius: 2.3, mult: 1.3, stun: 0, all: true };
  return { name: 'Shove', radius: 2.0, mult: 1.0, stun: 2500, all: false, knock: 2 };
}

function dodge() {
  if (state.sailing || combat.dodgeLeft > 0 || combat.stamina < DODGE.cost || inAnyTown()) return;
  if (state.mounted) return;
  // Roll the way you're steering, or backwards if you're standing still.
  const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
  const r = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  let dx, dy;
  if (f || r) {
    const yaw = state.camYaw;
    dx = -Math.sin(yaw) * f + Math.cos(yaw) * r; dy = -Math.cos(yaw) * f - Math.sin(yaw) * r;
  } else { dx = -Math.sin(state.face); dy = -Math.cos(state.face); }
  const len = Math.hypot(dx, dy);
  combat.dodgeX = dx / len; combat.dodgeY = dy / len;
  combat.dodgeLeft = DODGE.time;
  combat.iframesUntil = Date.now() + DODGE.iframes;
  combat.stamina -= DODGE.cost;
  combat.rolled = Date.now();
  if (action && action.type !== 'combat') action = null;
  Sound.sfx('miss');
}

// Called every frame before normal movement; returns true while a roll is moving you.
function dodgeMove(dt, now) {
  if (combat.dodgeLeft <= 0) return false;
  const step = Math.min(dt, combat.dodgeLeft) * DODGE.speed;
  combat.dodgeLeft -= dt;
  const nx = state.px + combat.dodgeX * step, ny = state.py + combat.dodgeY * step;
  if (!collides(nx, state.py, now)) state.px = nx;
  if (!collides(state.px, ny, now)) state.py = ny;
  moving = true;
  return true;
}

function updateStamina(dt) {
  const regen = combat.blocking ? 4 : combat.dodgeLeft > 0 ? 0 : 24;
  combat.stamina = Math.min(staminaMax(), combat.stamina + regen * dt);
  combat.blocking = (keys.has('q')) && combat.stamina > 1 && !state.sailing && !state.mounted;
}

// How much of a hit gets through your guard. Blocking only works facing the attacker.
function blockFactor(fromX, fromY) {
  if (!combat.blocking) return 1;
  const ax = fromX - state.px, ay = fromY - state.py, d = Math.hypot(ax, ay) || 1;
  if ((ax * Math.sin(state.face) + ay * Math.cos(state.face)) / d < 0.2) return 1;
  combat.stamina = Math.max(0, combat.stamina - 14);
  if (combat.stamina <= 0) { log('Your guard breaks!', 'warn'); return 0.7; }
  return state.equip.shield ? 0.2 : 0.55;
}

function specialAttack() {
  const now = Date.now();
  if (state.sailing || state.mounted || inAnyTown()) return;
  if (now < combat.specialAt) { log(`Your special is ready in ${Math.ceil((combat.specialAt - now) / 1000)}s.`, 'dim'); return; }
  if (combat.stamina < SPECIAL.cost) { log('Not enough stamina for a special attack.', 'dim'); return; }
  const sp = specialFor();
  let targets = monsters.filter(m => m.hp > 0 && Math.hypot(m.x - state.px, m.y - state.py) <= sp.radius);
  if (!sp.all) {
    const t = action && action.type === 'combat' ? targets.find(m => m.id === action.id) : null;
    targets = t ? [t] : targets.sort((a, b) => Math.hypot(a.x - state.px, a.y - state.py) - Math.hypot(b.x - state.px, b.y - state.py)).slice(0, 1);
  }
  if (!targets.length) { log('Nothing in reach.', 'dim'); return; }
  combat.stamina -= SPECIAL.cost;
  combat.specialAt = now + SPECIAL.cooldown;
  const strL = lvl('strength') + 3, eq = equipStats();
  const maxHit = Math.max(1, Math.floor(0.5 + (strL + 8) * (64 + eq.str) / 640));
  for (const m of targets) {
    let dmg = Math.max(1, Math.round(randInt(Math.ceil(maxHit / 2), maxHit) * sp.mult));
    if (m.type === 'wurm' && state.equip.weapon !== 'frostbane') dmg = 1;
    m.hp -= dmg; m.aggro = true;
    if (sp.stun) { m.stunUntil = now + sp.stun; m.tele = null; }
    if (sp.knock) {
      const dx = Math.sign(Math.round(m.x - state.px)), dy = Math.sign(Math.round(m.y - state.py));
      for (let k = 0; k < sp.knock; k++) if (!monsterBlocked(m.x + dx, m.y + dy, now)) { m.x += dx; m.y += dy; }
    }
    FX.damage(m.x, m.y, dmg);
    addXp(state.style, dmg * 4);
    addXp('hitpoints', dmg * 1.33);
    if (m.hp <= 0) killMonster(m);
  }
  FX.special(sp.name, sp.radius);
  Sound.sfx('hit');
  log(`${sp.name}!`, 'good');
  if (!action && targets[0].hp > 0) action = { type: 'combat', id: targets[0].id, next: now + 1200 };
}

// ---------------------------------------------------------------- monster special attacks
// Big monsters wind up a slam, a breath cone or a summoning. A red marker shows where it will land: roll out of it or block.
function monsterSpecial(m, def, now, dist) {
  if (m.tele) {
    if (now < m.tele.end) return true;
    resolveTelegraph(m, def, now);
    m.tele = null;
    return true;
  }
  if (!def.specials || !m.aggro || dist > 7) return false;
  if (!m.nextSpecial) m.nextSpecial = now + 2500 + Math.random() * 2000;
  if (now < m.nextSpecial) return false;
  m.spIdx = m.spIdx == null ? 0 : (m.spIdx + 1) % def.specials.length;
  const sp = def.specials[m.spIdx];
  if (sp.kind !== 'summon' && dist > (sp.kind === 'breath' ? sp.r - 0.5 : sp.r + 1.5)) return false;
  m.tele = { kind: sp.kind, sp, start: now, end: now + sp.wind, x: m.x, y: m.y, dir: Math.atan2(state.px - m.x, state.py - m.y), r: sp.r || 0, arc: sp.arc || 0 };
  m.nextSpecial = now + sp.every;
  if (sp.say) log(sp.say.replace('The %', cap(theMonster(def))).replace('the %', theMonster(def)), 'warn');
  Sound.sfx('growl');
  return true;
}

function resolveTelegraph(m, def, now) {
  const t = m.tele, sp = t.sp;
  if (sp.kind === 'summon') {
    let n = 0;
    for (const [a, b] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2], [-2, -2]]) {
      if (n >= sp.n) break;
      if (monsterBlocked(m.x + a, m.y + b, now)) continue;
      monsters.push({ id: nextMonsterId++, type: sp.type, x: m.x + a, y: m.y + b, hx: m.x + a, hy: m.y + b, hp: MONSTERS[sp.type].hp, aggro: true, nextMove: 0, nextAtk: now + 1500, summoned: true });
      n++;
    }
    log(`${cap(theMonster(def))} raises ${n} ${MONSTERS[sp.type].name.toLowerCase()}s from the ground!`, 'warn');
    return;
  }
  const dx = state.px - t.x, dy = state.py - t.y, d = Math.hypot(dx, dy);
  let hit = d <= t.r + PLAYER_R;
  if (hit && sp.kind === 'breath') {
    const diff = Math.abs(((Math.atan2(dx, dy) - t.dir + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    hit = diff <= t.arc || d < 1;
  }
  FX.telegraph(m, sp.kind);
  Sound.sfx(sp.kind === 'breath' ? 'furnace' : 'treefall');
  if (!hit) return;
  if (invulnerable(now)) { state.stats.dodges = (state.stats.dodges || 0) + 1; FX.gain(state.px, state.py, 'Dodged!', 'good'); return; }
  const raw = randInt(Math.ceil(def.maxHit * 0.6), Math.ceil(def.maxHit * sp.dmg));
  const dmg = Math.max(1, Math.round(raw * (combat.blocking ? 0.5 : 1)));
  if (combat.blocking) combat.stamina = Math.max(0, combat.stamina - 25);
  state.hp -= dmg;
  uiDirty = true;
  FX.damage(state.px, state.py, dmg, true);
  log(`${cap(theMonster(def))}'s ${sp.name} hits you for ${dmg}!`, 'bad');
  if (state.hp <= 0) die(def);
}
