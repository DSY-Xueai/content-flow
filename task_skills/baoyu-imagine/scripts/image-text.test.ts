import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromptForImageTextMode,
  evaluateDetectedText,
  getImageTextAttemptOrder,
  parseImageTextMode,
} from "./image-text.ts";

test("image text mode parsing and attempt order follow the Chinese-first policy", () => {
  assert.equal(parseImageTextMode("zh"), "zh");
  assert.equal(parseImageTextMode("EN"), "en");
  assert.equal(parseImageTextMode(null), null);
  assert.deepEqual(getImageTextAttemptOrder(null), ["zh", "en", "none"]);
  assert.deepEqual(getImageTextAttemptOrder("auto"), ["zh", "en", "none"]);
  assert.deepEqual(getImageTextAttemptOrder("en"), ["en", "none"]);
  assert.deepEqual(getImageTextAttemptOrder("none"), ["none"]);
  assert.throws(() => parseImageTextMode("jp"), /Invalid imageTextMode/);
});

test("prompt policy appends mode-specific text constraints", () => {
  assert.match(buildPromptForImageTextMode("draw a diagram", "zh"), /simplified Chinese only/i);
  assert.match(buildPromptForImageTextMode("draw a diagram", "en"), /natural English only/i);
  assert.match(buildPromptForImageTextMode("draw a diagram", "none"), /Do not render any visible text/i);
});

test("detected text validation rejects wrong-language and garbled labels", () => {
  assert.equal(evaluateDetectedText("zh", [{ language: "zh-Hans-CN", text: "性能优势" }]).ok, true);
  assert.equal(evaluateDetectedText("zh", [{ language: "en-US", text: "OpenClaw" }]).failureType, "unexpected_language");
  assert.equal(evaluateDetectedText("en", [{ language: "en-US", text: "Hermes Agent" }]).ok, true);
  assert.equal(evaluateDetectedText("en", [{ language: "en-US", text: "XQRT" }]).failureType, "pseudo_text");
  assert.equal(evaluateDetectedText("none", [{ language: "en-US", text: "Label" }]).failureType, "unexpected_text");
});
