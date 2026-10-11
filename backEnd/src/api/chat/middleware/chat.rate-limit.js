import { createUserRateLimit } from "../../../middleware/user-rate-limit.js";

export const chatRateLimit = createUserRateLimit({
  max: Number(process.env.CHAT_RATE_LIMIT_PER_MIN) || 10,
  what: "messages",
});
