// Central tunable constants. Tweak gameplay feel here.
export const TILE = 16;            // pixel size of one tile

export const WORLD_W = 400;        // world width  in tiles
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

export const SAFE_FALL_TILES = 9;  // fall shorter than this hurts nothing
export const FALL_DMG_PER_TILE = 9;// HP lost per tile beyond the safe distance

export const LAVA_DPS = 22;        // HP per second while touching lava
export const SLIME_TOUCH_DMG = 8;  // HP per slime contact hit
export const SWIM_SPEED = 150;     // px/s upward swim in water

export const SAVE_KEY = "terreria.save.v1";
