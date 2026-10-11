import { body } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

export const chatMessageValidation = [
  // bail() stops at the first problem, so the user gets one clear message.
  body("message")
    .exists()
    .withMessage("message is required")
    .bail()
    .isString()
    .withMessage("message must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("message is required")
    .bail()
    .isLength({ min: 2, max: 500 })
    .withMessage("message must be between 2 and 500 characters"),
  validationErrorHandler,
];
