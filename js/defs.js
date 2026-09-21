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
    BLOB: 12, BLOB_FAST: 13, BLOB_TANK: 14,
    START2: 15, START3: 16, START4: 17,
    STAIRS_UP: 18, STAIRS_DOWN: 19, LADDER_UP: 20, LADDER_DOWN: 21,
    SCROLL_FIRE: 22, SCROLL_FROST: 23, SCROLL_HEAL: 24, SCROLL_BOLT: 25, SCROLL_BLINK: 26, SCROLL_WARD: 27,
    MANA: 28
  });

  // Floors stack up to MAX_FLOORS high. A way up on floor f always pairs with a way down
  // in the same cell on floor f + 1; the editor and the loader keep them paired.
  MAZE.MAX_FLOORS = 4;
  MAZE.STAIR_PAIR = { [T.STAIRS_UP]: T.STAIRS_DOWN, [T.STAIRS_DOWN]: T.STAIRS_UP, [T.LADDER_UP]: T.LADDER_DOWN, [T.LADDER_DOWN]: T.LADDER_UP };
  MAZE.STAIR_DIR = { [T.STAIRS_UP]: 1, [T.LADDER_UP]: 1, [T.STAIRS_DOWN]: -1, [T.LADDER_DOWN]: -1 };

  // Custom monsters made in the Monster Maker live in the level itself (lv.monsters) and
  // are placed as thing ids CUSTOM_BASE + their index there.
  MAZE.CUSTOM_BASE = 100;
  MAZE.MAX_CUSTOM = 24;
  MAZE.MONSTER_BODIES = {
    slime:    { name: "Slime",    desc: "A wobbling blob of goo." },
    spider:   { name: "Spider",   desc: "Eight legs, too many eyes." },
    goblin:   { name: "Goblin",   desc: "Small, green, stabby." },
    orc:      { name: "Orc",      desc: "Tusks, muscle and an axe." },
    skeleton: { name: "Skeleton", desc: "Rattling bones with a rusty blade." },
    bat:      { name: "Bat",      desc: "Flaps around at head height." },
    ghost:    { name: "Ghost",    desc: "A drifting, glowing wraith." }
  };
  MAZE.MONSTER_ABILITIES = {
    none:    { name: "None",          desc: "Just bites." },
    ranged:  { name: "Spits",         desc: "Lobs globs at you from a distance." },
    poison:  { name: "Poison",        desc: "Bites leave you poisoned for a few seconds." },
    regen:   { name: "Regenerates",   desc: "Heals itself steadily." },
    split:   { name: "Splits",        desc: "Bursts into two smaller copies when killed." },
    explode: { name: "Explodes",      desc: "Charges in and blows up, hurting everyone near." },
    leech:   { name: "Drains life",   desc: "Heals itself with every bite." }
  };

  // ---- magic ------------------------------------------------------------
  // tier 2 spells need 2 points in Mana to learn, tier 3 need 4
  MAZE.SPELLS = {
    fire:  { id: "fire",  name: "Fireball",        tier: 1, cost: 15, color: "#ff7a2a", scroll: T.SCROLL_FIRE,  desc: "A bolt of fire that bursts on impact." },
    frost: { id: "frost", name: "Frost Shard",     tier: 1, cost: 12, color: "#8fe3ff", scroll: T.SCROLL_FROST, desc: "Fast ice that slows whatever it hits." },
    heal:  { id: "heal",  name: "Heal",            tier: 1, cost: 22, color: "#6ee06e", scroll: T.SCROLL_HEAL,  desc: "Mends you, and teammates close by." },
    bolt:  { id: "bolt",  name: "Chain Lightning", tier: 2, cost: 26, color: "#c9b8ff", scroll: T.SCROLL_BOLT,  desc: "Instant lightning that jumps to two more foes." },
    blink: { id: "blink", name: "Blink",           tier: 2, cost: 18, color: "#c06bd6", scroll: T.SCROLL_BLINK, desc: "Teleport a few steps forward." },
    ward:  { id: "ward",  name: "Ward",            tier: 3, cost: 30, color: "#5aa8ff", scroll: T.SCROLL_WARD,  desc: "Halves all damage for six seconds." }
  };
  MAZE.SPELL_ORDER = ["fire", "frost", "heal", "bolt", "blink", "ward"];
  MAZE.TIER_NEEDS = { 1: 0, 2: 2, 3: 4 };

  // ---- levelling ---------------------------------------------------------
  MAZE.STATS = [
    { id: "atk", name: "Attack",  short: "ATK", color: "#ff7a5a", desc: "+10% damage with every weapon" },
    { id: "spd", name: "Speed",   short: "SPD", color: "#8ad8ff", desc: "+5% movement speed" },
    { id: "def", name: "Defense", short: "DEF", color: "#9fb4d8", desc: "-7% damage taken (up to 60%)" },
    { id: "vit", name: "Health",  short: "HP",  color: "#6ee06e", desc: "+15 maximum health" },
    { id: "mag", name: "Mana",    short: "MAG", color: "#b07cff", desc: "+20 mana, faster regen, +8% spell power, unlocks spells" }
  ];
  MAZE.MAX_LEVEL = 20;
  MAZE.xpFor = (level) => Math.round(45 * Math.pow(level, 1.5) + 25);   // XP needed to go from level to level + 1

  // one colour per seat: tunic, name tag, start marker, minimap dot
  MAZE.PLAYER_COLORS = ["#ffb454", "#5aa8ff", "#ff6a8a", "#e6e6ee"];
  MAZE.MAX_PLAYERS = 4;
  MAZE.START_IDS = [T.START, T.START2, T.START3, T.START4];

  MAZE.MODES = {
    solo:   { name: "Solo" },
    coop:   { name: "Co-op", desc: "Work together. Everyone has to get out. Fallen friends can be revived." },
    versus: { name: "Competitive", desc: "Weapons hurt players too. First one through the exit wins." }
  };

  // cat    : palette grouping
  // scale  : world height of the billboard (1 = floor to ceiling)
  // zbase  : height of the sprite's bottom edge above the floor
  MAZE.THINGS = {
    [T.START]:   { name: "Start P1", cat: "marker", sprite: "start", unique: true, mini: "#ffb454", seat: 0,
                   desc: "Where player 1 spawns. Every maze needs one." },
    [T.START2]:  { name: "Start P2", cat: "marker", sprite: "start2", unique: true, mini: "#5aa8ff", seat: 1,
                   desc: "Player 2's spawn in online games. Leave it out and they start next to player 1." },
    [T.START3]:  { name: "Start P3", cat: "marker", sprite: "start3", unique: true, mini: "#ff6a8a", seat: 2,
                   desc: "Player 3's spawn in online games. Leave it out and they start next to player 1." },
    [T.START4]:  { name: "Start P4", cat: "marker", sprite: "start4", unique: true, mini: "#e6e6ee", seat: 3,
                   desc: "Player 4's spawn in online games. Leave it out and they start next to player 1." },
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
                    hp: 60, speed: 1.55, dmg: 9, radius: 0.33, score: 100, mass: 1, xp: 30, rate: 0.85, sight: 14, ability: "none",
                    body: "#5fce5a", body2: "#8ff08a", eye: "#1a2a14",
                    desc: "Bounces after you relentlessly." },
    [T.BLOB_FAST]:{ name: "Sprinter Blob", cat: "enemy", sprite: "blob_fast", mini: "#5fe0ff", scale: 0.5, zbase: 0.0,
                    hp: 35, speed: 3.45, dmg: 7, radius: 0.28, score: 150, mass: 0.6, xp: 40, rate: 0.85, sight: 14, ability: "none",
                    body: "#3fc8e8", body2: "#9df0ff", eye: "#0a2430",
                    desc: "Fragile, but faster than a walking player — you will have to sprint." },
    [T.BLOB_TANK]:{ name: "Brute Blob", cat: "enemy", sprite: "blob_tank", mini: "#b07cff", scale: 0.85, zbase: 0.0,
                    hp: 165, speed: 1.2, dmg: 20, radius: 0.42, score: 300, mass: 4, xp: 85, rate: 0.85, sight: 14, ability: "none",
                    body: "#8a54d8", body2: "#c79bff", eye: "#1b0e2e",
                    desc: "Slow, enormous, hits like a wall." },

    // floors: place the way up on the lower floor; its way down appears on the floor above
    [T.STAIRS_UP]:  { name: "Stairs Up", cat: "floor", sprite: "stairs_up", mini: "#d6c7a1", scale: 1.0, zbase: 0, stair: true,
                      desc: "Climb to the floor above (E). Adds a floor if this is the top one." },
    [T.LADDER_UP]:  { name: "Ladder Up", cat: "floor", sprite: "ladder_up", mini: "#c99b4a", scale: 1.0, zbase: 0, stair: true,
                      desc: "A ladder to the floor above (E). Adds a floor if this is the top one." },
    [T.STAIRS_DOWN]:{ name: "Stairs Down", cat: "floor", sprite: "stairs_down", mini: "#8a7a5a", stair: true, hidden: true,
                      desc: "Made by the stairs up on the floor below." },
    [T.LADDER_DOWN]:{ name: "Ladder Down", cat: "floor", sprite: "ladder_down", mini: "#8a6a3a", stair: true, hidden: true,
                      desc: "Made by the ladder up on the floor below." },

    // magic: scrolls go into your bag, and you learn them from the character sheet (C)
    [T.SCROLL_FIRE]: { name: "Scroll: Fireball", cat: "magic", sprite: "scroll_fire", mini: "#ff7a2a", scale: 0.4, zbase: 0.14, spell: "fire", desc: "Tier 1. Learn it to throw fire." },
    [T.SCROLL_FROST]:{ name: "Scroll: Frost Shard", cat: "magic", sprite: "scroll_frost", mini: "#8fe3ff", scale: 0.4, zbase: 0.14, spell: "frost", desc: "Tier 1. Fast ice that slows." },
    [T.SCROLL_HEAL]: { name: "Scroll: Heal", cat: "magic", sprite: "scroll_heal", mini: "#6ee06e", scale: 0.4, zbase: 0.14, spell: "heal", desc: "Tier 1. Mend yourself and friends." },
    [T.SCROLL_BOLT]: { name: "Scroll: Chain Lightning", cat: "magic", sprite: "scroll_bolt", mini: "#c9b8ff", scale: 0.4, zbase: 0.14, spell: "bolt", desc: "Tier 2 (needs 2 Mana points)." },
    [T.SCROLL_BLINK]:{ name: "Scroll: Blink", cat: "magic", sprite: "scroll_blink", mini: "#c06bd6", scale: 0.4, zbase: 0.14, spell: "blink", desc: "Tier 2 (needs 2 Mana points)." },
    [T.SCROLL_WARD]: { name: "Scroll: Ward", cat: "magic", sprite: "scroll_ward", mini: "#5aa8ff", scale: 0.4, zbase: 0.14, spell: "ward", desc: "Tier 3 (needs 4 Mana points)." },
    [T.MANA]:        { name: "Mana Potion", cat: "magic", sprite: "mana", mini: "#5a7aff", scale: 0.42, zbase: 0.12, desc: "Restores 40 mana." }
  };

  MAZE.CATS = [
    { id: "wall",   title: "Walls" },
    { id: "marker", title: "Markers" },
    { id: "floor",  title: "Floors" },
    { id: "weapon", title: "Weapons" },
    { id: "item",   title: "Items" },
    { id: "magic",  title: "Magic" },
    { id: "enemy",  title: "Enemies" }
  ];

  // ---- weapons ----------------------------------------------------------
  MAZE.WEAPONS = {
    fist:  { id: "fist",  name: "Fists",  slot: 1, kind: "melee",  dmg: 13, cd: 0.34, range: 1.05, arc: 0.75, knock: 0.25 },
    sword: { id: "sword", name: "Sword",  slot: 2, kind: "melee",  dmg: 42, cd: 0.46, range: 1.6,  arc: 1.15, knock: 0.6 },
    bow:   { id: "bow",   name: "Bow",    slot: 3, kind: "ranged", dmg: 55, cd: 0.62, speed: 13,   knock: 0.35 },
    magic: { id: "magic", name: "Magic",  slot: 4, kind: "magic",  cd: 0.55 }
  };
  MAZE.WEAPON_ORDER = ["fist", "sword", "bow", "magic"];

  MAZE.PLAYER = {
    radius: 0.22, maxHp: 100, speed: 3.1, sprintMul: 1.75, blockMul: 0.55,
    maxStamina: 100, staminaDrain: 28, staminaRegen: 20, eyeHeight: 0.5,
    scale: 0.74,           // billboard height other players see
    pvpMul: 0.6,           // weapons hit players softer than blobs, so fights last a few blows
    respawnVersus: 5, respawnCoop: 14, spawnShield: 2, reviveTime: 1.6, reviveRange: 1.15,
    baseMana: 30
  };
})();
