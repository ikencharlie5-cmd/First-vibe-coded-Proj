# Ironhold: a 3D medieval refinement empire

A single-player browser game. You wake beside a campfire in a quiet clearing with nothing
but the clothes on your back. Gather sticks and stones, craft your first tools, build your
own settlement anywhere in the world, hire workers, trade between towns, climb Mount
Skyhorn, and grow into a medieval industrial empire.

The world is a low-poly 3D landscape drawn with [three.js](https://threejs.org/), which is
bundled in `js/lib/`. It's plain HTML, CSS and JavaScript with no build step, so it runs on
GitHub Pages or by opening `index.html` in a browser. It's made for keyboard and mouse.

## Controls

| Input | Action |
| --- | --- |
| W A S D / arrows | Walk (relative to the camera) |
| Shift | Run |
| Drag the mouse | Swing the camera around you |
| Mouse wheel | Zoom |
| E or click | Use what's in front of you: gather, attack, trade, talk, build, launch or beach your boat |
| Space | Dodge roll (you can't be hit mid-roll) |
| Q (hold) | Block: much stronger with a shield |
| R | Weapon special: Shove, Whirlwind or Frost Nova |
| Z | Ride your horse |
| F | Eat food |
| X | Cycle combat style (Attack / Strength / Defence) |
| B | Build menu |
| C | Hand crafting |
| I | Pack and gear |
| K | Skills |
| G | Empire overview |
| J | Quest log and journal |
| O | Achievements and bestiary |
| M | World map |
| H | Help |
| Esc | Close a panel, cancel placing a building, or open settings |

## How it plays

1. **Start from nothing.** Gather sticks from bushes and stones from loose stones, then
   hand-craft a stone axe and pickaxe.
2. **Build your settlement wherever you like.** Pick a structure from the build menu,
   click the ground to place it, then hammer it together with E. This trains
   **Construction**, which unlocks bigger buildings: workbench, campfire, sawbench,
   storehouse, furnace, cottage, anvil, lumber camp, fishing dock, mine and guard tower.
   Every building can be upgraded to level 3.
3. **Refine.** Saw logs into planks, smelt ore into bars, smith metal tools, weapons and
   armour, and cook fish. Better tools gather faster.
4. **Automate.** Cottages give beds for workers. Lumber camps, mines and docks gather from
   the resources around them, so where you build matters. Stations with workers refine
   automatically. Everything flows through your storehouse, and work continues while
   you're away (up to 12 hours).
5. **Trade.** Eight towns, each with its own prices and goods:
   - **Ironhold**, the capital, has fair prices for everything.
   - **Stonedeep**, a mining town in the northern mountains, is hungry for food and timber.
   - **Saltmere**, a fishing village on the south coast, pays well for planks and metal.
   - **Thornwood**, a lodge in the western forest, is rich in timber and short of metal.
   - **Rat's Nest**, a bandit black market in the eastern badlands, pays a fortune for rare loot.
   - **Gloomwater**, a stilt village deep in Blackmire Marsh, is short of metal and tools.
   - **Amberreach**, an adobe oasis town in the Amber Wastes, pays well for timber, food and fish, and sells gold.
   - **Frosthollow**, a snowbound timber town in the far north, needs food, metal and armour to survive the cold.
   Prices drift, and towns post big orders and gluts. Once you've visited a town, its
   carriage can take you back.
6. **Fight and defend.** Goblins and wolves roam the meadows and forest, bandits hold the
   badlands, and ogres haunt the frozen highlands past Stonedeep. Further out, bog lurkers
   stalk the marsh, sand scorpions the desert, snow bears the taiga and pirates the
   Corsair Isles. Monster drops (wolf
   pelts, star fragments and more) can't be gathered any other way. Bandits raid camps and
   storehouses, so smith swords and build guard towers.

**Explore.** The world has eight regions: the Meadowlands, Thornwood Forest, the Badlands,
the Frost Highlands, Blackmire Marsh, the Amber Wastes, the Frostpine Taiga and the Corsair
Isles, which are linked by a chain of bridges. Ruins and abandoned camps hide treasure chests, shrines heal
you, and signposts point the way between towns. New ground brings new resources: bog iron in
the marsh, gold in the desert and frostwood in the taiga, which you can turn into gold rings
and an explorer's pack. Mount Skyhorn's spiral trail leads to a summit with starstone veins,
guarded by a Frost Drake.

**Dungeons.** Two dungeons wait underground: the Sunken Crypt, under the marsh, full of
skeletons and ruled by the Crypt Lord, and Frostdeep Cavern, under the taiga, home to cave
trolls and the Frost Wurm. They are dark, torchlit halls, and each boss guards a hoard.

**The Long Winter.** Each winter is longer than the last. The Royal Herald in Ironhold sends you north to
Frosthollow, where Elder Ysolde blames something stirring beneath the ice. To end the winter you must
recover the three relics of the Firstsmiths (from the Crypt Lord, the Buried Temple and the Frost Drake),
wake the ancient Firstforge at the foot of Mount Skyhorn to make the blade Frostbane, and slay the Frost
Wurm. The world changes as the story goes on: snow creeps south until it reaches Ironhold, northern lakes
freeze solid enough to walk on, and Frosthollow pays a fortune for food. The thaw brings spring flowers
everywhere. In a side story, the Bandit King of Rat's Nest demands a toll: pay it and the raids stop,
or refuse and face him at the Red Stones. Your quest is shown under your stats, a gold star on the map
marks the way, and **J** opens the quest log and journal.

**Caravans.** A Trading Post sends covered wagons along the roads to any town you've visited. Each one
sells a load from your storehouse at that town's prices and can spend the takings on goods to bring
home. Set them to repeat and they run trade routes for you, even while you're away. Bandits may ambush
them, so hire caravan guards, or deal with the Bandit King.

**Your own town.** Once your settlement has 6 townsfolk and 8 buildings, build a Town Hall and name your
town. It appears on the map with its own market and carriage stop, settlers stroll its streets, and your
townsfolk pay taxes. Walls and gates, from wooden palisades up to stone, help your guards fight off raids.

**Combat.** Fights use stamina (the gold bar under your health). Roll out of the way of attacks, hold
Q to block (a shield blocks most of a hit), and use your weapon's special: a Shove that stuns, a
sword Whirlwind that hits everything around you, or Frostbane's Frost Nova that freezes. Big
monsters and bosses wind up special attacks, marked by red shapes on the ground: ogre and troll
slams, the Frost Drake's and Frost Wurm's breath, the Crypt Lord's death nova and summoned
skeletons, and the Bandit King's whirling blades. Roll out of the red, or block and take less.

**Seasons, horses and pets.** Every three days the season turns: spring blossom, summer sun, autumn
leaves and rain, winter frost and snow (when food prices rise). Buy a horse in Ironhold or
Frosthollow and press Z to ride. A hound bites at whatever you fight, a cat finds you coins, and a
rare wolf pup (dropped by wolves) fights fiercest of all. Click a pet in your pack to bring it along.

**Achievements and bestiary.** Press O for 29 achievements, and a bestiary that fills in with each
monster you meet: where it lives, what it drops, and which special attacks to watch for.

**Sailing.** Craft a sailboat (Crafting 18) or buy one in Saltmere. Face open water and press **E** to
launch it. Boats are fast, can reach fishing spots far from shore, and keep you safe from monsters.

**A living world.** Grass, wildflowers, reeds and mushrooms cover the land. Deer, rabbits
and birds roam, and fish jump in the lakes. A 20-minute day/night cycle brings starry nights
with glowing windows and lamps, and the weather turns to rain or fog. Towns bustle with
townsfolk, patrolling guards, market stalls and penned animals, and your workers carry goods
to your storehouse.

**Sound.** The music is generated live in your browser: lute, flute and drone in a calm
medieval style that shifts between the wilds, towns, night and combat. Every action has a
sound effect, and the ambience follows you: wind, birds, crickets, water, rain, fire and
town chatter. Volumes and graphics quality (Low / Medium / High) are in the settings (Esc).

Progress saves to your browser's localStorage every 15 seconds and when you leave.

## Play it on GitHub Pages

1. On GitHub, open the repository and go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Pick the branch with the game and the `/ (root)` folder, then click **Save**.
4. After a minute or two the game is live at `https://<your-username>.github.io/<repository-name>/`.

Every push to that branch redeploys automatically. On a free GitHub plan, Pages only works
for public repositories.

## Play locally

Open `index.html` in any modern browser, or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Code layout

- `index.html`: page structure and HUD
- `style.css`: HUD and panel styling
- `js/data.js`: all tunable game data (items, recipes, monsters, buildings, towns, balance numbers)
- `js/world.js`: the hand-designed map: biomes, mountains, Mount Skyhorn, rivers, lakes, coast, islands, roads, towns, town props, ruins, dungeons and resource placement
- `js/audio.js`: generated music, sound effects and ambience (Web Audio API, no audio files)
- `js/icons.js`: item icons drawn on canvas, and the interface's SVG icons
- `js/story.js`: the Long Winter story and the Bandit King side quest: quests, dialogue and world changes
- `js/caravans.js`: trade caravans and founding your own town
- `js/combat.js`: stamina, dodging, blocking, weapon specials and monster special attacks
- `js/extras.js`: seasons, horses, pets, achievements and the bestiary
- `js/game.js`: game logic: movement, gathering, crafting, building, combat, markets, workers, raids, saving and UI panels
- `js/render3d.js`: the 3D world: terrain, water, sky, weather, day/night, trees, grass, wildlife, towns, buildings, characters, effects and the orbit camera
- `js/lib/three.min.js`: three.js r149 (MIT licence, see `js/lib/THREE-LICENSE`)
