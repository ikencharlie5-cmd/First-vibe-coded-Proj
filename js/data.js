// Static game data: items, resources, recipes, monsters, buildings.
'use strict';

const SKILLS = [
  { id: 'attack',      name: 'Attack',      group: 'combat' },
  { id: 'strength',    name: 'Strength',    group: 'combat' },
  { id: 'defence',     name: 'Defence',     group: 'combat' },
  { id: 'hitpoints',   name: 'Hitpoints',   group: 'combat' },
  { id: 'woodcutting', name: 'Woodcutting', group: 'gathering' },
  { id: 'mining',      name: 'Mining',      group: 'gathering' },
  { id: 'fishing',     name: 'Fishing',     group: 'gathering' },
  { id: 'carpentry',   name: 'Carpentry',   group: 'refining' },
  { id: 'smelting',    name: 'Smelting',    group: 'refining' },
  { id: 'smithing',    name: 'Smithing',    group: 'refining' },
  { id: 'cooking',     name: 'Cooking',     group: 'refining' },
];

const MAX_LEVEL = 60;
// Total XP required to reach a level.
function xpForLevel(l) { return l <= 1 ? 0 : Math.round(40 * Math.pow(l - 1, 1.9)); }

const ITEMS = {
  pine_log:       { name: 'Pine log',       value: 5 },
  oak_log:        { name: 'Oak log',        value: 14 },
  ironwood_log:   { name: 'Ironwood log',   value: 30 },
  pine_plank:     { name: 'Pine plank',     value: 14 },
  oak_plank:      { name: 'Oak plank',      value: 34 },
  ironwood_plank: { name: 'Ironwood plank', value: 70 },

  copper_ore:     { name: 'Copper ore',     value: 6 },
  iron_ore:       { name: 'Iron ore',       value: 14 },
  coal:           { name: 'Coal',           value: 16 },
  copper_bar:     { name: 'Copper bar',     value: 20 },
  iron_bar:       { name: 'Iron bar',       value: 42 },
  steel_bar:      { name: 'Steel bar',      value: 85 },
  starmetal_bar:  { name: 'Starmetal bar',  value: 240 },

  raw_minnow:     { name: 'Raw minnow',     value: 4 },
  raw_trout:      { name: 'Raw trout',      value: 11 },
  raw_pike:       { name: 'Raw pike',       value: 22 },
  minnow:         { name: 'Cooked minnow',  value: 10, heal: 3 },
  trout:          { name: 'Cooked trout',   value: 24, heal: 7 },
  pike:           { name: 'Cooked pike',    value: 45, heal: 12 },
  burnt_fish:     { name: 'Burnt fish',     value: 1 },

  // Monster-only materials
  goblin_trinket: { name: 'Goblin trinket', value: 25,  rare: true },
  rough_gem:      { name: 'Rough gem',      value: 70,  rare: true },
  wolf_pelt:      { name: 'Wolf pelt',      value: 30,  rare: true },
  bandit_signet:  { name: 'Bandit signet',  value: 130, rare: true },
  ogre_tusk:      { name: 'Ogre tusk',      value: 90,  rare: true },
  star_fragment:  { name: 'Star fragment',  value: 160, rare: true },

  // Starting tools
  worn_axe:       { name: 'Worn axe',       value: 2, tool: 'axe',     tier: 0, req: 1 },
  worn_pickaxe:   { name: 'Worn pickaxe',   value: 2, tool: 'pickaxe', tier: 0, req: 1 },
  fishing_rod:    { name: 'Fishing rod',    value: 8, tool: 'rod',     tier: 0, req: 1 },
};

// Metal tiers used for smelting + smithing.
const TIERS = [
  { id: 'copper',    name: 'Copper',    tier: 1, req: 1,  plank: 'pine_plank',     barXp: 12 },
  { id: 'iron',      name: 'Iron',      tier: 2, req: 10, plank: 'pine_plank',     barXp: 25 },
  { id: 'steel',     name: 'Steel',     tier: 3, req: 20, plank: 'oak_plank',      barXp: 40 },
  { id: 'starmetal', name: 'Starmetal', tier: 4, req: 32, plank: 'ironwood_plank', barXp: 75 },
];

const GEAR = [
  { id: 'sword',     name: 'sword',     slot: 'weapon', bars: 2, planks: 1, off: 2, stats: t => ({ acc: 10 * t, str: 9 * t }) },
  { id: 'shield',    name: 'shield',    slot: 'shield', bars: 2, planks: 2, off: 4, stats: t => ({ def: 8 * t }) },
  { id: 'helm',      name: 'helm',      slot: 'head',   bars: 1, planks: 0, off: 0, stats: t => ({ def: 4 * t }) },
  { id: 'platebody', name: 'platebody', slot: 'body',   bars: 3, planks: 0, off: 6, extra: { wolf_pelt: 1 }, stats: t => ({ def: 12 * t }) },
  { id: 'axe',       name: 'axe',       tool: 'axe',     bars: 1, planks: 1, off: 1 },
  { id: 'pickaxe',   name: 'pickaxe',   tool: 'pickaxe', bars: 1, planks: 1, off: 1 },
];

