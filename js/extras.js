// Seasons, horses, pets, achievements and the bestiary.
'use strict';

// ---------------------------------------------------------------- seasons
// Three days per season, twelve to a year.
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
const DAYS_PER_SEASON = 3;
const seasonIdx = () => Math.floor(((state ? state.day : 1) - 1) / DAYS_PER_SEASON) % 4;
const seasonName = () => SEASONS[seasonIdx()];
// More rain in autumn, more fog and snow showers in winter, clear summer skies.
const SEASON_WEATHER = [
  [['clear', 0.45], ['cloudy', 0.25], ['rain', 0.2], ['fog', 0.1]],
  [['clear', 0.7], ['cloudy', 0.18], ['rain', 0.08], ['fog', 0.04]],
  [['clear', 0.3], ['cloudy', 0.25], ['rain', 0.3], ['fog', 0.15]],
  [['clear', 0.35], ['cloudy', 0.25], ['rain', 0.22], ['fog', 0.18]],
];
const SEASON_NEWS = [
  'Spring is here. The fields turn green and the first flowers open.',
  'Summer arrives. Long, warm days and clear skies.',
  'Autumn comes. The leaves turn gold and red, and the rains return.',
  'Winter sets in. Food fetches higher prices in every town.',
];

// ---------------------------------------------------------------- horses
function toggleMount() {
  if (state.mounted) { state.mounted = false; log('You climb down from your horse.', 'dim'); return; }
  if (!have('horse')) { log('You need a horse. Ironhold and Frosthollow sell them.', 'dim'); return; }
  if (state.sailing) return;
  if (inDungeonRect(Math.round(state.px), Math.round(state.py))) { log('There is no room for a horse down here.', 'dim'); return; }
  state.mounted = true;
  action = null;
  log('You swing up into the saddle. Shift to gallop.', 'dim');
  Sound.sfx('step');
}
const dismount = why => { if (state.mounted) { state.mounted = false; if (why) log(why, 'dim'); } };

// ---------------------------------------------------------------- pets
const PET_INFO = {
  dog:  { name: 'hound', bite: [1, 3], desc: 'bites at whatever you fight' },
  wolf: { name: 'wolf', bite: [2, 5], desc: 'tears into whatever you fight' },
  cat:  { name: 'cat', bite: null, desc: 'brings you shiny coins it finds' },
};
const petKind = () => (state.pet && have(state.pet) ? ITEMS[state.pet].pet : null);
function togglePet(id) {
  if (state.pet === id) { state.pet = null; log(`You send your ${PET_INFO[ITEMS[id].pet].name} home.`, 'dim'); return; }
  state.pet = id;
  const p = PET_INFO[ITEMS[id].pet];
  log(`Your ${p.name} trots along at your heels. It ${p.desc}.`, 'good');
}
// Called after each of your attacks in a fight.
function petAttack(m) {
  const p = PET_INFO[petKind()];
  if (!p || !p.bite || m.hp <= 0 || Math.random() > 0.6) return;
  const dmg = randInt(p.bite[0], p.bite[1]);
  m.hp -= dmg;
  FX.damage(m.x + 0.3, m.y, dmg);
  if (m.hp <= 0) killMonster(m);
}
let catTimer = 0;
function petTick(dt) {
  if (petKind() !== 'cat') return;
  catTimer += dt;
  if (catTimer < 150) return;
  catTimer = 0;
  const g = randInt(5, 25);
  state.gold += g;
  log(`Your cat drops a shiny coin at your feet. +${g} gold.`, 'gold');
}

