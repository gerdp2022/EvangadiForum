import "../test-support/test-env.js";
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseJsonObject } from "../src/api/question/service/geminiTextCoach.service.js";

// parseJsonObject logs bad replies with console.error. Silence it here so the
// test output stays readable (the logging itself is expected behaviour).
let originalError;
before(() => {
  originalError = console.error;
  console.error = () => {};
});
after(() => {
  console.error = originalError;
});

describe("parseJsonObject (reading Gemini's JSON replies)", () => {
  test("should parse a reply that is a clean JSON object", () => {
    assert.deepEqual(parseJsonObject('{"level":"strong","note":"Good."}'), {
      level: "strong",
      note: "Good.",
    });
  });

  test("should parse a reply wrapped in a ```json code fence", () => {
    const raw = '```json\n{"tips":["Add an example"]}\n```';
    assert.deepEqual(parseJsonObject(raw), { tips: ["Add an example"] });
  });

  test("should parse a reply wrapped in a plain ``` code fence", () => {
    assert.deepEqual(parseJsonObject('```\n{"a":1}\n```'), { a: 1 });
  });

  test("should repair a reply when short junk follows the JSON, as seen in real Gemini replies", () => {
    assert.deepEqual(parseJsonObject('{"answer":"Use JWT."}}'), {
      answer: "Use JWT.",
    });
    assert.deepEqual(parseJsonObject('{"answer":"Use JWT."(-0)}'), {
      answer: "Use JWT.",
    });
  });

  test("should not be confused by braces inside a string value when repairing", () => {
    assert.deepEqual(parseJsonObject('{"answer":"if (x) { y(); }"}}'), {
      answer: "if (x) { y(); }",
    });
  });

  test("should return null instead of cutting a reply that broke in the middle of the text", () => {
    // A quote in the junk means the text itself is broken; showing half an
    // answer would be worse than showing none.
    assert.equal(parseJsonObject('{"answer":"Use JWT.","note":"unfinish'), null);
  });

  test("should return null for plain text, arrays and empty input", () => {
    assert.equal(parseJsonObject("Sorry, I cannot help with that."), null);
    assert.equal(parseJsonObject("[1,2,3]"), null);
    assert.equal(parseJsonObject(""), null);
    assert.equal(parseJsonObject(null), null);
    assert.equal(parseJsonObject(undefined), null);
  });
});
