# MAZE

Draw a maze from above, then walk into it in first person and try to get out alive.

No build step, no dependencies, no server: **double-click `index.html`**. Every texture, sprite
and sound is generated in code at load time, so the whole game is this one folder.

---

## The editor (2D, top down)

The left panel is the palette, the right panel tells you whether the maze is playable.
A maze needs exactly one **Start** and one **Exit Portal** before `▶ TEST MAZE` unlocks.

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
rooms, the exit placed at the farthest reachable point, then items, blobs, secrets, and a
locked door with its key stashed somewhere you can actually reach first.

Mazes save to browser storage, or export to a `.json` file you can hand to someone else.

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
route around corners instead of bumping into walls. They amble until they see or hear you,
then commit. Opening a door opens it for them too.

---

## Test mode (3D, first person)

| | |
| --- | --- |
| Move | `W` `A` `S` `D`, `Shift` to sprint (costs stamina) |
| Look | Mouse (click the view to capture it) |
| Attack / block | Left click / hold right click |
| Weapons | `1` `2` `3`, or the scroll wheel |
| Open door | `E` |
| Map | `Tab` or `M` |
| Pause | `Esc` |

The minimap only fills in what you have actually seen, and only shows blobs when they are
close. Score comes from treasure, kills, secrets, the door, your remaining health and how
fast you got out.

---

## How it is put together

```
index.html          markup + script order
css/style.css
js/util.js          maths, seeded RNG, storage, pixel helpers
js/defs.js          every wall and thing type — the single source of truth
js/textures.js      procedural 64x64 wall/floor textures
js/sprites.js       procedural sprites, reused as the editor's palette icons
js/audio.js         WebAudio synthesis — no audio files
js/level.js         level model, maze generator, validator, save/load
js/editor.js        the 2D editor
js/raycaster.js     the 3D renderer
js/entities.js      blobs, arrows, pickups, particles
js/hud.js           weapon viewmodel, vitals, minimap
js/game.js          player, combat, doors, secrets, scoring
js/main.js          boot and menus
```

The renderer is a software raycaster: DDA per screen column for textured walls, per-row
floor and ceiling casting, depth-sorted billboards for everything else, all written into one
`Uint32Array` and blitted once per frame. Because that is fill-rate bound, the internal
buffer is capped at ~620k pixels and scaled up by the browser; a small adaptive controller
trims it further if frames run long, so it stays smooth on slow machines and does not melt
on a 4K display. Measured on this machine: ~5.6 ms per frame at 640×360, ~12.6 ms at 960×540.

Scripts are plain `<script>` tags rather than ES modules on purpose — modules are blocked by
CORS over `file://`, and this should run by double-clicking.
