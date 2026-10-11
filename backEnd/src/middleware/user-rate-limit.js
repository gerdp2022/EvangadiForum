// A small rate limit per logged-in user, shared by the whole project.
// The AI chat uses it (every message can cost Gemini calls) and the
// discussion rooms use it (one user must not flood a room).
//
// It is a counter in memory: no package and no database table. It is reset
// when the server restarts, and that is fine for this job.
// Use it AFTER authenticateUser, because it needs req.user.id.

import { TooManyRequestsError } from "../utility/errors/errors.js";

/**
 * Makes one rate-limit middleware. Every call has its own counters, so the
 * chat limit and the room limit do not share a count.
 * @param {Object} options
 * @param {number} options.max - Requests allowed per user in one window.
 * @param {number} [options.windowMs=60000] - Window length in milliseconds.
 * @param {string} [options.what="requests"] - The word used in the message.
 * @returns {(req, res, next) => void}
 */
export const createUserRateLimit = ({
  max,
  windowMs = 60 * 1000,
  what = "requests",
}) => {

  const requestCounts = new Map();

  return (req, res, next) => {
    const now = Date.now();

    const userId = req.user.id;
    let entry = requestCounts.get(userId);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      requestCounts.set(userId, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      // The error handler turns this into { msg } like every other error.
      return next(
        new TooManyRequestsError(
          `Too many ${what}. Please wait ${seconds} seconds and try again.`,
        ),
      );
    }

    next();
  };
};
