import { TILE, GRAVITY, MAX_FALL } from "./config.js";

// AABB vs tile-grid collision, resolved axis-by-axis (the classic, robust approach:
// move X and resolve, then move Y and resolve — avoids corner tunneling).
//
// `body` is { x, y, vx, vy, w, h, onGround }. x,y is the top-left in world px.
// `opts` may set { gravityScale, maxFall } — used to make liquids buoyant.
// Mutates body in place. Returns nothing.
export function stepBody(body, world, dt, opts) {
  const gravityScale = opts && opts.gravityScale != null ? opts.gravityScale : 1;
  const maxFall = opts && opts.maxFall != null ? opts.maxFall : MAX_FALL;

  // Apply gravity.
  body.vy = Math.min(body.vy + GRAVITY * gravityScale * dt, maxFall);

  body.onGround = false;

  // --- X axis ---
  body.x += body.vx * dt;
  resolveAxis(body, world, "x");

  // --- Y axis ---
  body.y += body.vy * dt;
  resolveAxis(body, world, "y");
}

function resolveAxis(body, world, axis) {
  const minTx = Math.floor(body.x / TILE);
  const maxTx = Math.floor((body.x + body.w - 0.001) / TILE);
  const minTy = Math.floor(body.y / TILE);
  const maxTy = Math.floor((body.y + body.h - 0.001) / TILE);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (!world.isSolidAt(tx, ty)) continue;

      const tileLeft = tx * TILE;
      const tileTop = ty * TILE;
      const tileRight = tileLeft + TILE;
      const tileBottom = tileTop + TILE;

      if (axis === "x") {
        if (body.vx > 0) body.x = tileLeft - body.w;
        else if (body.vx < 0) body.x = tileRight;
        body.vx = 0;
      } else {
        if (body.vy > 0) {
          body.y = tileTop - body.h;
          body.onGround = true;
        } else if (body.vy < 0) {
          body.y = tileBottom;
        }
        body.vy = 0;
      }
    }
  }
}
