import path from "node:path";
import multer from "multer";
import { BadRequestError } from "../../../utility/errors/errors.js";

export const PROFILE_UPLOAD_DIR =
  process.env.PROFILE_UPLOAD_DIR || "uploads/profiles";
export const PROFILE_MAX_UPLOAD_MB =
  Number(process.env.PROFILE_MAX_UPLOAD_MB) || 2;

const storage = multer.memoryStorage();

export const profileUpload = multer({
  storage,
  limits: { fileSize: PROFILE_MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const allowedMime = ["image/jpeg", "image/png", "image/webp"];
    const allowedExt = [".jpg", ".jpeg", ".png", ".webp"];
    const ext = path.extname(file.originalname || "").toLowerCase();
    const allowed =
      allowedMime.includes(file.mimetype) && allowedExt.includes(ext);

    cb(
      allowed
        ? null
        : new BadRequestError(
            "Only JPG, PNG, and WebP images are allowed. Maximum size is 2MB.",
          ),
      allowed,
    );
  },
});

export const createProfileMulterErrorHandler = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(
        new BadRequestError(
          `The image is larger than the ${PROFILE_MAX_UPLOAD_MB}MB limit.`,
        ),
      );
    }

    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return next(
        new BadRequestError("Send the image in a field named 'avatar'."),
      );
    }

    return next(new BadRequestError(error.message));
  }

  return next(error);
};