// ---------------------------------------------------------------- achievements
const builtCount = () => state.structs.filter(s => s.level && !STRUCTS[s.type].wall).length;
const killed = type => (state.bestiary[type] || 0) > 0;
const ACHIEVEMENTS = [
  { id: 'tools',    name: 'Stone Age',        desc: 'Craft a stone axe.',                          check: () => have('stone_axe') || lvl('woodcutting') > 1 },
  { id: 'settler',  name: 'Settler',          desc: 'Build your first building.',                  check: () => builtCount() >= 2 },
  { id: 'builder',  name: 'Builder',          desc: 'Have 10 finished buildings.',                 check: () => builtCount() >= 10 },
  { id: 'walls',    name: 'Behind the Walls', desc: 'Raise 20 sections of wall.',                  check: () => state.structs.filter(s => STRUCTS[s.type].wall).length >= 20 },
  { id: 'founder',  name: 'Founder',          desc: 'Found your own town.',                        check: () => !!state.myTown },
  { id: 'employer', name: 'Employer',         desc: 'Have 10 workers and guards at once.',         check: () => staffCount() >= 10 },
  { id: 'lumber',   name: 'Lumberjack',       desc: 'Reach Woodcutting 20.',                       check: () => lvl('woodcutting') >= 20 },
  { id: 'miner',    name: 'Deep Delver',      desc: 'Reach Mining 20.',                            check: () => lvl('mining') >= 20 },
  { id: 'angler',   name: 'Angler',           desc: 'Reach Fishing 20.',                           check: () => lvl('fishing') >= 20 },
  { id: 'smith',    name: 'Master Smith',     desc: 'Reach Smithing 30.',                          check: () => lvl('smithing') >= 30 },
  { id: 'chef',     name: 'Head Chef',        desc: 'Reach Cooking 25.',                           check: () => lvl('cooking') >= 25 },
  { id: 'hunter',   name: 'Monster Hunter',   desc: 'Defeat 50 monsters.',                         check: () => state.stats.kills >= 50 },
  { id: 'slayer',   name: 'Slayer',           desc: 'Defeat 300 monsters.',                        check: () => state.stats.kills >= 300 },
  { id: 'drake',    name: 'Drakeslayer',      desc: 'Defeat the Frost Drake.',                     check: () => killed('drake') },
  { id: 'crypt',    name: 'Crypt Breaker',    desc: 'Defeat the Crypt Lord.',                      check: () => killed('cryptlord') },
  { id: 'wurm',     name: 'Wurmbane',         desc: 'Defeat the Frost Wurm.',                      check: () => killed('wurm') },
  { id: 'king',     name: 'Kingslayer',       desc: 'Defeat the Bandit King.',                     check: () => killed('banditking') },
  { id: 'dodge',    name: 'Untouchable',      desc: 'Dodge 25 attacks.',                           check: () => (state.stats.dodges || 0) >= 25 },
  { id: 'explorer', name: 'Explorer',         desc: 'Visit all eight towns.',                      check: () => Object.keys(TOWN_DEFS).every(id => state.discovered[id]) },
  { id: 'mapper',   name: 'Cartographer',     desc: 'Discover 20 places of interest.',             check: () => Object.keys(state.pois).length >= 20 },
  { id: 'summit',   name: 'Top of the World', desc: 'Stand on the summit of Mount Skyhorn.',       check: () => !!state.pois.summit },
  { id: 'merchant', name: 'Merchant',         desc: 'Earn 10,000 gold from trade.',                check: () => state.stats.earned >= 10000 },
  { id: 'tycoon',   name: 'Tycoon',           desc: 'Earn 100,000 gold from trade.',               check: () => state.stats.earned >= 100000 },
  { id: 'caravan',  name: 'Trade Baron',      desc: 'Complete 10 caravan trips.',                  check: () => (state.stats.caravans || 0) >= 10 },
  { id: 'sailor',   name: 'Sailor',           desc: 'Set sail in your own boat.',                  check: () => !!state.stats.sailed },
  { id: 'rider',    name: 'Rider',            desc: 'Ride your own horse.',                        check: () => !!state.mounted },
  { id: 'friend',   name: 'Best Friend',      desc: 'Take a pet on your travels.',                 check: () => !!petKind() },
  { id: 'spring',   name: 'The Long Winter',  desc: 'End the Long Winter.',                        check: () => !!state.story.done },
  { id: 'seeds',    name: 'Seed Seeker',      desc: 'Find 10 star seeds.',                         check: () => Object.keys(state.story.seeds || {}).length >= 10 },
  { id: 'allseeds', name: 'Starry-Eyed',      desc: 'Find every star seed.',                       check: () => Object.keys(state.story.seeds || {}).length >= starSeeds.length },
  { id: 'digger',   name: 'Treasure Hunter',  desc: 'Dig up 5 buried treasures.',                  check: () => Object.keys(state.story.dug || {}).length >= 5 },
  { id: 'runes',    name: 'Stone Whisperer',  desc: 'Solve every stone circle\'s riddle.',          check: () => Object.keys(state.story.solved || {}).length >= Object.keys(RIDDLES).length },
  { id: 'helper',   name: 'Helping Hand',     desc: 'Complete 10 notice-board quests.',            check: () => (state.story.questsDone || 0) >= 10 },
  { id: 'year',     name: 'A Year Goes By',   desc: 'See all four seasons.',                       check: () => state.day > DAYS_PER_SEASON * 3 },
];

