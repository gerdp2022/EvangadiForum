

import { body } from "express-validator";
import { param } from "express-validator";
import { validationErrorHandler } from "../../../middleware/validation-handler.js";

// Every route that takes :roomId.
export const roomIdParamValidation = [
  param("roomId")
    .isInt({ min: 1, max: 6 })
    .withMessage("Room id must be a positive integer")
    .toInt(),
  validationErrorHandler,
];

// POST /:roomId/messages. 2000 is the size of the content column.
export const postMessageValidation = [
  ...roomIdParamValidation.slice(0, -1),
  body("content")
    .exists()
    .withMessage("Message is required")
    .bail()
    .isString()
    .withMessage("Message must be text")
    .bail()
    // trim() removes spaces and empty lines at the two ends only.
    // Line breaks inside the message stay.
    .trim()
    .notEmpty()
    .withMessage("Message is required")
    .bail()
    .isLength({ max: 2000 })
    .withMessage("Message must be 2000 characters or less"),
  validationErrorHandler,
];
