// Central tunable constants. Tweak gameplay feel here.
export const TILE = 16;            // pixel size of one tile

export const WORLD_W = 910;        // world width  in tiles (stretched for more biomes & build room)
export const WORLD_H = 200;        // world height in tiles

export const GRAVITY = 1500;       // px/s^2
export const MOVE_SPEED = 155;     // px/s horizontal
export const MOVE_ACCEL_GROUND = 1500; // px/s^2 toward target speed on ground
export const MOVE_ACCEL_AIR = 800;     // px/s^2 toward target speed in air
export const JUMP_SPEED = 430;     // px/s initial jump velocity
export const MAX_FALL = 1200;      // terminal velocity px/s

// Camera feel
export const CAM_SMOOTH = 9;       // higher = snappier follow
export const CAM_LOOKAHEAD = 0.16; // camera leads the player by this * velocity

export const PLAYER_W = 12;        // px (slightly under 1 tile so it fits gaps)
export const PLAYER_H = 28;        // px (~1.75 tiles tall)

export const REACH = 5;            // max interaction distance in tiles

export const COYOTE_TIME = 0.08;   // grace seconds to jump after leaving ground
export const JUMP_BUFFER = 0.10;   // grace seconds to buffer a jump before landing

// --- Vitals & damage ---
export const MAX_HP = 100;
export const REGEN_DELAY = 5;      // seconds without damage before HP regenerates
export const REGEN_RATE = 6;       // HP per second once regenerating
export const IFRAMES = 0.7;        // invulnerability seconds after a hit

// --- Hunger (survival only) ---
export const MAX_FOOD = 100;            // full belly
export const HUNGER_DRAIN = 0.55;       // food/sec drained while resting
export const HUNGER_DRAIN_MOVE = 1.1;   // food/sec while moving/jumping (effort burns more)
export const STARVE_DPS = 4;            // HP/sec lost while starving (food at 0)
export const REGEN_FOOD_MIN = 30;       // need at least this much food for HP to passively regen

export const SAFE_FALL_TILES = 9;  // fall shorter than this hurts nothing
export const FALL_DMG_PER_TILE = 9;// HP lost per tile beyond the safe distance

export const LAVA_DPS = 22;        // HP per second while touching lava
export const SLIME_TOUCH_DMG = 8;  // HP per slime contact hit
export const SWIM_SPEED = 150;     // px/s upward swim in water
export const CLIMB_SPEED = 110;    // px/s up/down while on a ladder
export const FLY_SPEED = 230;      // px/s ascent/descent while flying (wings/boots)

// --- Power-up buff multipliers (see player.js / game.js) ---
export const SPEED_BUFF_MULT = 1.9;   // Swift Potion horizontal speed
export const JUMP_BUFF_MULT = 1.5;    // Bounce Potion jump height
export const STRENGTH_BUFF_MULT = 2.2;// Berserk Potion melee damage
export const HASTE_BUFF_MULT = 2.4;   // Miner's Haste mining speed
export const DRUNK_DAMAGE_MULT = 1.05;// +5% attack damage while intoxicated (liquor/smoking)

// --- Stimulants (cocaine/crack): faster, harder-hitting, twitchy ---
export const COKE_SPEED_MULT = 1.40;  // cocaine ("wired") horizontal speed
export const COKE_DAMAGE_MULT = 1.12; // cocaine attack damage
export const COKE_ATTACK_SCALE = 0.7; // cocaine swing-cooldown scale (lower = faster)
export const CRACK_SPEED_MULT = 1.75; // crack ("cracked") horizontal speed
export const CRACK_DAMAGE_MULT = 1.30; // crack attack damage
export const CRACK_ATTACK_SCALE = 0.5; // crack swing-cooldown scale

// --- Magic / spellcasting ---
export const MAX_MANA = 100;       // spell energy pool
export const MANA_REGEN = 14;      // mana per second regenerated
export const MANA_REGEN_DELAY = 0.6; // seconds after casting before mana refills

export const SAVE_KEY = "terreria.save.v1";
