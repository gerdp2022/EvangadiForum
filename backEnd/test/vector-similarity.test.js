import "../test-support/test-env.js";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { calculateCosineSimilarity } from "../src/api/question/service/vector.service.js";

const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe("calculateCosineSimilarity", () => {
  test("should return 1 for vectors pointing in the same direction", () => {
    close(calculateCosineSimilarity([1, 2, 3], [2, 4, 6]), 1);
  });

  test("should return 0 for perpendicular vectors", () => {
    close(calculateCosineSimilarity([1, 0], [0, 1]), 0);
  });

  test("should return -1 for vectors pointing in opposite directions", () => {
    close(calculateCosineSimilarity([1, 1], [-1, -1]), -1);
  });

  test("should throw when the two vectors have different lengths", () => {
    assert.throws(() => calculateCosineSimilarity([1, 2], [1, 2, 3]), /same length/);
  });
});
