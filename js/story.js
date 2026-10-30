// Quests and secrets. The Long Winter is there to be found, not forced on you: talk to the right people,
// stumble on a relic, or ignore it entirely. Notice boards in every town offer work, and the world hides
// star seeds, buried treasure and rune riddles for anyone who goes looking.
'use strict';

// How far south the snow reaches (tile row) at each stage of the winter. After the thaw (-1) it pulls back to the taiga.
const WINTER_LINE = [70, 125, 190, 248];
const winterLevel = () => (state && state.story ? state.story.winter : 0);
const winterLine = () => (winterLevel() < 0 ? 64 : WINTER_LINE[winterLevel()]);
// In deep winter lakes and rivers in the snow freeze into walkable ice. The open sea never freezes.
function iceAt(x, y) {
  if (winterLevel() < 2 || x < 0 || y < 0 || x >= W || y >= H) return false;
  return terrain[idx(x, y)] === T.WATER && y < winterLine() - 10 && y < coastY(x) - 8;
}

const NPC_NAMES = { herald: 'the Royal Herald', elder: 'Elder Ysolde', king: 'Varn, the Bandit King' };
const RELICS = ['ember_core', 'sun_sigil', 'star_shard'];
const FOOD_NEEDED = 15;
const TRIBUTE = 400;
const RUNES = ['Sun', 'Moon', 'Star', 'Wave'];
const RUNE_GLYPHS = { Sun: '☀', Moon: '☾', Star: '★', Wave: '≈' };