const SLOT_SKILL = { weapon: 'attack', shield: 'defence', head: 'defence', body: 'defence' };
const TOOL_SKILL = { axe: 'woodcutting', pickaxe: 'mining', rod: 'fishing' };

// Gatherable map nodes.
const RESOURCES = {
  pine:     { name: 'Pine tree',     skill: 'woodcutting', level: 1,  xp: 8,  item: 'pine_log',     ch: 't', cls: 'pine',     deplete: 0.25, respawn: 8,  tool: 'axe' },
  oak:      { name: 'Oak tree',      skill: 'woodcutting', level: 10, xp: 18, item: 'oak_log',      ch: 'T', cls: 'oak',      deplete: 0.18, respawn: 15, tool: 'axe' },
  ironwood: { name: 'Ironwood tree', skill: 'woodcutting', level: 25, xp: 40, item: 'ironwood_log', ch: 'Y', cls: 'ironwood', deplete: 0.12, respawn: 30, tool: 'axe' },
  copper:   { name: 'Copper rock',   skill: 'mining',      level: 1,  xp: 9,  item: 'copper_ore',   ch: '*', cls: 'copper',   deplete: 0.35, respawn: 6,  tool: 'pickaxe' },
  iron:     { name: 'Iron rock',     skill: 'mining',      level: 10, xp: 20, item: 'iron_ore',     ch: '*', cls: 'iron',     deplete: 0.35, respawn: 12, tool: 'pickaxe' },
  coal:     { name: 'Coal rock',     skill: 'mining',      level: 20, xp: 30, item: 'coal',         ch: '*', cls: 'coal',     deplete: 0.3,  respawn: 20, tool: 'pickaxe' },
  minnow:   { name: 'Minnow shoal',  skill: 'fishing',     level: 1,  xp: 6,  item: 'raw_minnow',   ch: '%', cls: 'fish1',    deplete: 0,    respawn: 0,  tool: 'rod' },
  trout:    { name: 'Trout pool',    skill: 'fishing',     level: 10, xp: 15, item: 'raw_trout',    ch: '%', cls: 'fish2',    deplete: 0,    respawn: 0,  tool: 'rod' },
  pike:     { name: 'Pike waters',   skill: 'fishing',     level: 20, xp: 28, item: 'raw_pike',     ch: '%', cls: 'fish3',    deplete: 0,    respawn: 0,  tool: 'rod' },
};

const STATIONS = {
  market:  { name: 'Market',     ch: '$', desc: 'Buy and sell goods. Prices drift over time.' },
  sawmill: { name: 'Sawbench',   ch: 'S', skill: 'carpentry', desc: 'Saw logs into planks.' },
  furnace: { name: 'Furnace',    ch: 'F', skill: 'smelting',  desc: 'Smelt ore into bars.' },
  anvil:   { name: 'Anvil',      ch: 'A', skill: 'smithing',  desc: 'Smith bars into tools, weapons and armour.' },
  range:   { name: 'Cook fire',  ch: 'R', skill: 'cooking',   desc: 'Cook raw fish into food.' },
  hall:    { name: 'Guild Hall', ch: 'H', desc: 'Manage your camps, works, workers and guards.' },
};

// Recipes keyed by id.
const RECIPES = {};
function addRecipe(r) { RECIPES[r.id] = r; }

addRecipe({ id: 'pine_plank',     skill: 'carpentry', level: 1,  xp: 5,  inputs: { pine_log: 1 },     outputs: { pine_plank: 1 } });
addRecipe({ id: 'oak_plank',      skill: 'carpentry', level: 10, xp: 12, inputs: { oak_log: 1 },      outputs: { oak_plank: 1 } });
addRecipe({ id: 'ironwood_plank', skill: 'carpentry', level: 25, xp: 25, inputs: { ironwood_log: 1 }, outputs: { ironwood_plank: 1 } });

addRecipe({ id: 'copper_bar',    skill: 'smelting', level: 1,  xp: 6,  inputs: { copper_ore: 1 },               outputs: { copper_bar: 1 } });
addRecipe({ id: 'iron_bar',      skill: 'smelting', level: 10, xp: 14, inputs: { iron_ore: 1 },                 outputs: { iron_bar: 1 } });
addRecipe({ id: 'steel_bar',     skill: 'smelting', level: 20, xp: 25, inputs: { iron_ore: 1, coal: 2 },        outputs: { steel_bar: 1 } });
addRecipe({ id: 'starmetal_bar', skill: 'smelting', level: 30, xp: 60, inputs: { star_fragment: 1, coal: 2 },   outputs: { starmetal_bar: 1 } });