function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (state.ach[a.id] || !a.check()) continue;
    state.ach[a.id] = state.day;
    toast(`Achievement: ${a.name}`, 'gold');
    log(a.desc, 'level');
    Sound.sfx('levelup');
  }
}

// ---------------------------------------------------------------- bestiary
const WHERE = {
  goblin: 'The Meadowlands', wolf: 'Meadows and forests', bandit: 'The Badlands', ogre: 'The Frost Highlands',
  drake: 'The summit of Mount Skyhorn', lurker: 'Blackmire Marsh', scorpion: 'The Amber Wastes', bear: 'The Frostpine Taiga',
  pirate: 'The Corsair Isles', skeleton: 'The Sunken Crypt', cryptlord: 'The heart of the Sunken Crypt', troll: 'Frostdeep Cavern',
  wurm: 'The heart of Frostdeep Cavern', banditking: 'The Red Stones',
};
function recordKill(type) { state.bestiary[type] = (state.bestiary[type] || 0) + 1; state.seen[type] = 1; }

function recordsHtml() {
  const got = ACHIEVEMENTS.filter(a => state.ach[a.id]).length;
  let html = `<h3>Achievements: ${got} / ${ACHIEVEMENTS.length}</h3><div class="ach-grid">`;
  for (const a of ACHIEVEMENTS) {
    const day = state.ach[a.id];
    html += `<div class="ach${day ? ' got' : ''}"><b>${esc(a.name)}</b><span class="small">${esc(a.desc)}</span>${day ? `<span class="small dim">Day ${day}</span>` : ''}</div>`;
  }
  html += '</div><h3>Bestiary</h3><table class="list bestiary">';
  for (const type in MONSTERS) {
    const d = MONSTERS[type], n = state.bestiary[type] || 0;
    if (!state.seen[type]) { html += `<tr><td class="dim">??? <span class="small">(${esc(WHERE[type] || 'somewhere out there')})</span></td><td></td></tr>`; continue; }
    const drops = d.drops.map(([id, p]) => `${esc(itemName(id))} <span class="dim">${p >= 1 ? 'always' : `1 in ${Math.round(1 / p)}`}</span>`).join(', ');
    html += `<tr><td><b>${esc(d.name)}</b> <span class="small dim">lvl ${d.level}, ${d.hp} HP${d.boss ? ', boss' : ''}</span><br>
      <span class="small">${esc(WHERE[type] || '')}${d.specials ? `. Watch for its ${d.specials.map(s => s.name).join(' and ')}` : ''}.</span><br>
      <span class="small">Drops: ${drops || 'nothing'}</span></td><td class="small">${n} defeated</td></tr>`;
  }
  return ['Records', html + '</table>'];
}

// ---------------------------------------------------------------- tick
let lastSeason = -1, extrasTimer = 0;
function extrasTick(dt) {
  petTick(dt);
  extrasTimer += dt;
  if (extrasTimer < 1) return;
  extrasTimer = 0;
  const s = seasonIdx();
  if (lastSeason !== -1 && s !== lastSeason) { log(SEASON_NEWS[s], 'level'); toast(seasonName(), 'level'); }
  lastSeason = s;
  for (const m of monsters) if (m.aggro && !state.seen[m.type]) state.seen[m.type] = 1;
  if (state.mounted && !have('horse')) state.mounted = false;
  if (state.pet && !have(state.pet)) state.pet = null;
  checkAchievements();
}
