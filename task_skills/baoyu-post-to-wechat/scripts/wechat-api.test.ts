import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(SCRIPT_DIR, "wechat-api.ts");
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");

test("wechat-api markdown dry-run renders through md-to-wechat without publishing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wechat-api-dry-run-"));
  const markdownPath = path.join(root, "article.md");
  await fs.writeFile(
    markdownPath,
    `---
title: Dry Run Test
author: Codex
---

# Dry Run Test

Hello WeChat.
`,
    "utf-8",
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    [SCRIPT_PATH, markdownPath, "--dry-run"],
    { cwd: REPO_ROOT },
  );

  const result = JSON.parse(stdout) as {
    title: string;
    author?: string;
    htmlPath: string;
  };

  assert.equal(result.title, "Dry Run Test");
  assert.equal(result.author, "Codex");
  await fs.access(result.htmlPath);
});
