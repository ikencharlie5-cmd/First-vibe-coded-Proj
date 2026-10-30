// Static game data: skills, items, recipes, monsters, structures, towns and balance numbers.
'use strict';

const SKILLS = [
  { id: 'attack',       name: 'Attack',       group: 'combat' },
  { id: 'strength',     name: 'Strength',     group: 'combat' },
  { id: 'defence',      name: 'Defence',      group: 'combat' },
  { id: 'hitpoints',    name: 'Hitpoints',    group: 'combat' },
  { id: 'woodcutting',  name: 'Woodcutting',  group: 'gathering' },
  { id: 'mining',       name: 'Mining',       group: 'gathering' },
  { id: 'fishing',      name: 'Fishing',      group: 'gathering' },
  { id: 'construction', name: 'Construction', group: 'building' },
  { id: 'crafting',     name: 'Crafting',     group: 'building' },
  { id: 'carpentry',    name: 'Carpentry',    group: 'refining' },
  { id: 'smelting',     name: 'Smelting',     group: 'refining' },
  { id: 'smithing',     name: 'Smithing',     group: 'refining' },
  { id: 'cooking',      name: 'Cooking',      group: 'refining' },
];

const MAX_LEVEL = 60;
// Total XP required to reach a level.
function xpForLevel(l) { return l <= 1 ? 0 : Math.round(40 * Math.pow(l - 1, 1.9)); }

