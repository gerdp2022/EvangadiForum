

import { TooManyRequestsError } from "../utility/errors/errors.js";

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = Number(process.env.AUTH_RATE_LIMIT_PER_15_MIN) || 10;
const MAX_TRACKED_IPS = 10000; // stops the Map from growing forever

/*
  Map: ip -> { count, resetAt }
    count   = attempts from this IP in the current window
    resetAt = time (ms) when the window ends and count starts again from 0
*/
const attemptsByIp = new Map();

export const authRateLimit = (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket?.remoteAddress || "unknown";

  let entry = attemptsByIp.get(ip);
  if (!entry || entry.resetAt <= now) {
    if (attemptsByIp.size >= MAX_TRACKED_IPS) {
      // Forget the oldest IP to make room.
      attemptsByIp.delete(attemptsByIp.keys().next().value);
    }
    entry = { count: 0, resetAt: now + WINDOW_MS };
    attemptsByIp.set(ip, entry);
  }
  entry.count += 1;

  if (entry.count > MAX_ATTEMPTS) {
    const minutes = Math.ceil((entry.resetAt - now) / 60000);
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return next(
      new TooManyRequestsError(
        `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`,
      ),
    );
  }

  next();
};