// Work posted on each town's notice board.
const QUESTS = [
  { id: 'wolves',    town: 'ironhold',    title: 'Wolves at the Gate', kind: 'kill', target: 'wolf', n: 8, gold: 250, items: { leather_pack: 1 },
    text: 'Wolves have been taking sheep outside the walls. Thin the pack: 8 wolves.' },
  { id: 'supplies',  town: 'ironhold',    title: 'Timber for the Keep', kind: 'deliver', target: 'oak_plank', n: 30, gold: 450, items: { iron_helm: 1 },
    text: 'The keep\'s roof needs mending. Deliver 30 oak planks to this board.' },
  { id: 'ogres',     town: 'stonedeep',   title: 'Ogre Trouble', kind: 'kill', target: 'ogre', n: 5, gold: 700, items: { steel_platebody: 1 },
    text: 'Ogres keep raiding the high mine road. Bring down 5 of them.' },
  { id: 'miners',    town: 'stonedeep',   title: 'Hungry Miners', kind: 'deliver', target: 'trout', n: 20, gold: 350, items: {},
    text: 'The night shift is starving. Deliver 20 cooked trout.' },
  { id: 'pirates',   town: 'saltmere',    title: 'Pirate Plunder', kind: 'kill', target: 'pirate', n: 6, gold: 650, items: { doubloon: 3 },
    text: 'Corsairs on the southern isles are robbing our boats. Deal with 6 of them.' },
  { id: 'seashrine', town: 'saltmere',    title: 'The Lost Shrine', kind: 'visit', target: 'seashrine', n: 1, gold: 300, items: { pet_cat: 1 },
    text: 'Our grandmothers prayed at a shrine out on the isles. Find the Sea Shrine.' },
  { id: 'goblins',   town: 'thornwood',   title: 'Goblin Pests', kind: 'kill', target: 'goblin', n: 10, gold: 150, items: { satchel: 1 },
    text: 'Goblins keep stealing our traps. Chase off 10 of them.' },
  { id: 'ironwood',  town: 'thornwood',   title: 'An Ironwood Order', kind: 'deliver', target: 'ironwood_log', n: 15, gold: 600, items: {},
    text: 'A shipwright in Saltmere wants ironwood. Deliver 15 ironwood logs.' },
  { id: 'signets',   town: 'ratsnest',    title: 'No Questions Asked', kind: 'deliver', target: 'bandit_signet', n: 4, gold: 700, items: {},
    text: 'Someone is buying bandit signets. Bring 4. Don\'t ask why.' },
  { id: 'stingers',  town: 'ratsnest',    title: 'Venom Wanted', kind: 'deliver', target: 'scorpion_stinger', n: 6, gold: 550, items: {},
    text: 'The apothecary needs scorpion stingers from the Amber Wastes. Bring 6.' },
  { id: 'lurkers',   town: 'gloomwater',  title: 'Lurkers in the Reeds', kind: 'kill', target: 'lurker', n: 6, gold: 500, items: { lurker_hide: 2 },
    text: 'Bog lurkers dragged off a fisherman. Kill 6 of them.' },
  { id: 'chapel',    town: 'gloomwater',  title: 'The Drowned Chapel', kind: 'visit', target: 'drowned', n: 1, gold: 300, items: { rough_gem: 2 },
    text: 'A chapel sank into the marsh long ago. Find it and tell us it\'s still there.' },
  { id: 'temple',    town: 'amberreach',  title: 'Sands of Time', kind: 'visit', target: 'buriedtemple', n: 1, gold: 350, items: { gold_bar: 2 },
    text: 'The sands shifted and uncovered an old temple to the north-east. Go and see.' },
  { id: 'goldrush',  town: 'amberreach',  title: 'Gold Rush', kind: 'deliver', target: 'gold_ore', n: 15, gold: 900, items: {},
    text: 'The mint is short of ore. Deliver 15 gold ore.' },
  { id: 'bears',     town: 'frosthollow', title: 'Bear Hunt', kind: 'kill', target: 'bear', n: 5, gold: 650, items: { bear_pelt: 2 },
    text: 'Snow bears are breaking into our stores. Hunt 5 of them.' },
  { id: 'firewood',  town: 'frosthollow', title: 'Firewood', kind: 'deliver', target: 'frostwood_log', n: 30, gold: 500, items: {},
    text: 'The hearth must not go out. Deliver 30 frostwood logs.' },
];
const RUMOURS = {
  ironhold:    ['The Royal Herald is looking for someone brave enough to go north.', 'Glowing star seeds turn up in high and lonely places. They say five of them, offered at a shrine, bring a blessing.'],
  stonedeep:   ['A Frost Drake nests on the summit of Mount Skyhorn. Something glitters in its hoard.', 'Old stone cairns mark buried treasure. Bring a pickaxe.'],
  saltmere:    ['Rope bridges run out to the Corsair Isles. Mind the gaps.', 'Pirates bury their loot under cairns of stones.'],
  thornwood:   ['The standing stones answer anyone who can read the riddles on their altars.', 'Deep in the forest the old ones planted ironwood.'],
  ratsnest:    ['The King of Rat\'s Nest takes a cut of everything.', 'There\'s a crypt under the western marsh. Whatever rules it isn\'t alive.'],
  gloomwater:  ['The Sunken Crypt lies south of here, under a mound of stones. Its lord wears an ember around its neck.', 'The bog stones hum on still nights.'],
  amberreach:  ['They say a sigil of trapped sunlight lies in the Buried Temple.', 'The Sun Circle\'s riddle has stumped scholars for a hundred years.'],
  frosthollow: ['Elder Ysolde knows why the winters grow longer.', 'Frostdeep Cavern is east of here. The Wurm sleeps in its deepest room.'],
};
// Each stone circle's riddle and the runes that answer it.
const RIDDLES = {
  whispering: { E: 'Sun', W: 'Moon', N: 'Star', S: 'Wave', text: 'Where the day is born, the sun. Where it dies, the moon. The star keeps the north, and the wave sleeps in the south.' },
  redstones:  { E: 'Moon', W: 'Sun', N: 'Wave', S: 'Star', text: 'The moon climbs the eastern hills while the sun sinks west. Waves break to the north; a star burns in the south.' },
  bogstones:  { E: 'Wave', W: 'Star', N: 'Sun', S: 'Moon', text: 'The tide comes from the east, a star falls in the west, the sun stands high in the north and the moon rests south.' },
  suncircle:  { E: 'Star', W: 'Wave', N: 'Moon', S: 'Sun', text: 'Dawn star east, evening sea west. The moon watches north. The sun, as ever, rules the south.' },
};

