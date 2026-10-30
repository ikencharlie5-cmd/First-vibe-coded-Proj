# Ironhold: a 3D medieval refinement empire

A single-player browser game. You arrive in the capital with nothing but the clothes on
your back. Gather sticks and stones, craft your first tools, build your own settlement
anywhere in the world, hire workers, trade between towns, and grow into a medieval
industrial empire.

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
| E or click | Use what's in front of you: gather, attack, trade, build, open a building |
| F | Eat food |
| X | Cycle combat style (Attack / Strength / Defence) |
| B | Build menu |
| C | Hand crafting |
| I | Pack and gear |
| K | Skills |
| G | Empire overview |
| M | World map |
| H | Help |
| Esc | Close a panel or cancel placing a building |

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
5. **Trade.** Five towns, each with its own prices and goods:
   - **Ironhold**, the capital, has fair prices for everything.
   - **Stonedeep**, a mining town in the northern mountains, is hungry for food and timber.
   - **Saltmere**, a fishing village on the south coast, pays well for planks and metal.
   - **Thornwood**, a lodge in the western forest, is rich in timber and short of metal.
   - **Rat's Nest**, a bandit black market in the eastern badlands, pays a fortune for rare loot.
   Prices drift, and towns post big orders and gluts. Once you've visited a town, its
   carriage can take you back.
6. **Fight and defend.** Goblins and wolves roam the meadows and forest, bandits hold the
   badlands, and ogres haunt the frozen highlands past Stonedeep. Monster drops (wolf
   pelts, star fragments and more) can't be gathered any other way. Bandits raid camps and
   storehouses, so smith swords and build guard towers.

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
- `js/world.js`: the hand-designed map: mountains, rivers, lakes, coast, roads, towns and resource placement
- `js/game.js`: game logic: movement, gathering, crafting, building, combat, markets, workers, raids, saving and UI panels
- `js/render3d.js`: the 3D world: terrain, water, trees and rocks, buildings, characters, effects and the orbit camera
- `js/lib/three.min.js`: three.js r149 (MIT licence, see `js/lib/THREE-LICENSE`)
