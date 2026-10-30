// The Long Winter: the main story, the Firstsmiths' relics that win it, and the Bandit King side story.
// Big moments change the world: snow creeps south, lakes freeze, the Firstforge wakes, and the thaw brings spring.
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

const Story = (() => {
  const S = () => state.story;
  const built = type => state.structs.some(s => s.type === type && s.level >= 1);
  const foodCount = () => Object.keys(state.inv).filter(id => ITEMS[id].heal).reduce((a, id) => a + have(id), 0);
  const relicCount = () => RELICS.filter(id => have(id)).length;
  const poiAt = id => pois.find(p => p.id === id);
  const townAtNpc = npc => ({ herald: 'ironhold', elder: 'frosthollow', king: 'ratsnest' }[npc]);

  const MAIN = [
    { title: 'A Place to Call Home', goal: () => 'Build a workbench and a furnace to get your settlement going.',
      progress: () => `${(built('workbench') ? 1 : 0) + (built('furnace') ? 1 : 0)}/2 built` },
    { title: 'Word from the Capital', goal: () => 'Speak to the Royal Herald on the Ironhold market square.', npc: 'herald' },
    { title: 'Silence in the North', goal: () => 'Travel north to Frosthollow and speak to Elder Ysolde.', npc: 'elder' },
    { title: 'Bread for the Hungry', goal: () => `Bring ${FOOD_NEEDED} meals (any cooked food) to Elder Ysolde in Frosthollow.`, npc: 'elder',
      progress: () => `${Math.min(foodCount(), FOOD_NEEDED)}/${FOOD_NEEDED} food` },
    { title: 'The Firstsmiths', goal: () => 'Recover the three Firstsmith relics: the Ember Core from the Crypt Lord in the Sunken Crypt, the Sun Sigil from the Buried Temple in the Amber Wastes, and the Star-anvil Shard from the Frost Drake on Mount Skyhorn.',
      progress: () => `${relicCount()}/3 relics` },
    { title: 'The Firstforge', goal: () => 'Bring the three relics and 5 steel bars to the Firstforge at the southern foot of Mount Skyhorn.',
      progress: () => `${Math.min(have('steel_bar'), 5)}/5 steel bars` },
    { title: 'The Heart of Winter', goal: () => 'Wield Frostbane and slay the Frost Wurm in the depths of Frostdeep Cavern, in the taiga.' },
    { title: 'The Thaw', goal: () => 'Return to Elder Ysolde in Frosthollow.', npc: 'elder' },
    { title: 'Spring', goal: () => 'The Long Winter is over. The world is yours to build.' },
  ];
  const SIDE = [
    null,
    { title: 'The King of Rat\'s Nest', goal: () => 'Someone calling himself the Bandit King wants a word. Find him on the Rat\'s Nest square.', npc: 'king' },
    { title: 'Showdown at the Red Stones', goal: () => 'Defeat the Bandit King at the Red Stones, in the badlands south-east of Rat\'s Nest.' },
    null,
  ];

  // Where the current objective is, for the map markers.
  function target() {
    const s = S();
    const at = id => { const p = poiAt(id); return p ? { x: p.x, y: p.y } : null; };
    const town = id => ({ x: TOWN_DEFS[id].x, y: TOWN_DEFS[id].y });
    switch (s.step) {
      case 1: return town('ironhold');
      case 2: case 3: case 7: return town('frosthollow');
      case 4: {
        if (!have('ember_core')) return at('crypt');
        if (!have('sun_sigil')) return at('buriedtemple');
        return { x: PEAK.x, y: PEAK.y };
      }
      case 5: return at('firstforge');
      case 6: return at('cavern');
    }
    return null;
  }

  function journal(text) { S().journal.push({ day: state.day, text }); }

  function advance(step, note) {
    S().step = step;
    if (note) journal(note);
    const q = MAIN[step];
    toast(`Quest: ${q.title}`, 'level');
    log(`New objective: ${q.goal()}`, 'level');
    Sound.sfx('discover');
    uiDirty = true;
  }

  function setWinter(level, message) {
    S().winter = level;
    if (message) { log(message, level < 0 ? 'good' : 'warn'); toast(message, level < 0 ? 'level' : 'warn'); }
    if (typeof Render3D !== 'undefined' && Render3D.setWinter) Render3D.setWinter();
    if (typeof buildMapImage === 'function') buildMapImage();
  }

  // ------------------------------------------------------------ talking
  function talk(npc) {
    const s = S(), lines = [], options = [];
    const say = t => lines.push(t);
    if (npc === 'herald') {
      if (s.step < 1) say('The Herald is pinning up proclamations. "Make something of yourself first, settler. Put up a workbench and a furnace. The crown has no use for drifters."');
      else if (s.step === 1) {
        say('"Ah, the settler everyone keeps talking about. Good. The crown has a task for someone capable."');
        say('"Frosthollow, our northernmost town, has gone silent. No carts, no letters. And every winter lasts longer than the one before. Travel north and find Elder Ysolde. Find out what is happening up there."');
        options.push({ label: 'I\'ll go north.', act: 'herald_go' });
      } else if (s.step < 8) say(`"Any news from the north? The crown is counting on you." The Herald glances at the grey sky. "${s.winter >= 3 ? 'Snow in Ironhold. In living memory, never.' : 'It grows colder by the week.'}"`);
      else say('"The thaw! The whole capital is talking about you. Long may the spring last."');
    } else if (npc === 'elder') {
      if (s.step < 2) say('An old woman wrapped in furs looks up from the fire. "Strangers rarely come this far north. Warm yourself, traveller."');
      else if (s.step === 2) {
        say('"So Ironhold remembers us at last." Elder Ysolde pulls her furs tighter. "Something stirs beneath the ice, deep in Frostdeep Cavern. Every winter is longer than the last, and this one may never end."');
        say(`"But first things first. Our stores are empty and the children are hungry. Bring us ${FOOD_NEEDED} meals and we can talk about the rest."`);
        options.push({ label: 'I\'ll bring food.', act: 'elder_food' });
      } else if (s.step === 3) {
        const n = foodCount();
        if (n >= FOOD_NEEDED) {
          say('"You came back! And with food. Bless you, settler."');
          options.push({ label: `Hand over ${FOOD_NEEDED} meals.`, act: 'elder_give' });
        } else say(`"We still need ${FOOD_NEEDED - n} more meals. Cooked fish keeps well in the cold."`);
      } else if (s.step === 4) say('"The Firstsmiths left three relics behind: the Ember Core, the Sun Sigil and the Star-anvil Shard. Bring them together at their forge and you can make a blade that bites through ice."');
      else if (s.step === 5) say('"The Firstforge sits cold at the southern foot of Mount Skyhorn. Bring it the relics and good steel."');
      else if (s.step === 6) say('"Frostbane! I never thought I would see it. The Wurm sleeps in the deepest room of Frostdeep Cavern. Strike true."');
      else if (s.step === 7) {
        say('Meltwater drips from the eaves. Elder Ysolde is laughing. "Listen! The ice is singing as it breaks. You did it."');
        options.push({ label: 'It\'s over.', act: 'elder_end' });
      } else say('"Spring in Frosthollow. The children have never seen flowers before. Thank you, settler."');
    } else if (npc === 'king') {
      if (s.choice === 'slain') say('The throne of crates sits empty. A Rat\'s Nest local nods at you with something like respect.');
      else if (s.side === 0) say('A broad figure lounges on a throne of stolen crates. "Not now. Unless you\'ve come to pay your respects?"');
      else if (s.side === 1) {
        say('"So you\'re the one building out in MY wilds." Varn leans forward. "Every road out here pays the King\'s toll."');
        say(`"${TRIBUTE} gold, and my boys leave your camps alone. For good. Or refuse, and we settle it like proper folk: at the Red Stones, just you and me."`);
        if (state.gold >= TRIBUTE) options.push({ label: `Pay ${TRIBUTE} gold.`, act: 'king_pay' });
        else options.push({ label: `(You need ${TRIBUTE} gold to pay)`, act: 'none' });
        options.push({ label: 'Refuse. I\'ll see you at the Red Stones.', act: 'king_fight' });
      } else if (s.side === 2) say('The throne is empty. "The King went to the Red Stones," someone mutters. "Said you\'d know why."');
      else say('"A pleasure doing business, settler." Varn tosses a coin and catches it. "My boys know to leave your camps be."');
    }
    return { title: cap(NPC_NAMES[npc].replace(/^the /, '')), lines, options };
  }

  function choose(act) {
    const s = S();
    if (act === 'herald_go') advance(2, 'The Royal Herald sent me north to find out why Frosthollow has gone silent.');
    else if (act === 'elder_food') {
      advance(3, 'Elder Ysolde says something stirs beneath the ice. First, Frosthollow needs food.');
      setWinter(1, 'A bitter wind sweeps down from the north. Snow creeps across the highlands.');
    } else if (act === 'elder_give') {
      let left = FOOD_NEEDED;
      for (const id of Object.keys(state.inv).filter(i => ITEMS[i].heal)) { const n = Math.min(left, have(id)); removeItem(id, n); left -= n; if (!left) break; }
      state.gold += 300;
      log('Elder Ysolde gives you 300 gold from the town chest.', 'gold');
      advance(4, 'The Frost Wurm is behind the endless winter. Only a Firstsmith blade can cut its hide, and the Firstsmiths\' relics are scattered across the land.');
      setWinter(2, 'The cold deepens. Lakes and rivers in the north freeze solid enough to walk on.');
    } else if (act === 'elder_end') {
      state.gold += 2000;
      addItem('explorer_pack');
      log('Elder Ysolde gives you 2,000 gold and an explorer\'s pack. "For whatever comes next."', 'gold');
      advance(8, 'The Long Winter is over. Spring has come to the north.');
      Sound.sfx('levelup');
    } else if (act === 'king_pay') {
      if (state.gold < TRIBUTE) return;
      state.gold -= TRIBUTE;
      s.side = 3; s.choice = 'paid';
      state.threat = 0;
      journal('I paid the Bandit King\'s toll. His bandits will leave my camps alone.');
      log('You pay the toll. The Bandit King\'s men will no longer raid your settlement.', 'gold');
      Sound.sfx('coins');
    } else if (act === 'king_fight') {
      s.side = 2;
      journal('I refused the Bandit King. He is waiting for me at the Red Stones.');
      toast('Quest: Showdown at the Red Stones', 'warn');
      log('"Your funeral." The Bandit King leaves for the Red Stones.', 'warn');
      Sound.sfx('growl');
    }
    uiDirty = true;
  }

  // ------------------------------------------------------------ hooks from the game
  function tick() {
    const s = S();
    if (s.step === 0 && built('workbench') && built('furnace')) advance(1, 'My settlement has a workbench and a furnace. Time to see what the capital wants.');
    if (s.step === 4 && relicCount() === 3) advance(5, 'All three relics are mine. Now to wake the Firstforge.');
    if (s.side === 0 && (s.step >= 3 || state.threat >= 35)) {
      s.side = 1;
      log('A bandit leaves a note pinned with a knife: "The Bandit King of Rat\'s Nest wants a word."', 'warn');
      toast('Quest: The King of Rat\'s Nest', 'warn');
      uiDirty = true;
    }
  }

  // Bosses carry the relics while the story needs them.
  function onKill(type) {
    const s = S();
    const relic = (id, text) => { if (s.step === 4 && !have(id)) { addItem(id); log(text, 'level'); toast(`Relic found: ${itemName(id)}`, 'level'); Sound.sfx('discover'); } };
    if (type === 'cryptlord') relic('ember_core', 'Among the Crypt Lord\'s bones lies the Ember Core, still warm after a thousand years.');
    if (type === 'drake') relic('star_shard', 'The Frost Drake guarded a Star-anvil Shard. It hums in your hand.');
    if (type === 'wurm' && s.step === 6) {
      advance(7, 'The Frost Wurm is dead. The ice is breaking.');
      setWinter(-1, 'The Long Winter breaks! Snow melts, rivers run, and spring sweeps across the land.');
      Sound.sfx('levelup');
    }
    if (type === 'banditking' && s.side === 2) {
      s.side = 3; s.choice = 'slain';
      state.threat = Math.max(0, state.threat - 60);
      journal('I defeated the Bandit King. Rat\'s Nest is a free town now, and the badlands are quieter.');
      log('The Bandit King falls! Without him the bandits scatter, and Rat\'s Nest opens up to honest trade.', 'level');
      toast('Rat\'s Nest is free!', 'level');
    }
  }

  // The Buried Temple's chest holds the Sun Sigil, even if you emptied it before.
  function onChest(poi) {
    const s = S();
    if (poi === 'buriedtemple' && s.step === 4 && !have('sun_sigil')) {
      addItem('sun_sigil');
      log('Under a false bottom in the temple chest lies the Sun Sigil, blazing with trapped sunlight.', 'level');
      toast('Relic found: Sun Sigil', 'level');
      Sound.sfx('discover');
      return true;
    }
    return false;
  }

  function useForge() {
    const s = S();
    if (s.step < 5) { log(s.step === 4 ? 'The forge is cold. It needs the three Firstsmith relics.' : 'An ancient forge, cold for a thousand years. Strange runes cover the anvil.', 'dim'); return; }
    if (s.step > 5) { log('The Firstforge burns with a steady, sunlit flame.', 'dim'); return; }
    if (have('steel_bar') < 5) { log(`The relics glow as you come near, but the forge needs 5 steel bars (you have ${have('steel_bar')}).`, 'warn'); return; }
    for (const id of RELICS) removeItem(id);
    removeItem('steel_bar', 5);
    addItem('frostbane');
    s.forgeLit = true;
    Sound.sfx('anvil');
    log('The relics flare and the Firstforge roars to life. You hammer the steel through the night, and Frostbane is born.', 'level');
    advance(6, 'I forged Frostbane in the Firstforge. Now for the Wurm.');
    setWinter(3, 'As if in answer, the Wurm stirs. Snow falls on Ironhold itself.');
  }

  // '!' when someone has something new to say, '?' when they're waiting on you.
  function npcMark(npc) {
    const s = S();
    if (npc === 'herald') return s.step === 1 ? '!' : '';
    if (npc === 'elder') return s.step === 2 || s.step === 7 ? '!' : s.step === 3 ? (foodCount() >= FOOD_NEEDED ? '!' : '?') : '';
    if (npc === 'king') return s.side === 1 ? '!' : '';
    return '';
  }
  const npcHere = npc => npc !== 'king' || (S().side !== 2 && S().choice !== 'slain');

  function current() {
    const s = S(), q = MAIN[Math.min(s.step, MAIN.length - 1)];
    const side = SIDE[s.side];
    return { main: { ...q, goal: q.goal(), progress: q.progress ? q.progress() : '' }, side: side ? { ...side, goal: side.goal() } : null };
  }

  function questsHtml() {
    const c = current(), s = S();
    let html = `<h3>${esc(c.main.title)}</h3><p>${esc(c.main.goal)}</p>`;
    if (c.main.progress) html += `<p class="gold small">${esc(c.main.progress)}</p>`;
    if (c.side) html += `<h3>Side quest: ${esc(c.side.title)}</h3><p>${esc(c.side.goal)}</p>`;
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
    html += '<button data-close="1">Goodbye.</button></div>';
    return [d.title, html];
  }

  return { talk, choose, tick, onKill, onChest, useForge, npcMark, npcHere, current, target, questsHtml, talkHtml };
})();
