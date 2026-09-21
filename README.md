# MAZE

Draw a maze from above, then walk into it in first person and try to get out alive — alone,
or online with up to three friends.

**Play online:** https://stegopets.com/maze/ (the "Maze" tab on stegopets.com).

**Solo, offline:** no build step, no dependencies, no server: double-click `index.html`. Every
texture, sprite and sound is generated in code at load time, so the whole game is this one folder.
Online play needs the server (`npm install`, then `npm start`, then open http://127.0.0.1:3700/).

---

## The editor (2D, top down)

The left panel is the palette, the right panel tells you whether the maze is playable.
A maze needs a **Start P1** and one **Exit Portal** before `▶ TEST MAZE` and `⚑ PLAY ONLINE` unlock.
**Start P2–P4** are optional: they set where players 2–4 spawn online, and anyone without their own
start spawns beside player 1. The inspector lists each start's steps to the exit and warns when a race
would be unfair.

| Action | How |
| --- | --- |
| Paint | Left-drag |
| Erase | Right-drag (removes the thing first, then the wall) |
| Pick what is under the cursor | Alt-click, or the Pick tool |
| Cycle palette | Scroll over the canvas |
| Tools | `B` brush · `L` line · `R` rect · `F` fill · `X` eraser · `P` pick |
| Wall types | `1`–`6`, `0` for floor |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` |
| Save / test | `Ctrl+S` / `Enter` |

**Generate** builds a random maze: a carved maze with extra loops knocked through it, a few
rooms, the exit placed at the farthest reachable point, then items, blobs, secrets, a
locked door with its key stashed somewhere you can actually reach first, and up to three more
player starts about as far from the exit as player 1, so a race starts fair.

Mazes save to browser storage, or export to a `.json` file you can hand to someone else.

### Maze codes

Every maze has a **maze code**, shown in the inspector: six characters that are a hash of the
layout (size, walls and everything placed; not the name). The same maze always has the same code,
and any edit gives it a new one. **Share** puts the maze on the server and copies a link
(`…/maze/?maze=K7Q2XP`); anyone can open it in their editor from that link, or by typing the code
into *Play Online → Open a maze by its code*.

### What you can place

**Walls** — Brick, Stone and Mossy are cosmetic variants. Three do something:

- **Secret wall** — looks exactly like the surrounding stonework from inside the maze. You
  walk straight through it; blobs cannot follow. Worth 300 points when you find one.
- **Locked door** — needs the Key. Walk up and press `E`.
- **Glass wall** — see through it, but you still cannot walk through it.

**Weapons** — Sword (42 dmg, wide arc), Bow (55 dmg, spends arrows), Shield (blocks 75% of
damage from the front), Arrows.

**Items** — Health Potion (+45, and it politely stays put if you are already at full health),
Key, Swift Boots (+40% speed), Torch (roughly doubles how far you can see), Treasure (score).

**Enemies** — all three hunt you through the maze rather than wandering:

| | Health | Speed | Damage | Notes |
| --- | --- | --- | --- | --- |
| Blob | 60 | 1.55 | 9 | You can outwalk it. Dangerous in packs and dead ends. |
| Sprinter | 35 | 3.45 | 7 | Faster than you walk — you have to sprint. Dies fast. |
| Brute | 165 | 1.2 | 20 | Slow, huge, hits like a truck. |

Blobs use a breadth-first flow field that is rebuilt around you five times a second, so they
route around corners instead of bumping into walls, and follow you up and down stairs. They
amble until they see or hear you, then commit. Opening a door opens it for them too.

**Magic** — six scrolls (Fireball, Frost Shard, Heal, Chain Lightning, Blink, Ward) and Mana
Potions. See *Levels and magic* below.

### Floors, stairs and ladders

A maze can be up to **4 floors** high; the tabs above the canvas switch between them, and the floor
below shows faintly underneath so you can line things up. Place **Stairs Up** or a **Ladder Up** on
the lower floor: its way down appears in the same cell on the floor above (adding that floor if it
does not exist yet), and erasing either end removes both. **Generate** takes a **Floors** count and
joins the floors with stairs placed far from where you arrive, with the exit on the top floor.
In the maze, stand on the stairs and press `E`. Stairwells and trapdoors are cut into the floor,
and there is an opening in the ceiling above every way up.

### Monster Maker

Under **Enemies**, `＋ Monster Maker` designs your own monster: a body (slime, spider, goblin, orc,
skeleton, bat or ghost), three colours, size, health, speed, damage, attack rate, sight range, and
one special ability:

| Ability | |
| --- | --- |
| Spits | Keeps its distance and lobs globs at you. |
| Poison | Bites poison you for a few seconds (a heal or a potion cures it). |
| Regenerates | Heals itself steadily. |
| Splits | Bursts into two smaller, faster copies when killed. |
| Explodes | Charges in and blows up, hurting everyone near. |
| Drains life | Heals itself with every bite. |

The live preview shows it animating next to an adventurer for scale, with its danger rating, XP,
and how many sword hits it takes. **🎲 Surprise me** rolls a random one. Monsters are saved in a
library in your browser's storage (it survives closing the tab) and appear in the palette;
double-click one there to edit it. A maze carries a copy of every custom monster it uses, so
exported files, shared maze codes and online rooms bring them along, and monsters in a maze you
open join your own library.

---

## Test mode (3D, first person)

| | |
| --- | --- |
| Move | `W` `A` `S` `D`, `Shift` to sprint (costs stamina) |
| Look | Mouse (click the view to capture it) |
| Attack / block | Left click / hold right click |
| Weapons | `1` fists · `2` sword · `3` bow · `4` magic, or the scroll wheel |
| Next spell | `R` (`Shift+R` back) |
| Character sheet | `C`: stats, spells, scrolls, drop items |
| Open door / climb stairs | `E` |
| Map | `Tab` or `M` |
| Pause | `Esc` |

The minimap only fills in what you have actually seen on your floor, and only shows monsters when
they are close. Score comes from treasure, kills, secrets, the door, your remaining health and how
fast you got out.

### Levels and magic

Defeating monsters earns **XP** (custom monsters are worth more the nastier they are); in co-op the
rest of the team learns a quarter of it too. Each level (up to 20) gives a **stat point** and a
second wind. Spend points in the character sheet (`C`, or `1`–`5` while it is open):

| Stat | Per point |
| --- | --- |
| Attack | +10% damage with every weapon and spell |
| Speed | +5% movement speed |
| Defense | −7% damage taken (up to 60%) |
| Health | +15 maximum health |
| Mana | +20 mana, faster mana regen, +8% spell power, and it unlocks stronger spells |

**Scrolls** go into your bag when you walk over them; learn them from the character sheet. Tier 2
spells need 2 points in Mana and tier 3 need 4, so a party can have a dedicated mage. **Any item
you carry can be dropped** from the sheet (it lands in front of you), so the fighter who finds a
Chain Lightning scroll can leave it for the mage. Press `4` for the magic hand; left click casts.

| Spell | Tier | Mana | |
| --- | --- | --- | --- |
| Fireball | 1 | 15 | Bursts on impact, hurting everything close. |
| Frost Shard | 1 | 12 | Fast; slows what it hits. |
| Heal | 1 | 22 | Heals you and cures poison; in co-op, teammates within 3 tiles too. |
| Chain Lightning | 2 | 26 | Instant; jumps to two more foes. |
| Blink | 2 | 18 | Teleports you forward up to 4.5 tiles. |
| Ward | 3 | 30 | Halves all damage for 6 seconds. |

In competitive mode, spells hit rivals too, and anything you carry (scrolls included) spills
where you fall. Your level and learned spells stay with you.

---

## Online (up to 4 players)

**Host:** build or generate a maze, press `⚑ PLAY ONLINE`, pick a name and a mode, and press
*Create room*. You get a 5-letter **room code** and a *Copy invite link* button
(`…/maze/?room=ABCDE`). The lobby shows the maze, its code, the four seats and where each will
spawn. The host picks the mode, can swap in whatever is in their editor (*Edit maze* leaves the
room open; the **Room** button in the top bar goes back), and presses **START**.

**Join:** open the invite link, or press `⚑ PLAY ONLINE` and type the room code. Anyone who
joins while a match is running plays from the next round.

**Spectate:** the maze's maker can pick *I'll spectate* in the lobby (the button becomes
**START & WATCH**) to run the match without playing in it. Spectators see everything:

| | |
| --- | --- |
| Overhead map | One floor of the maze with its real wall textures, stairs, and the secret walls marked. Every player shows as an icon in their colour, with the direction they face, their name, level and health. Monsters, items, arrows, spells and pings show live. A side panel has a button per floor (with how many players are on each) and lists everyone's health, level, floor, weapon and status. |
| Player view | Click a player (on the map or in the list), or press `1`–`4`, to see through their eyes on whatever floor they are on, with their health, weapon, torchlight and minimap. |
| Controls | `Tab` / `M` switches overhead ↔ player view · `PgUp` `PgDn` (or the wheel, or the floor buttons) change floor · `←` `→` or a click cycles players · `Esc` opens the menu (end the match, or leave). |

| Mode | |
| --- | --- |
| **Co-op** | No friendly fire. The key opens doors for the whole team. A fallen player can be revived by a teammate holding `E` beside them for 1.6 s (back at 40 health); otherwise they respawn at their start after 14 s. Everyone has to reach the exit. If everyone is down at once and nobody is out, the party is wiped. |
| **Competitive** | Swords, arrows and fists hurt players too (at 60% of their damage to blobs, so fights last a few blows). Knocking someone out is worth 400 points. Whatever they carried (key, weapons, arrows, shield, boots, torch) drops where they fell, and they respawn at their own start with fists after 5 s, with 2 s of spawn protection. **The first one through the exit wins.** |

Blobs hunt whichever player is nearest by path. Everyone sees each other in the maze as a hooded
adventurer in their seat colour, with a name tag and health bar. There's a roster under the
minimap. `F` (or middle click) **pings** the spot you are looking at for everyone. In co-op,
teammates always show on the minimap; in competitive, rivals only show when they are close.

### How the network works

The server runs the world. `js/sim.js` holds every rule: blobs, arrows, items, doors, combat,
respawns, who wins. The browser runs that same file for solo play, and `server.js` loads it (via
`core.js`) for online rooms, so both play by identical rules. Online, each client moves its own
player (so controls feel instant) and sends its position twenty times a second. The server
refuses moves through walls or faster than a sprint with boots, and sends a correction instead.
It runs everything else at 20 ticks a second and sends each player a compact snapshot plus
events: blobs, arrows and other players, plus that player's own health and inventory. Clients
draw other bodies about 110 ms in the past, smoothly between snapshots. Arrows are carried
forward instead, because they fly straight. Dropping out mid-match is handled: you reconnect to
the same seat, and while you are away the blobs ignore you.

Rooms use the same protocol as 9-5, Sima and White Room: a same-origin WebSocket at `./ws`, a
persistent player id in localStorage, `create`/`join`, and `room`/`lobby`/`error` replies.
Shared mazes are stored one file per code in `DATA_DIR/mazes/`.

---

## How it is put together

```
index.html          markup + script order
css/style.css
js/util.js          maths, seeded RNG, storage, pixel helpers
js/defs.js          every wall and thing type, player colours, modes: the single source of truth
js/textures.js      procedural 64x64 wall/floor textures
js/sprites.js       procedural sprites (incl. the players, 4 views each), reused as palette icons
js/audio.js         WebAudio synthesis, no audio files
js/level.js         level model, maze generator, validator, maze codes, save/load
js/sim.js           the world rules (monsters, floors, combat, levels, spells); page and server
js/character.js     the character sheet: stats, spellbook, scrolls, dropping items
js/monsters.js      the Monster Maker and your saved monster library
js/editor.js        the 2D editor
js/raycaster.js     the 3D renderer
js/entities.js      views of blobs, arrows, pickups and other players; smoothing; particles
js/hud.js           weapon viewmodel, vitals, minimap, name tags, roster, pings
js/game.js          your player, camera, input; turns sim events into sights and sounds
js/net.js           room-code WebSocket client, maze share/fetch
js/online.js        host/join dialog, lobby, invite links, results
js/main.js          boot and menus

server.js           static files, maze store (/m), rooms and the 20 Hz world at /ws
core.js             loads js/util, defs, level, sim into Node
tests/              node --test: rules (sim.test.js) and the server end to end (server.test.js)
tools/browser-test.js   two headless Chromes: solo, file://, host, invite link, match, combat, spectate
tools/features-test.js  monster maker + library, floors, levels, spells, drops, multi-floor spectating
tools/sprite-sheet.js   renders every procedural sprite onto one sheet
deploy.ps1, deploy/     ship to the stegopets droplet (see below)
```

### Tests

```
npm test                      rules + server relay (30 tests)
node tools/browser-test.js    the real page in two headless Chromes (screenshots in tools/shots/)
node tools/features-test.js   the newer systems end to end (set MAZE_URL to test the live site)
```

### Hosting

It is live on the stegopets droplet, next to 9-5, Sima and White Room: systemd unit `maze` as user
`maze` on `127.0.0.1:3700`, files in `/opt/maze`, shared mazes in `/var/lib/maze`, and a Caddy
`handle /maze/*` block with its own CSP. The homepage has a "Maze" tab after White Room.
`powershell -File deploy.ps1` runs the tests, uploads, runs `deploy/setup.sh` (idempotent: it
backs up the Caddyfile and homepage before touching them, validates Caddy and rolls back on
failure), then runs `deploy/test-live.js` against the live site.

The renderer is a software raycaster: DDA per screen column for textured walls, per-row
floor and ceiling casting, depth-sorted billboards for everything else, all written into one
`Uint32Array` and blitted once per frame. Because that is fill-rate bound, the internal
buffer is capped at ~620k pixels and scaled up by the browser; a small adaptive controller
trims it further if frames run long, so it stays smooth on slow machines and does not melt
on a 4K display. Measured on this machine: ~5.6 ms per frame at 640×360, ~12.6 ms at 960×540.

Scripts are plain `<script>` tags rather than ES modules on purpose — modules are blocked by
CORS over `file://`, and this should run by double-clicking.
