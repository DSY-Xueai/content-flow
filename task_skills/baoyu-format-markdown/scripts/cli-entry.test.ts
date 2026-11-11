import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { isDirectCliEntrypoint } from "./cli-entry.ts";

test("CLI entrypoint detection accepts native Windows script paths", () => {
  const scriptPath = path.resolve("task_skills", "baoyu-format-markdown", "scripts", "main.ts");
  const metaUrl = pathToFileURL(scriptPath).href;

  assert.equal(isDirectCliEntrypoint(metaUrl, scriptPath), true);
});
