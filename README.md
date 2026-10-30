# Ironhold: a 3D medieval refinement empire

A single-player browser game. You start as one peasant with a worn axe and grow into
a medieval industrial empire: gather, refine, sell, hire workers, build works, and
fight off the monsters and bandits of the wilds.

The world is a low-poly 3D landscape drawn with [three.js](https://threejs.org/), which is
bundled in `js/lib/`. It's plain HTML, CSS and JavaScript with no build step, so it runs on
GitHub Pages or by opening `index.html` in a browser.

## How to play

| Key | Action |
| --- | --- |
| Click / tap | Walk there. Click a tree, rock, building or monster to go and use it. |
| Arrows / WASD | Move one step. Walk into things to interact with them. |
| Mouse wheel, + / - | Zoom |
| F | Eat food |
| C | Cycle combat style (Attack / Strength / Defence) |
| E | Open the empire panel |
| ? | Help and legend |
| Esc | Close a panel |

Hover over things to see what they are. On phones, tap to move or use the on-screen d-pad.

**The loop:**
1. **Gather** from trees, rocks (the coloured nuggets show the ore) and rippling fishing spots.
   The action repeats until you move. Woodcutting, Mining and Fishing level up as you go.
2. **Refine** in town: the Sawbench (logs to planks), Furnace (ore to bars),
   Anvil (bars to swords, shields, helms, platebodies, axes and pickaxes), and Cook fire.
   Carpentry, Smelting, Smithing and Cooking are separate skills.
3. **Sell** at the Market. Prices drift every 30 seconds, dumping a lot of one item
   pushes its price down, and random royal orders or gluts swing prices hard.
4. **Build** at the Guild Hall: camps out in the wilds gather for you, and works inside the
   walls refine for you. Each one appears on its labelled plot, with workers and guards you can see. Workers draw wages every minute.
5. **Defend:** bandit threat rises over time, and raids steal from camp stockpiles.
   Arm guards with swords you smith (a higher sword tier makes a stronger guard), and kill bandits to lower the threat.

**Combat:** goblins and wolves roam near town, bandits further out, and ogres in the deep
wilds. Attack, Strength, Defence and Hitpoints level from fighting. Gear you smith yourself
makes you stronger. Some materials only come from monsters: wolf pelts are needed for
platebodies, and ogre star fragments are smelted into starmetal, the top tier.

**Saving:** progress saves to your browser's localStorage every 15 seconds and when you
leave the page. When you come back, your workers' output and wages for the time you were
away are calculated (up to 12 hours). Camp stockpiles have a cap, so check in to collect.

## Play it on GitHub Pages

1. Merge this branch into your default branch (`main`). Or, in step 4, pick this branch instead.
2. On GitHub, open the repository and go to **Settings → Pages** (in the left sidebar under "Code and automation").
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Under **Branch**, select `main` and the `/ (root)` folder, then click **Save**.
5. Wait a minute or two. The page shows your URL, which looks like
   `https://<your-username>.github.io/<repository-name>/`.
   You can also watch the deploy in the repository's **Actions** tab.

Every push to that branch redeploys automatically.

Note: on a free GitHub plan, Pages only works for **public** repositories.

## Play locally

Open `index.html` in any modern browser. Or serve the folder:

```bash
python3 -m http.server 8000
```

then visit http://localhost:8000.

## Code layout

- `index.html`: page structure
- `style.css`: layout and UI styling
- `js/data.js`: all tunable game data (items, recipes, monsters, buildings, balance numbers)
- `js/game.js`: world generation, game loop, combat, market, empire simulation, click-to-move, saving and UI
- `js/render3d.js`: the 3D world: terrain, trees, rocks, buildings, characters, effects and camera
- `js/lib/three.min.js`: three.js r149 (MIT licence, see `js/lib/THREE-LICENSE`)

Most balancing happens in `js/data.js`. The `EMPIRE` object there holds worker rates, wages,
caps and raid timing.
