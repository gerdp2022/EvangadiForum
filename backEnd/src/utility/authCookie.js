import jwt from "jsonwebtoken";



export const AUTH_COOKIE_NAME = "token";

export const authCookieOptions = {
  httpOnly: true, // JavaScript in the browser can't read it
  secure: true, // only sent over HTTPS (browsers allow localhost too)
  sameSite: "lax", // blocks most cross-site request tricks
  path: "/",
};

/**
 * Stores the JWT in an httpOnly cookie that expires together with the token.
 *
 * @param {import('express').Response} res
 * @param {string} token
 */
export function setAuthCookie(res, token) {
  const { exp } = jwt.decode(token);
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...authCookieOptions,
    maxAge: exp * 1000 - Date.now(),
  });
}
