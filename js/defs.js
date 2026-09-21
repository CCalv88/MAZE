/* MAZE — tile + thing definitions. Single source of truth for editor, engine and HUD. */
(function () {
  const MAZE = window.MAZE;

  // ---- wall layer -------------------------------------------------------
  const W = (MAZE.W = {
    EMPTY: 0, BRICK: 1, STONE: 2, MOSS: 3, SECRET: 4, DOOR: 5, GLASS: 6
  });

  // solid  : blocks the player
  // blocksAI: blocks blobs (secrets do — they are your escape hatch)
  // opaque : stops the ray (glass does not)
  MAZE.WALLS = {
    [W.BRICK]: { name: "Brick Wall", tex: "brick", key: "1", solid: true, blocksAI: true, opaque: true, mini: "#8a4a34" },
    [W.STONE]: { name: "Stone Wall", tex: "stone", key: "2", solid: true, blocksAI: true, opaque: true, mini: "#79808f" },
    [W.MOSS]:  { name: "Mossy Wall", tex: "moss",  key: "3", solid: true, blocksAI: true, opaque: true, mini: "#4f7a4a" },
    [W.SECRET]:{ name: "Secret Wall", tex: "secret", key: "4", solid: false, blocksAI: true, opaque: true, mini: "#c06bd6",
                 desc: "Disguised as the surrounding wall. You pass through it; blobs cannot." },
    [W.DOOR]:  { name: "Locked Door", tex: "door", key: "5", solid: true, blocksAI: true, opaque: true, mini: "#c99b4a",
                 desc: "Needs the Key. Walk into it (or press E) to unlock." },
    [W.GLASS]: { name: "Glass Wall", tex: "glass", key: "6", solid: true, blocksAI: true, opaque: false, mini: "#7fd8ff",
                 desc: "See-through but solid. Great for taunting blobs." }
  };

  // ---- thing layer ------------------------------------------------------
  const T = (MAZE.T = {
    NONE: 0, START: 1, FINISH: 2,
    SWORD: 3, BOW: 4, SHIELD: 5, ARROWS: 6,
    POTION: 7, KEY: 8, BOOTS: 9, TORCH: 10, TREASURE: 11,
    BLOB: 12, BLOB_FAST: 13, BLOB_TANK: 14
  });

  // cat    : palette grouping
  // scale  : world height of the billboard (1 = floor to ceiling)
  // zbase  : height of the sprite's bottom edge above the floor
  MAZE.THINGS = {
    [T.START]:   { name: "Start", cat: "marker", sprite: "start", unique: true, mini: "#6ee06e",
                   desc: "Where you spawn. Every maze needs exactly one." },
    [T.FINISH]:  { name: "Exit Portal", cat: "marker", sprite: "finish", unique: true, mini: "#4fd6c8",
                   scale: 0.95, zbase: 0.02, desc: "Reach it to escape." },

    [T.SWORD]:   { name: "Sword", cat: "weapon", sprite: "sword", mini: "#d8dde8", scale: 0.5, zbase: 0.22,
                   desc: "Heavy melee. 42 damage, wide arc." },
    [T.BOW]:     { name: "Bow", cat: "weapon", sprite: "bow", mini: "#c89a5a", scale: 0.55, zbase: 0.2,
                   desc: "Ranged. 55 damage, spends arrows." },
    [T.SHIELD]:  { name: "Shield", cat: "weapon", sprite: "shield", mini: "#9fb4d8", scale: 0.5, zbase: 0.2,
                   desc: "Hold right-click to block 75% of damage." },
    [T.ARROWS]:  { name: "Arrows ×8", cat: "weapon", sprite: "arrows", mini: "#b9884f", scale: 0.4, zbase: 0.12,
                   desc: "Ammo for the bow." },

    [T.POTION]:  { name: "Health Potion", cat: "item", sprite: "potion", mini: "#ff5a7a", scale: 0.42, zbase: 0.12,
                   desc: "Restores 45 health." },
    [T.KEY]:     { name: "Key", cat: "item", sprite: "key", mini: "#ffd34a", scale: 0.35, zbase: 0.2,
                   desc: "Unlocks every locked door in the maze." },
    [T.BOOTS]:   { name: "Swift Boots", cat: "item", sprite: "boots", mini: "#8ad8ff", scale: 0.4, zbase: 0.06,
                   desc: "+40% movement speed, permanently." },
    [T.TORCH]:   { name: "Torch", cat: "item", sprite: "torch", mini: "#ffa030", scale: 0.6, zbase: 0.15,
                   desc: "Doubles how far you can see." },
    [T.TREASURE]:{ name: "Treasure", cat: "item", sprite: "treasure", mini: "#ffcf5a", scale: 0.45, zbase: 0.02,
                   desc: "Pure score. Collect them all for the bonus." },

    [T.BLOB]:     { name: "Blob", cat: "enemy", sprite: "blob", mini: "#6ee06e", scale: 0.62, zbase: 0.0,
                    hp: 60, speed: 1.55, dmg: 9, radius: 0.33, score: 100, mass: 1,
                    body: "#5fce5a", body2: "#8ff08a", eye: "#1a2a14",
                    desc: "Bounces after you relentlessly." },
    [T.BLOB_FAST]:{ name: "Sprinter Blob", cat: "enemy", sprite: "blob_fast", mini: "#5fe0ff", scale: 0.5, zbase: 0.0,
                    hp: 35, speed: 3.45, dmg: 7, radius: 0.28, score: 150, mass: 0.6,
                    body: "#3fc8e8", body2: "#9df0ff", eye: "#0a2430",
                    desc: "Fragile, but faster than a walking player — you will have to sprint." },
    [T.BLOB_TANK]:{ name: "Brute Blob", cat: "enemy", sprite: "blob_tank", mini: "#b07cff", scale: 0.85, zbase: 0.0,
                    hp: 165, speed: 1.2, dmg: 20, radius: 0.42, score: 300, mass: 4,
                    body: "#8a54d8", body2: "#c79bff", eye: "#1b0e2e",
                    desc: "Slow, enormous, hits like a wall." }
  };

  MAZE.CATS = [
    { id: "wall",   title: "Walls" },
    { id: "marker", title: "Markers" },
    { id: "weapon", title: "Weapons" },
    { id: "item",   title: "Items" },
    { id: "enemy",  title: "Enemies" }
  ];

  // ---- weapons ----------------------------------------------------------
  MAZE.WEAPONS = {
    fist:  { id: "fist",  name: "Fists",  slot: 1, kind: "melee",  dmg: 13, cd: 0.34, range: 1.05, arc: 0.75, knock: 0.25 },
    sword: { id: "sword", name: "Sword",  slot: 2, kind: "melee",  dmg: 42, cd: 0.46, range: 1.6,  arc: 1.15, knock: 0.6 },
    bow:   { id: "bow",   name: "Bow",    slot: 3, kind: "ranged", dmg: 55, cd: 0.62, speed: 13,   knock: 0.35 }
  };
  MAZE.WEAPON_ORDER = ["fist", "sword", "bow"];

  MAZE.PLAYER = {
    radius: 0.22, maxHp: 100, speed: 3.1, sprintMul: 1.75, blockMul: 0.55,
    maxStamina: 100, staminaDrain: 28, staminaRegen: 20, eyeHeight: 0.5
  };
})();
