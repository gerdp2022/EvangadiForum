import "../test-support/test-env.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { authRateLimit } from "../src/middleware/auth-rate-limit.js";
import { createUserRateLimit } from "../src/middleware/user-rate-limit.js";

// Runs a middleware once with a fake request and response.
// Resolves to 200 when the request is let through, or the error's status.
const call = (middleware, req) =>
  new Promise((resolve) => {
    const res = { headers: {}, set(name, value) { this.headers[name] = value; } };
    middleware(req, res, (error) =>
      resolve({
        status: error ? error.statusCode : 200,
        message: error?.message,
        retryAfter: res.headers["Retry-After"],
      }),
    );
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("authRateLimit (login + register, per IP)", () => {
  test("should allow 10 attempts from one IP, then block the 11th with 429 and a Retry-After header", async () => {
    const ip = "10.0.0.1";
    for (let i = 1; i <= 10; i += 1) {
      assert.equal((await call(authRateLimit, { ip })).status, 200, `attempt ${i}`);
    }
    const blocked = await call(authRateLimit, { ip });
    assert.equal(blocked.status, 429);
    assert.match(blocked.message, /Too many attempts/);
    assert.ok(Number(blocked.retryAfter) > 0, "Retry-After header is set");
  });

  test("should keep allowing other IPs when one IP is blocked", async () => {
    for (let i = 0; i < 11; i += 1) await call(authRateLimit, { ip: "10.0.0.2" });
    assert.equal((await call(authRateLimit, { ip: "10.0.0.2" })).status, 429);
    assert.equal((await call(authRateLimit, { ip: "10.0.0.3" })).status, 200);
  });
});

describe("createUserRateLimit (AI and chat, per user)", () => {
  test("should allow `max` requests per user, then block the next one with 429", async () => {
    const limit = createUserRateLimit({ max: 3, what: "AI requests" });
    const req = { user: { id: 1 } };
    for (let i = 0; i < 3; i += 1) assert.equal((await call(limit, req)).status, 200);
    const blocked = await call(limit, req);
    assert.equal(blocked.status, 429);
    assert.match(blocked.message, /Too many AI requests/);
  });

  test("should count each user separately, so a blocked user does not block others", async () => {
    const limit = createUserRateLimit({ max: 1 });
    assert.equal((await call(limit, { user: { id: 1 } })).status, 200);
    assert.equal((await call(limit, { user: { id: 1 } })).status, 429);
    assert.equal((await call(limit, { user: { id: 2 } })).status, 200);
  });

  test("should let a blocked user through again once the time window ends", async () => {
    const limit = createUserRateLimit({ max: 1, windowMs: 50 });
    const req = { user: { id: 7 } };
    assert.equal((await call(limit, req)).status, 200);
    assert.equal((await call(limit, req)).status, 429);
    await wait(70);
    assert.equal((await call(limit, req)).status, 200);
  });
});
