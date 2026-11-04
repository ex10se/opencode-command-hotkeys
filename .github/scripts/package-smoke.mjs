import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Runs only on demand in CI/release verification, never during consumer install.
const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
assert.equal(manifest.name, "opencode-command-hotkeys");
const temporary = mkdtempSync(join(tmpdir(), "command-hotkeys-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
try {
  const packed = JSON.parse(execFileSync(npm, ["pack", "--json", "--pack-destination", temporary], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  }));
  assert.equal(packed.length, 1);
  assert.equal(packed[0].name, manifest.name);
  assert.equal(packed[0].version, manifest.version);
  for (const expected of ["package.json", "dist/tui.js", "dist/tui.d.ts", "LICENSE"]) {
    assert.ok(packed[0].files.some(file => file.path === expected), `Missing ${expected}`);
  }
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(temporary, packed[0].filename)], {
    cwd: consumer, stdio: "inherit",
  });
  execFileSync(process.execPath, ["--input-type=module", "--eval",
    'import * as plugin from "opencode-command-hotkeys/tui"; if (Object.keys(plugin).length === 0) throw new Error("Empty TUI export");',
  ], { cwd: consumer, stdio: "inherit" });
  console.log(`Package smoke passed: ${manifest.name}@${manifest.version}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