const Story = (() => {
  const S = () => state.story;
  const foodCount = () => Object.keys(state.inv).filter(id => ITEMS[id].heal).reduce((a, id) => a + have(id), 0);
  const poiAt = id => pois.find(p => p.id === id);
  const hasRelic = id => have(id) || S().forgeLit;
  const quest = id => S().quests[id];
  const active = id => quest(id) && quest(id).status === 'active';

  // Older saves followed a fixed path; turn their step into the new flags.
  function init() {
    const s = S();
    for (const k of ['quests', 'seeds', 'dug', 'runes', 'solved', 'upg']) s[k] = s[k] || {};
    s.upg.stamina = s.upg.stamina || 0; s.upg.pack = s.upg.pack || 0;
    if (s.step) {
      if (s.step >= 2) { s.started = true; s.metHerald = true; }
      if (s.step >= 3) s.metElder = true;
      if (s.step >= 4) s.fed = true;
      if (s.step >= 7) s.done = true;
      if (s.step >= 8) s.thanked = true;
      s.step = 0;
    }
    if (s.started && !s.quests.main) s.quests.main = { status: s.done ? 'done' : 'active' };
    if (s.side > 0 && !s.quests.king) s.quests.king = { status: s.side === 3 ? 'done' : 'active' };
  }

  function journal(text) { S().journal.push({ day: state.day, text }); }
  function setWinter(level, message) {
    if (S().winter === level) return;
    S().winter = level;
    if (message) { toast(level < 0 ? 'Spring returns' : 'The winter deepens', level < 0 ? 'level' : 'warn'); log(message, 'level'); }
    if (typeof Render3D !== 'undefined' && Render3D.setWinter) Render3D.setWinter();
    if (typeof buildMapImage === 'function') buildMapImage();
  }
  // A new quest pops up, but you decide whether to follow it.
  function begin(id, title, note) {
    const s = S();
    if (s.quests[id]) return;
    s.quests[id] = { status: 'active', n: 0 };
    if (note) journal(note);
    toast(`New quest: ${title}`, 'level');
    log(s.tracked ? 'Press J to see it in your quest log.' : 'Press J to track it.', 'level');
    Sound.sfx('discover');
    uiDirty = true;
  }
  function startMain(note) {
    const s = S();
    if (s.started) return;
    s.started = true;
    begin('main', 'The Long Winter', note);
  }

  // ------------------------------------------------------------ the Long Winter, in any order
  function mainSteps() {
    const s = S();
    return [
      { text: 'Speak to Elder Ysolde in Frosthollow, in the far north.', done: !!s.metElder, at: () => TOWN_DEFS.frosthollow },
      { text: `Optional: bring ${FOOD_NEEDED} meals to Frosthollow.`, done: !!s.fed, optional: true, at: () => TOWN_DEFS.frosthollow, progress: () => `${Math.min(foodCount(), FOOD_NEEDED)}/${FOOD_NEEDED} food` },
      { text: 'Recover the Ember Core from the Crypt Lord, deep in the Sunken Crypt (Blackmire Marsh).', done: hasRelic('ember_core'), at: () => poiAt('crypt') },
      { text: 'Recover the Sun Sigil from the Buried Temple in the Amber Wastes.', done: hasRelic('sun_sigil'), at: () => poiAt('buriedtemple') },
      { text: 'Recover the Star-anvil Shard from the Frost Drake on the summit of Mount Skyhorn.', done: hasRelic('star_shard'), at: () => ({ x: PEAK.x, y: PEAK.y }) },
      { text: 'Forge Frostbane at the Firstforge, south of Mount Skyhorn: bring all three relics and 5 steel bars.', done: !!s.forgeLit, at: () => poiAt('firstforge'), progress: () => `${Math.min(have('steel_bar'), 5)}/5 steel` },
      { text: 'Slay the Frost Wurm in the deepest room of Frostdeep Cavern (in the taiga). Frostbane cuts its hide; anything else barely scratches it.', done: !!s.done, at: () => poiAt('cavern') },
    ];
  }
  // The next thing to do: the nearest unfinished step that isn't optional.
  function nextMainStep() {
    const steps = mainSteps().filter(st => !st.done);
    if (!steps.length) return null;
    const required = steps.filter(st => !st.optional);
    const pool = required.length ? required : steps;
    if (!pool[0].text.startsWith('Recover')) return pool[0];
    // With several relics left, point at the closest one.
    const dist = st => { const p = st.at(); return p ? Math.hypot(p.x - state.px, p.y - state.py) : Infinity; };
    return pool.filter(st => st.text.startsWith('Recover')).sort((a, b) => dist(a) - dist(b))[0];
  }

  // ------------------------------------------------------------ talking
  function talk(npc) {
    const s = S(), lines = [], options = [];
    const say = t => lines.push(t);
    if (npc === 'herald') {
      if (!s.started) {
        say('"You there, settler. You look like someone who can handle themselves."');
        say('"Frosthollow, our northernmost town, has gone silent. No carts, no letters, and every winter lasts longer than the last. The crown would be grateful if someone went north to find Elder Ysolde."');
        options.push({ label: 'I\'ll look into it.', act: 'herald_go' });
        options.push({ label: 'Not right now.', act: 'none_close' });
      } else if (!s.done) say(`"Any news from the north? ${s.winter >= 3 ? 'Snow in Ironhold. In living memory, never.' : 'It grows colder by the week.'} Take your time, but don't take forever."`);
      else say('"The thaw! The whole capital is talking about you. Long may the spring last."');
    } else if (npc === 'elder') {
      if (!s.metElder) {
        say('An old woman wrapped in furs looks up from the fire. "So someone finally came. Sit. Warm yourself."');
        say('"Something stirs beneath the ice, deep in Frostdeep Cavern to the east: a Frost Wurm, older than this town. Every winter it wakes a little more, and this winter may never end."');
        say('"Only a blade from the Firstforge can cut its hide. The Firstsmiths left three relics to wake that forge: the Ember Core, the Sun Sigil and the Star-anvil Shard. Find them, in whatever order the road allows."');
        options.push({ label: 'I\'ll find them.', act: 'elder_meet' });
      } else if (s.done && !s.thanked) {
        say('Meltwater drips from the eaves. Elder Ysolde is laughing. "Listen! The ice is singing as it breaks. You did it."');
        options.push({ label: 'It\'s over.', act: 'elder_end' });
      } else if (s.done) say('"Spring in Frosthollow. The children have never seen flowers before. Thank you, settler."');
      else {
        const left = RELICS.filter(id => !hasRelic(id)).map(itemName);
        say(s.forgeLit ? '"Frostbane! I never thought I would see it. The Wurm sleeps in the deepest room of Frostdeep Cavern. Strike true."'
          : left.length ? `"Still missing: ${left.join(', ')}. The Firstforge waits at the southern foot of Mount Skyhorn."` : '"All three relics! Take them and 5 good steel bars to the Firstforge, south of Mount Skyhorn."');
        if (!s.fed) {
          if (foodCount() >= FOOD_NEEDED) options.push({ label: `Give the town ${FOOD_NEEDED} meals.`, act: 'elder_give' });
          else say(`"And if you can spare food, the town needs ${FOOD_NEEDED} meals. We'd pay what we can."`);
        }
      }
    } else if (npc === 'king') {
      if (s.choice === 'slain') say('The throne of crates sits empty. A Rat\'s Nest local nods at you with something like respect.');
      else if (s.side === 0 || s.side === 1) {
        say('A broad figure lounges on a throne of stolen crates. "So you\'re the one building out in MY wilds. Every road out here pays the King\'s toll."');
        say(`"${TRIBUTE} gold, and my people leave your camps alone. For good. Or refuse, and we settle it at the Red Stones, just you and me."`);
        if (state.gold >= TRIBUTE) options.push({ label: `Pay ${TRIBUTE} gold.`, act: 'king_pay' });
        else options.push({ label: `(You need ${TRIBUTE} gold to pay)`, act: 'none' });
        options.push({ label: 'Refuse. See you at the Red Stones.', act: 'king_fight' });
        options.push({ label: 'Leave.', act: 'none_close' });
      } else if (s.side === 2) say('The throne is empty. "The King went to the Red Stones," someone mutters. "Said you\'d know why."');
      else say('"A pleasure doing business, settler." Varn tosses a coin and catches it. "My people know to leave your camps be."');
    }
    return { title: cap(NPC_NAMES[npc].replace(/^the /, '')), lines, options };
  }

  function choose(act) {
    const s = S();
    if (act === 'none_close') { closePanel(); return; }
    if (act === 'herald_go') { s.metHerald = true; startMain('The Royal Herald asked me to find out why Frosthollow has gone silent.'); closePanel(); }
    else if (act === 'elder_meet') {
      s.metElder = true;
      startMain();
      journal('Elder Ysolde says a Frost Wurm beneath the ice is behind the endless winter. Only Frostbane, forged from three Firstsmith relics, can cut it.');
      setWinter(Math.max(1, s.winter), 'A bitter wind sweeps down from the north. Snow creeps across the highlands.');
      closePanel();
    } else if (act === 'elder_give') {
      let left = FOOD_NEEDED;
      for (const id of Object.keys(state.inv).filter(i => ITEMS[i].heal)) { const n = Math.min(left, have(id)); removeItem(id, n); left -= n; if (!left) break; }
      s.fed = true;
      state.gold += 300;
      toast('Frosthollow is fed', 'gold');
      log('Elder Ysolde presses 300 gold into your hands. "For the children."', 'level');
      journal('I brought food to Frosthollow.');
    } else if (act === 'elder_end') {
      s.thanked = true;
      state.gold += 2000;
      addItem('explorer_pack');
      toast('A hero\'s reward', 'gold');
      log('Elder Ysolde gives you 2,000 gold and an explorer\'s pack. "For whatever comes next."', 'level');
      closePanel();
    } else if (act === 'king_pay') {
      if (state.gold < TRIBUTE) return;
      state.gold -= TRIBUTE;
      s.side = 3; s.choice = 'paid';
      state.threat = 0;
      if (s.quests.king) s.quests.king.status = 'done';
      journal('I paid the Bandit King\'s toll. The raids on my camps will stop.');
      toast('Toll paid', 'gold');
      log('The Bandit King\'s people will no longer raid your settlement or ambush your caravans.', 'level');
      Sound.sfx('coins');
      closePanel();
    } else if (act === 'king_fight') {
      s.side = 2;
      if (!s.quests.king) begin('king', 'The King of Rat\'s Nest');
      journal('I refused the Bandit King. He is waiting for me at the Red Stones.');
      toast('Showdown at the Red Stones', 'warn');
      log('"Your funeral." The Bandit King leaves for the Red Stones, south-east of Rat\'s Nest.', 'level');
      Sound.sfx('growl');
      closePanel();
    }
    uiDirty = true;
  }

  // ------------------------------------------------------------ notice boards and side quests
  function questGoal(q) {
    const st = quest(q.id), n = st ? st.n || 0 : 0;
    if (q.kind === 'kill') return `${q.text} (${Math.min(n, q.n)}/${q.n})`;
    if (q.kind === 'deliver') return `${q.text} (you have ${have(q.target)}/${q.n})`;
    return q.text;
  }
  function rewardText(q) { return [`${fmt(q.gold)} gold`, ...Object.entries(q.items).map(([id, k]) => `${k > 1 ? k + ' ' : ''}${itemName(id)}`)].join(', '); }
  function complete(q) {
    const s = S();
    s.quests[q.id].status = 'done';
    state.gold += q.gold;
    for (const [id, k] of Object.entries(q.items)) addItem(id, k);
    if (s.tracked === q.id) s.tracked = null;
    s.questsDone = (s.questsDone || 0) + 1;
    toast(`Quest complete: ${q.title}`, 'gold');
    log(`Reward: ${rewardText(q)}.`, 'level');
    Sound.sfx('levelup');
    uiDirty = true;
  }
  function boardAction(act, id) {
    const q = QUESTS.find(x => x.id === id);
    if (!q) return;
    if (act === 'accept' && !quest(id)) { S().quests[id] = { status: 'active', n: 0 }; toast(`New quest: ${q.title}`, 'level'); log('Press J to track it.', 'level'); Sound.sfx('discover'); }
    if (act === 'handin' && active(id) && q.kind === 'deliver') {
      if (have(q.target) < q.n) { log(`You need ${q.n} ${itemName(q.target).toLowerCase()}.`, 'warn'); return; }
      removeItem(q.target, q.n);
      complete(q);
    }
    uiDirty = true;
  }
  function boardHtml(data) {
    const town = data.town;
    let html = '<h3>Work</h3>';
    for (const q of QUESTS.filter(x => x.town === town)) {
      const st = quest(q.id);
      html += `<div class="quest-card${st && st.status === 'done' ? ' done' : ''}"><b>${esc(q.title)}</b><p class="small">${esc(questGoal(q))}</p>
        <p class="small gold">Reward: ${esc(rewardText(q))}</p>`;
      if (!st) html += `<button data-board="accept" data-q="${q.id}">Take the job</button>`;
      else if (st.status === 'done') html += '<p class="small good">Done. Thank you!</p>';
      else if (q.kind === 'deliver') html += `<button data-board="handin" data-q="${q.id}" ${have(q.target) >= q.n ? '' : 'disabled'}>Hand in ${q.n} ${esc(itemName(q.target).toLowerCase())}</button>`;
      else html += '<p class="small dim">In progress.</p>';
      html += '</div>';
    }
    html += '<h3>Rumours</h3>' + (RUMOURS[town] || []).map(r => `<p class="small talk">"${esc(r)}"</p>`).join('');
    return [`${TOWNS[town].name} Notice Board`, html];
  }
  // '!' when there's new work, '?' when a delivery is ready to hand in.
  function boardMark(town) {
    const qs = QUESTS.filter(x => x.town === town);
    if (qs.some(q => active(q.id) && q.kind === 'deliver' && have(q.target) >= q.n)) return '?';
    return qs.some(q => !quest(q.id)) ? '!' : '';
  }

  // ------------------------------------------------------------ secrets
  const seedsHeld = () => Object.keys(S().seeds).length + (S().seedBonus || 0) - (S().seedsSpent || 0);
  function tickSecrets() {
    const s = S();
    for (let k = 0; k < starSeeds.length; k++) {
      const sd = starSeeds[k];
      if (s.seeds[k] || Math.abs(sd.x - state.px) > 1.3 || Math.abs(sd.y - state.py) > 1.3) continue;
      s.seeds[k] = state.day;
      toast(`Star seed (${Object.keys(s.seeds).length}/${starSeeds.length})`, 'gold');
      log(seedsHeld() >= 5 ? 'You have enough to make an offering at any shrine.' : 'Offer five at any shrine for a blessing.', 'level');
      Sound.sfx('discover');
    }
  }
  function dig(svc) {
    const s = S();
    if (s.dug[svc.id]) { log('Someone already dug here. You did.', 'dim'); return; }
    if (!bestTool('pickaxe')) { log('You need a pickaxe to dig up this cairn.', 'warn'); return; }
    s.dug[svc.id] = state.day;
    const gold = randInt(150, 450);
    state.gold += gold;
    const pool = [['gold_bar', 2], ['steel_bar', 3], ['rough_gem', 2], ['doubloon', 2], ['ancient_coin', 1], ['star_fragment', 1]];
    const [id, n] = pool[randInt(0, pool.length - 1)];
    addItem(id, n);
    let extra = '';
    if (Math.random() < 0.35) { s.seedBonus = (s.seedBonus || 0) + 1; extra = ' and a star seed'; }
    Sound.sfx('chest');
    toast('Buried treasure!', 'gold');
    log(`You dig up ${gold} gold, ${n} ${itemName(id).toLowerCase()}${extra}.`, 'level');
  }
  function turnRune(svc) {
    const s = S(), r = s.runes[svc.poi] = s.runes[svc.poi] || { E: 'Sun', W: 'Sun', N: 'Sun', S: 'Sun' };
    if (s.solved[svc.poi]) { log('The runes glow steadily. This circle is at peace.', 'dim'); return; }
    r[svc.dir] = RUNES[(RUNES.indexOf(r[svc.dir]) + 1) % RUNES.length];
    Sound.sfx('mine');
    log(`The ${{ E: 'eastern', W: 'western', N: 'northern', S: 'southern' }[svc.dir]} stone now shows the ${r[svc.dir]}.`, 'dim');
    const sol = RIDDLES[svc.poi];
    if (sol && ['E', 'W', 'N', 'S'].every(d => r[d] === sol[d])) {
      s.solved[svc.poi] = state.day;
      s.seedBonus = (s.seedBonus || 0) + 2;
      state.gold += 400;
      Sound.sfx('shrine');
      toast('The stones awaken!', 'gold');
      log('Light runs between the stones. You receive 400 gold and two star seeds.', 'level');
    }
    uiDirty = true;
  }
  // Called when you pray at a shrine: stone circles read out their riddle, and seeds can be offered.
  function atShrine(poi) {
    const rd = RIDDLES[poi];
    if (rd && !S().solved[poi]) { toast('Words carved in the altar', 'level'); log(rd.text, 'level'); }
    if (seedsHeld() >= 5) openPanel('offering', { poi });
  }
  function offer(kind) {
    const s = S();
    if (seedsHeld() < 5) return;
    s.seedsSpent = (s.seedsSpent || 0) + 5;
    s.upg[kind] = (s.upg[kind] || 0) + 1;
    toast(kind === 'stamina' ? 'Stamina blessed: +10' : 'Pack blessed: +10 space', 'gold');
    Sound.sfx('shrine');
    closePanel();
    uiDirty = true;
  }
  function offeringHtml() {
    return ['An offering', `<p>The shrine glows as you come near. You carry <b>${seedsHeld()}</b> star seeds.</p>
      <p>Offer five for a blessing:</p>
      <p><button data-offer="stamina" class="big">+10 stamina</button> <button data-offer="pack" class="big">+10 pack space</button></p>
      <p class="small dim">Stamina blessings so far: ${S().upg.stamina}. Pack blessings: ${S().upg.pack}.</p><button data-close="1">Not now</button>`];
  }

  // ------------------------------------------------------------ hooks from the game
  function tick() {
    const s = S();
    tickSecrets();
    // The Bandit King notices you once you're making a name for yourself.
    if (s.side === 0 && (s.metElder || state.threat >= 35 || state.structs.length >= 12)) {
      s.side = 1;
      begin('king', 'The King of Rat\'s Nest', 'A note pinned with a knife: "The Bandit King of Rat\'s Nest wants a word."');
    }
    for (const q of QUESTS) {
      if (!active(q.id) || q.kind !== 'visit') continue;
      const p = poiAt(q.target);
      if (p && Math.hypot(p.x - state.px, p.y - state.py) < 6) complete(q);
    }
  }

  // Bosses carry the relics whenever you defeat them, story or no story.
  function onKill(type) {
    const s = S();
    for (const q of QUESTS) if (active(q.id) && q.kind === 'kill' && q.target === type) { s.quests[q.id].n = (s.quests[q.id].n || 0) + 1; if (s.quests[q.id].n >= q.n) complete(q); }
    const relic = (id, text) => {
      if (hasRelic(id)) return;
      addItem(id);
      startMain();
      toast(`Relic found: ${itemName(id)}`, 'level');
      log(text, 'level');
      Sound.sfx('discover');
      if (s.winter < 2 && RELICS.filter(hasRelic).length >= 1 && s.metElder) setWinter(2, 'The cold deepens. Lakes and rivers in the north freeze solid enough to walk on.');
    };
    if (type === 'cryptlord') relic('ember_core', 'Among the Crypt Lord\'s bones lies the Ember Core, still warm after a thousand years.');
    if (type === 'drake') relic('star_shard', 'The Frost Drake guarded a Star-anvil Shard. It hums in your hand.');
    if (type === 'wurm' && !s.done) {
      s.done = true;
      startMain();
      if (s.quests.main) s.quests.main.status = 'done';
      if (s.tracked === 'main') s.tracked = null;
      journal('The Frost Wurm is dead, and the Long Winter with it.');
      setWinter(-1, 'The Long Winter breaks! Snow melts, rivers run, and spring sweeps across the land.');
      Sound.sfx('levelup');
    }
    if (type === 'banditking' && s.side === 2) {
      s.side = 3; s.choice = 'slain';
      if (s.quests.king) s.quests.king.status = 'done';
      state.threat = Math.max(0, state.threat - 60);
      journal('I defeated the Bandit King. Rat\'s Nest is a free town now, and the badlands are quieter.');
      toast('Rat\'s Nest is free!', 'level');
      log('Without their king the bandits scatter, and Rat\'s Nest opens up to honest trade.', 'level');
    }
  }

  // The Buried Temple's chest holds the Sun Sigil, even if you emptied it before.
  function onChest(poi) {
    if (poi !== 'buriedtemple' || hasRelic('sun_sigil')) return false;
    addItem('sun_sigil');
    startMain();
    toast('Relic found: Sun Sigil', 'level');
    log('Under a false bottom in the temple chest lies the Sun Sigil, blazing with trapped sunlight.', 'level');
    Sound.sfx('discover');
    return true;
  }

  function useForge() {
    const s = S();
    if (s.forgeLit) { log('The Firstforge burns with a steady, sunlit flame.', 'dim'); return; }
    const missing = RELICS.filter(id => !have(id));
    if (missing.length) { log(`An ancient forge, cold for a thousand years. Three hollows in the anvil wait for relics (${3 - missing.length}/3).`, 'dim'); startMain(); return; }
    if (have('steel_bar') < 5) { log(`The relics glow as you come near, but the forge needs 5 steel bars (you have ${have('steel_bar')}).`, 'warn'); return; }
    for (const id of RELICS) removeItem(id);
    removeItem('steel_bar', 5);
    addItem('frostbane');
    s.forgeLit = true;
    startMain();
    Sound.sfx('anvil');
    journal('I forged Frostbane in the Firstforge.');
    toast('Frostbane is forged!', 'level');
    log('The relics flare and the Firstforge roars to life. You hammer the steel through the night, and Frostbane is born.', 'level');
    setWinter(3, 'As if in answer, the Wurm stirs. Snow falls on Ironhold itself.');
  }

  function npcMark(npc) {
    const s = S();
    if (npc === 'herald') return !s.started ? '!' : '';
    if (npc === 'elder') return !s.metElder || (s.done && !s.thanked) || (!s.fed && foodCount() >= FOOD_NEEDED) ? '!' : '';
    if (npc === 'king') return s.side === 1 ? '!' : '';
    return '';
  }
  const npcHere = npc => npc !== 'king' || (S().side !== 2 && S().choice !== 'slain');

  // ------------------------------------------------------------ the quest log and tracker
  function questInfo(id) {
    const s = S();
    if (id === 'main') {
      const st = nextMainStep();
      return { title: 'The Long Winter', goal: st ? st.text : 'The Long Winter is over.', progress: st && st.progress ? st.progress() : '', at: st && st.at ? st.at() : null, done: !!s.done };
    }
    if (id === 'king') {
      const rs = poiAt('redstones');
      return s.side === 2 ? { title: 'Showdown at the Red Stones', goal: 'Defeat the Bandit King at the Red Stones, south-east of Rat\'s Nest.', at: rs }
        : { title: 'The King of Rat\'s Nest', goal: 'The Bandit King of Rat\'s Nest wants a word.', at: TOWN_DEFS.ratsnest, done: s.side === 3 };
    }
    const q = QUESTS.find(x => x.id === id);
    if (!q) return null;
    const where = q.kind === 'visit' ? poiAt(q.target) : q.kind === 'deliver' && have(q.target) >= q.n ? TOWN_DEFS[q.town] : null;
    const st = quest(id) || {};
    return { title: q.title, goal: q.text, progress: q.kind === 'kill' ? `${Math.min(st.n || 0, q.n)}/${q.n}` : q.kind === 'deliver' ? `${Math.min(have(q.target), q.n)}/${q.n}` : '', at: where };
  }
  function current() {
    const id = S().tracked;
    if (!id || !active(id)) return null;
    return questInfo(id);
  }
  function target() { const c = current(); return c && c.at ? { x: c.at.x, y: c.at.y } : null; }
  function track(id) { S().tracked = S().tracked === id ? null : id; uiDirty = true; }

  function questsHtml() {
    const s = S();
    const ids = Object.keys(s.quests);
    const act = ids.filter(id => s.quests[id].status === 'active'), done = ids.filter(id => s.quests[id].status === 'done');
    let html = '';
    if (!act.length) html += '<p class="dim">No quests yet. Talk to people, read the notice boards in town squares, and explore.</p>';
    for (const id of act) {
      const q = questInfo(id);
      if (!q) continue;
      html += `<div class="quest-card${s.tracked === id ? ' tracked' : ''}"><b>${esc(q.title)}</b>${q.progress ? ` <span class="small gold">${esc(q.progress)}</span>` : ''}<p class="small">${esc(q.goal)}</p>`;
      if (id === 'main') html += '<ul class="steps">' + mainSteps().map(st => `<li class="${st.done ? 'good' : ''}">${st.done ? '&#10003;' : '&#9675;'} ${esc(st.text)}</li>`).join('') + '</ul>';
      html += `<button data-track="${id}">${s.tracked === id ? 'Stop tracking' : 'Track'}</button></div>`;
    }
    if (done.length) html += `<h3>Completed</h3><p class="small">${done.map(id => esc((questInfo(id) || {}).title || id)).join(', ')}</p>`;
    const found = Object.keys(s.seeds).length, dugN = Object.keys(s.dug).length, solved = Object.keys(s.solved).length;
    html += `<h3>Secrets</h3><p class="small">Star seeds found: ${found}/${starSeeds.length} (holding ${seedsHeld()}). Treasure dug up: ${dugN}/${cairns.length}. Stone circles solved: ${solved}/${Object.keys(RIDDLES).length}.</p>`;
    if (s.winter > 0) html += `<p class="small bad">The winter deepens: ${['', 'snow covers the highlands', 'the northern lakes have frozen', 'snow has reached Ironhold'][s.winter]}.</p>`;
    if (s.winter < 0) html += '<p class="small good">Spring has come. Flowers bloom across the land.</p>';
    if (s.journal.length) {
      html += '<h3>Journal</h3><ul class="journal">';
      for (const j of s.journal.slice().reverse()) html += `<li><span class="dim">Day ${j.day}:</span> ${esc(j.text)}</li>`;
      html += '</ul>';
    }
    return ['Quests', html];
  }

  function talkHtml(data) {
    const d = talk(data.npc);
    let html = d.lines.map(l => `<p class="talk">${esc(l)}</p>`).join('');
    html += '<div class="talk-options">';
    for (const o of d.options) html += `<button data-talk="${o.act}"${o.act === 'none' ? ' disabled' : ''}>${esc(o.label)}</button>`;
    if (!d.options.some(o => o.act === 'none_close')) html += '<button data-close="1">Goodbye.</button>';
    return [d.title, html + '</div>'];
  }

  return { init, talk, choose, tick, onKill, onChest, useForge, npcMark, npcHere, current, target, track, questsHtml, talkHtml,
    boardHtml, boardAction, boardMark, dig, turnRune, atShrine, offer, offeringHtml, seedsHeld };
})();
