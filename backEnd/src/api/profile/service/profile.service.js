import fs from "node:fs/promises";
import path from "node:path";
import jwt from "jsonwebtoken";
import { safeExecute } from "../../../../schema/db.config.js";
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from "../../../utility/errors/errors.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

const normalizeName = (value) => value?.trim() ?? "";

const formatProfile = (user) => ({
  id: user.user_id,
  firstName: user.first_name,
  lastName: user.last_name,
  email: user.email,
  bio: user.bio ?? "",
  avatar: user.avatar ?? null,
});

export const detectImageType = (buffer) => {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer.toString("ascii", 1, 4) === "PNG" &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a
  ) {
    return "image/png";
  }
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
};

const ensureOwnProfile = (requestedUserId, currentUserId) => {
  if (Number(requestedUserId) !== Number(currentUserId)) {
    throw new ForbiddenError("You can only access your own profile.");
  }
};

const deleteProfileImageFile = async (avatarPath) => {
  if (!avatarPath || !avatarPath.startsWith("/uploads/profiles/")) return;

  const relativePath = avatarPath.replace(/^\/uploads\/profiles\//, "");
  const absolutePath = path.resolve("uploads/profiles", relativePath);

  await fs.unlink(absolutePath).catch(() => {});
};

export const getUserProfileService = async (requestedUserId, currentUserId) => {
  ensureOwnProfile(requestedUserId, currentUserId);

  const rows = await safeExecute(
    `SELECT user_id, first_name, last_name, email, bio, avatar
      FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [requestedUserId],
  );

  if (rows.length === 0) {
    throw new NotFoundError("User not found.");
  }

  return formatProfile(rows[0]);
};

export const updateUserProfileService = async ({
  requestedUserId,
  currentUserId,
  firstName,
  lastName,
  bio,
  file,
}) => {
  ensureOwnProfile(requestedUserId, currentUserId);

  const trimmedFirstName = normalizeName(firstName);
  const trimmedLastName = normalizeName(lastName);
  const trimmedBio = normalizeName(bio ?? "");

  if (!trimmedFirstName || trimmedFirstName.length < 2) {
    throw new BadRequestError(
      "First name is required and must be at least 2 characters long.",
    );
  }

  if (!trimmedLastName || trimmedLastName.length < 2) {
    throw new BadRequestError(
      "Last name is required and must be at least 2 characters long.",
    );
  }

  if (trimmedBio.length > 500) {
    throw new BadRequestError("Bio must be 500 characters or fewer.");
  }

  const existingUser = await safeExecute(
    `SELECT user_id, first_name, last_name, email, bio, avatar
       FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [requestedUserId],
  );

  if (existingUser.length === 0) {
    throw new NotFoundError("User not found.");
  }

  const previousAvatar = existingUser[0].avatar ?? null;
  let nextAvatar = previousAvatar;

  if (file) {
    const mimeType = detectImageType(file.buffer);
    if (!mimeType) {
      throw new BadRequestError(
        "This file is not a valid JPG, PNG, or WebP image.",
      );
    }

    // Saved in MySQL so the photo survives server restarts (see schema.sql).
    await safeExecute(
      `INSERT INTO user_avatars (user_id, mime_type, image)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE mime_type = VALUES(mime_type), image = VALUES(image)`,
      [requestedUserId, mimeType, file.buffer],
    );

    // ?v= changes on every upload, so browsers show the new photo instead of
    // a cached old one.
    nextAvatar = `/api/users/${Number(requestedUserId)}/avatar?v=${Date.now()}`;

    // Photos from before this change were files on disk: remove the old one.
    if (previousAvatar && previousAvatar.startsWith("/uploads/profiles/")) {
      await deleteProfileImageFile(previousAvatar);
    }
  }

  const rows = await safeExecute(
    `UPDATE users
        SET first_name = ?, last_name = ?, bio = ?, avatar = ?
      WHERE user_id = ?`,
    [
      trimmedFirstName,
      trimmedLastName,
      trimmedBio,
      nextAvatar,
      requestedUserId,
    ],
  );

  if (rows.affectedRows === 0) {
    throw new NotFoundError("User not found.");
  }

  const updatedUser = await safeExecute(
    `SELECT user_id, first_name, last_name, email, bio, avatar
       FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [requestedUserId],
  );

  const updatedProfile = formatProfile(updatedUser[0]);

  const token = jwt.sign(
    {
      id: updatedProfile.id,
      firstName: updatedProfile.firstName,
      lastName: updatedProfile.lastName,
    },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" },
  );

  return {
    ...updatedProfile,
    token,
  };
};

export const getAvatarImageService = async (userId) => {
  const rows = await safeExecute(
    `SELECT mime_type, image FROM user_avatars WHERE user_id = ? LIMIT 1`,
    [userId],
  );
  if (rows.length === 0) return null;
  return { mimeType: rows[0].mime_type, image: rows[0].image };
};