const ITEMS = {
  stick:          { name: 'Stick',          value: 1 },
  stone:          { name: 'Stone',          value: 2 },

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

  // Hand-made and workbench gear
  stone_axe:      { name: 'Stone axe',      value: 5,   tool: 'axe',     tier: 0, req: 1 },
  stone_pickaxe:  { name: 'Stone pickaxe',  value: 5,   tool: 'pickaxe', tier: 0, req: 1 },
  fishing_rod:    { name: 'Fishing rod',    value: 12,  tool: 'rod',     tier: 0, req: 1 },
  wooden_club:    { name: 'Wooden club',    value: 10,  slot: 'weapon',  tier: 0, req: 1, stats: { acc: 4, str: 3 } },
  satchel:        { name: 'Satchel',        value: 60,  pack: 25 },
  leather_pack:   { name: 'Leather pack',   value: 180, pack: 60 },
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

// Gatherable map nodes. Bushes and loose stones need no tool and no skill.
const RESOURCES = {
  bush:     { name: 'Bush',          skill: null,          level: 1,  xp: 0,  item: 'stick',        deplete: 1,    respawn: 25, time: 1000 },
  pebbles:  { name: 'Loose stones',  skill: null,          level: 1,  xp: 0,  item: 'stone',        deplete: 1,    respawn: 25, time: 1000 },
  pine:     { name: 'Pine tree',     skill: 'woodcutting', level: 1,  xp: 8,  item: 'pine_log',     deplete: 0.25, respawn: 10, tool: 'axe' },
  oak:      { name: 'Oak tree',      skill: 'woodcutting', level: 10, xp: 18, item: 'oak_log',      deplete: 0.18, respawn: 18, tool: 'axe' },
  ironwood: { name: 'Ironwood tree', skill: 'woodcutting', level: 25, xp: 40, item: 'ironwood_log', deplete: 0.12, respawn: 30, tool: 'axe' },
  copper:   { name: 'Copper rock',   skill: 'mining',      level: 1,  xp: 9,  item: 'copper_ore',   deplete: 0.3,  respawn: 8,  tool: 'pickaxe', stone: 0.25 },
  iron:     { name: 'Iron rock',     skill: 'mining',      level: 10, xp: 20, item: 'iron_ore',     deplete: 0.3,  respawn: 14, tool: 'pickaxe', stone: 0.25 },
  coal:     { name: 'Coal rock',     skill: 'mining',      level: 20, xp: 30, item: 'coal',         deplete: 0.3,  respawn: 20, tool: 'pickaxe', stone: 0.25 },
  minnow:   { name: 'Minnow shoal',  skill: 'fishing',     level: 1,  xp: 6,  item: 'raw_minnow',   deplete: 0,    respawn: 0,  tool: 'rod' },
  trout:    { name: 'Trout pool',    skill: 'fishing',     level: 10, xp: 15, item: 'raw_trout',    deplete: 0,    respawn: 0,  tool: 'rod' },
  pike:     { name: 'Pike waters',   skill: 'fishing',     level: 20, xp: 28, item: 'raw_pike',     deplete: 0,    respawn: 0,  tool: 'rod' },
};

// Which station each crafting skill needs. Recipes marked `hand` can be made anywhere.
const SKILL_STATION = { crafting: 'workbench', carpentry: 'sawbench', smelting: 'furnace', smithing: 'anvil', cooking: 'campfire' };

const RECIPES = {};
function addRecipe(r) { RECIPES[r.id] = r; }

addRecipe({ id: 'stone_axe',     skill: 'crafting', level: 1,  xp: 10, hand: true, inputs: { stick: 1, stone: 2 }, outputs: { stone_axe: 1 } });
addRecipe({ id: 'stone_pickaxe', skill: 'crafting', level: 1,  xp: 10, hand: true, inputs: { stick: 1, stone: 2 }, outputs: { stone_pickaxe: 1 } });
addRecipe({ id: 'fishing_rod',   skill: 'crafting', level: 2,  xp: 14, inputs: { stick: 3, pine_log: 1 },        outputs: { fishing_rod: 1 } });
addRecipe({ id: 'wooden_club',   skill: 'crafting', level: 3,  xp: 16, inputs: { pine_log: 2 },                  outputs: { wooden_club: 1 } });
addRecipe({ id: 'satchel',       skill: 'crafting', level: 6,  xp: 40, inputs: { pine_plank: 4, stick: 6 },      outputs: { satchel: 1 } });
addRecipe({ id: 'leather_pack',  skill: 'crafting', level: 15, xp: 90, inputs: { wolf_pelt: 3, oak_plank: 2 },   outputs: { leather_pack: 1 } });

addRecipe({ id: 'pine_plank',     skill: 'carpentry', level: 1,  xp: 5,  inputs: { pine_log: 1 },     outputs: { pine_plank: 1 } });
addRecipe({ id: 'oak_plank',      skill: 'carpentry', level: 10, xp: 12, inputs: { oak_log: 1 },      outputs: { oak_plank: 1 } });
addRecipe({ id: 'ironwood_plank', skill: 'carpentry', level: 25, xp: 25, inputs: { ironwood_log: 1 }, outputs: { ironwood_plank: 1 } });

addRecipe({ id: 'copper_bar',    skill: 'smelting', level: 1,  xp: 6,  inputs: { copper_ore: 1 },             outputs: { copper_bar: 1 } });
addRecipe({ id: 'iron_bar',      skill: 'smelting', level: 10, xp: 14, inputs: { iron_ore: 1 },               outputs: { iron_bar: 1 } });
addRecipe({ id: 'steel_bar',     skill: 'smelting', level: 20, xp: 25, inputs: { iron_ore: 1, coal: 2 },      outputs: { steel_bar: 1 } });
addRecipe({ id: 'starmetal_bar', skill: 'smelting', level: 30, xp: 60, inputs: { star_fragment: 1, coal: 2 }, outputs: { starmetal_bar: 1 } });

addRecipe({ id: 'cook_minnow', skill: 'cooking', level: 1,  xp: 5,  inputs: { raw_minnow: 1 }, outputs: { minnow: 1 }, burn: true });
addRecipe({ id: 'cook_trout',  skill: 'cooking', level: 10, xp: 12, inputs: { raw_trout: 1 },  outputs: { trout: 1 },  burn: true });
addRecipe({ id: 'cook_pike',   skill: 'cooking', level: 20, xp: 22, inputs: { raw_pike: 1 },   outputs: { pike: 1 },   burn: true });

// Generate metal gear items + smithing recipes for every tier.
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

// Price category for each item, used by town markets.
function itemCategory(id) {
  const it = ITEMS[id];
  if (it.rare) return 'rare';
  if (it.heal) return 'food';
  if (it.slot) return 'gear';
  if (it.tool || it.pack) return 'tools';
  if (id.endsWith('_log')) return 'logs';
  if (id.endsWith('_plank')) return 'planks';
  if (id.endsWith('_ore') || id === 'coal') return 'ore';
  if (id.endsWith('_bar')) return 'bars';
  if (id.startsWith('raw_')) return 'fish';
  return 'basic';
}

const MONSTERS = {
  goblin: { name: 'Goblin', level: 2,  hp: 5,  atk: 1,  def: 1,  maxHit: 1, speed: 2400, move: 700, aggressive: false,
            coins: [1, 8],   drops: [['goblin_trinket', 1 / 8], ['rough_gem', 1 / 40]] },
  wolf:   { name: 'Wolf',   level: 7,  hp: 12, atk: 6,  def: 4,  maxHit: 2, speed: 2000, move: 450, aggressive: true,
            coins: [0, 0],   drops: [['wolf_pelt', 1 / 2]] },
  bandit: { name: 'Bandit', level: 14, hp: 22, atk: 12, def: 10, maxHit: 4, speed: 2400, move: 550, aggressive: true,
            coins: [10, 40], drops: [['bandit_signet', 1 / 12], ['iron_bar', 1 / 8], ['rough_gem', 1 / 25]], threat: -8 },
  ogre:   { name: 'Ogre',   level: 28, hp: 50, atk: 25, def: 20, maxHit: 7, speed: 3000, move: 800, aggressive: true,
            coins: [20, 60], drops: [['star_fragment', 1 / 4], ['ogre_tusk', 1 / 3], ['rough_gem', 1 / 10]] },
};

// Everything the player can build. `con` is the Construction level needed; `work` is how
// many seconds of hammering it takes. Levels go up to 3; upgrades cost (level + 1) x materials.
const STRUCTS = {
  workbench:   { name: 'Workbench',    size: 1, con: 1,  work: 4,  cost: { pine_log: 4, stick: 4 },
                 station: 'crafting', desc: 'Craft rods, clubs and packs.' },
  campfire:    { name: 'Campfire',     size: 1, con: 1,  work: 3,  cost: { pine_log: 3, stone: 4 },
                 station: 'cooking', workers: [1, 2, 3], desc: 'Cook fish into food. Workers can cook for you.' },
  sawbench:    { name: 'Sawbench',     size: 1, con: 2,  work: 5,  cost: { pine_log: 8, stone: 4 },
                 station: 'carpentry', workers: [1, 2, 3], desc: 'Saw logs into planks.' },
  storehouse:  { name: 'Storehouse',   size: 2, con: 3,  work: 8,  cost: { pine_plank: 12, stone: 10 },
                 storage: [250, 500, 900], desc: 'Stores goods. Workers deliver here and stations nearby draw from it.' },
  furnace:     { name: 'Furnace',      size: 1, con: 4,  work: 7,  cost: { stone: 20, pine_plank: 4 },
                 station: 'smelting', workers: [1, 2, 3], desc: 'Smelt ore into metal bars.' },
  house:       { name: 'Cottage',      size: 2, con: 5,  work: 9,  cost: { pine_plank: 20, stone: 12 },
                 housing: [3, 5, 8], desc: 'Beds for workers and guards. You also respawn here.' },
  anvil:       { name: 'Anvil',        size: 1, con: 7,  work: 6,  cost: { copper_bar: 5, pine_plank: 4, stone: 6 },
                 station: 'smithing', workers: [1, 2, 3], desc: 'Smith metal tools, weapons and armour.' },
  lumber_camp: { name: 'Lumber Camp',  size: 2, con: 8,  work: 9,  cost: { pine_plank: 15, copper_axe: 1 },
                 gather: 'woodcutting', workers: [2, 4, 6], desc: 'Workers chop the trees around it. Build it in a forest.' },
  dock:        { name: 'Fishing Dock', size: 2, con: 9,  work: 9,  cost: { pine_plank: 25, fishing_rod: 2 },
                 gather: 'fishing', workers: [2, 4, 6], nearWater: true, desc: 'Workers fish nearby spots. Must touch water.' },
  mine:        { name: 'Mine',         size: 2, con: 10, work: 10, cost: { pine_plank: 20, stone: 10, copper_pickaxe: 1 },
                 gather: 'mining', workers: [2, 4, 6], desc: 'Workers mine the rocks around it.' },
  guard_tower: { name: 'Guard Tower',  size: 1, con: 12, work: 12, cost: { stone: 40, oak_plank: 8, iron_bar: 4 },
                 guards: [2, 3, 4], desc: 'Guards protect everything within 14 tiles from bandit raids.' },
};
const STRUCT_MAX_LEVEL = 3;

// Trading towns. buy = what the town pays relative to base value, per category.
// sells = goods its market stocks; markup = how much more you pay than base value.
const TOWNS = {
  ironhold:  { name: 'Ironhold',   kind: 'capital',  desc: 'The royal capital. Fair prices for everything.',
               buy: {}, markup: 1.5,
               sells: ['stick', 'stone', 'pine_log', 'copper_ore', 'raw_minnow', 'minnow', 'pine_plank'] },
  stonedeep: { name: 'Stonedeep',  kind: 'mining',   desc: 'A mining town high in the mountains. Hungry for food and timber.',
               buy: { food: 1.6, planks: 1.45, logs: 1.3, tools: 1.25, ore: 0.7, bars: 0.85 }, markup: 1.2,
               sells: ['stone', 'copper_ore', 'iron_ore', 'coal', 'copper_bar', 'iron_bar'] },
  saltmere:  { name: 'Saltmere',   kind: 'fishing',  desc: 'A fishing village on the southern coast. Pays well for boat timber and metal.',
               buy: { planks: 1.5, bars: 1.3, tools: 1.3, fish: 0.6, food: 0.7 }, markup: 1.2,
               sells: ['raw_trout', 'raw_pike', 'trout', 'pike', 'fishing_rod'] },
  thornwood: { name: 'Thornwood',  kind: 'forest',   desc: 'A lodge deep in the western forest. Rich in timber, short of metal.',
               buy: { bars: 1.4, gear: 1.3, food: 1.3, ore: 1.2, logs: 0.6, planks: 0.8 }, markup: 1.2,
               sells: ['pine_log', 'oak_log', 'ironwood_log', 'pine_plank', 'oak_plank'] },
  ratsnest:  { name: "Rat's Nest", kind: 'black',    desc: 'A bandit black market in the badlands. Pays a fortune for rare goods, no questions asked.',
               buy: { rare: 1.9, gear: 1.2, default: 0.75 }, markup: 2.2,
               sells: ['star_fragment', 'wolf_pelt', 'rough_gem', 'steel_bar'] },
};

const EMPIRE = {
  ratePerWorker: 2,                    // items or crafts per minute per worker at level 1
  wage: { worker: 2, guard: 4 },       // gold per minute
  hireCost: n => 30 + 15 * n,
  guardCost: 40,
  guardPower: tier => 6 + 5 * tier,
  towerRadius: 14,
  gatherRadius: 7,
  storeRadius: 20,                     // stations within this range of a storehouse can use its goods
  raidInterval: 150,                   // seconds between raid rolls
  offlineCapHours: 12,
  packBase: 40,
};