addRecipe({ id: 'cook_minnow', skill: 'cooking', level: 1,  xp: 5,  inputs: { raw_minnow: 1 }, outputs: { minnow: 1 }, burn: true });
addRecipe({ id: 'cook_trout',  skill: 'cooking', level: 10, xp: 12, inputs: { raw_trout: 1 },  outputs: { trout: 1 },  burn: true });
addRecipe({ id: 'cook_pike',   skill: 'cooking', level: 20, xp: 22, inputs: { raw_pike: 1 },   outputs: { pike: 1 },   burn: true });

// Generate gear items + smithing recipes for every tier.
for (const t of TIERS) {
  for (const g of GEAR) {
    const id = `${t.id}_${g.id}`;
    const inputs = { [`${t.id}_bar`]: g.bars };
    if (g.planks) inputs[t.plank] = g.planks;
    if (g.extra) Object.assign(inputs, g.extra);
    let value = 0;
    for (const k in inputs) value += ITEMS[k].value * inputs[k];
    const item = { name: `${t.name} ${g.name}`, value: Math.round(value * 1.4), tier: t.tier, req: t.req };
    if (g.slot) { item.slot = g.slot; item.stats = g.stats(t.tier); }
    if (g.tool) item.tool = g.tool;
    if (g.id === 'sword') item.sword = true;
    ITEMS[id] = item;
    addRecipe({ id, skill: 'smithing', level: t.req + g.off, xp: t.barXp * g.bars, inputs, outputs: { [id]: 1 } });
  }
}

const MONSTERS = {
  goblin: { name: 'Goblin', ch: 'g', cls: 'goblin', level: 2,  hp: 5,  atk: 1,  def: 1,  maxHit: 1, speed: 2400, move: 700, aggressive: false,
            coins: [1, 8],  drops: [['goblin_trinket', 1 / 8], ['rough_gem', 1 / 40]] },
  wolf:   { name: 'Wolf',   ch: 'w', cls: 'wolf',   level: 7,  hp: 12, atk: 6,  def: 4,  maxHit: 2, speed: 2000, move: 500, aggressive: true,
            coins: [0, 0],  drops: [['wolf_pelt', 1 / 2]] },
  bandit: { name: 'Bandit', ch: 'b', cls: 'bandit', level: 14, hp: 22, atk: 12, def: 10, maxHit: 4, speed: 2400, move: 600, aggressive: true,
            coins: [10, 40], drops: [['bandit_signet', 1 / 12], ['iron_bar', 1 / 8], ['rough_gem', 1 / 25]], threat: -8 },
  ogre:   { name: 'Ogre',   ch: 'O', cls: 'ogre',   level: 28, hp: 50, atk: 25, def: 20, maxHit: 7, speed: 3000, move: 900, aggressive: true,
            coins: [20, 60], drops: [['star_fragment', 1 / 4], ['ogre_tusk', 1 / 3], ['rough_gem', 1 / 10]] },
};

// Worker camps out in the wilds (gatherers). Vulnerable to bandit raids.
const CAMPS = {
  lumber:  { name: 'Lumber Camp',  site: 'L', skill: 'woodcutting', danger: 1.0, cost: { gold: 60 } },
  mine:    { name: 'Mining Camp',  site: 'M', skill: 'mining',      danger: 1.2, cost: { gold: 120, pine_plank: 10 } },
  fishery: { name: 'Fishing Hut',  site: 'P', skill: 'fishing',     danger: 0.8, cost: { gold: 90,  pine_plank: 8 } },
};

// Refineries inside the town walls (safe). Consume from and produce into your stores.
const WORKS = {
  sawmill:    { name: 'Sawmill Works',  skill: 'carpentry', cost: { gold: 250, copper_bar: 10 } },
  smelter:    { name: 'Smelting Works', skill: 'smelting',  cost: { gold: 350, pine_plank: 25 } },
  smokehouse: { name: 'Smokehouse',     skill: 'cooking',   cost: { gold: 200, pine_plank: 15, copper_bar: 5 } },
  armoury:    { name: 'Armoury',        skill: 'smithing',  cost: { gold: 600, iron_bar: 15, pine_plank: 20 } },
};

const EMPIRE = {
  maxLevel: 5,
  ratePerWorker: 2,                  // items (or crafts) per minute per worker at level 1
  wage: { gatherer: 2, refiner: 3, guard: 4 }, // gold per minute
  campCap: lvl => 80 * lvl,
  maxWorkers: lvl => 2 * lvl + 1,
  maxGuards: lvl => lvl + 1,
  hireCost: n => 25 + 20 * n,
  guardCost: 40,
  guardPower: tier => 6 + 5 * tier,
  raidInterval: 120,                 // seconds between raid rolls
  offlineCapHours: 12,
};

// Raw goods the market will sell to you. Rare monster materials are never sold.
const BUYABLE = ['pine_log', 'oak_log', 'copper_ore', 'iron_ore', 'coal', 'raw_minnow', 'raw_trout', 'minnow', 'trout'];
