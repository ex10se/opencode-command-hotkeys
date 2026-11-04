import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

test("packed package exposes a dependency-free TUI entry and declarations", { skip: process.env.COMMAND_HOTKEYS_PACK_TEST !== "1" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "command-hotkeys-pack-"));
  try {
    const output = execFileSync("npm", ["pack", "--json", "--pack-destination", directory], { encoding: "utf8" });
    const [pack] = JSON.parse(output.slice(output.indexOf("[")));
    const files = pack.files.map((file: { path: string }) => file.path);
    for (const file of ["dist/tui.js", "dist/tui.d.ts", "LICENSE", "README.md"]) assert.ok(files.includes(file), file);
    for (const file of ["CONTRIBUTING.md", "SECURITY.md", "docs/configuration.md", "docs/verification.md"]) assert.ok(files.includes(file), file);
    for (const readme of ["README.md", "README.ru.md"]) {
      const markdown = readFileSync(readme, "utf8");
      for (const match of markdown.matchAll(/(?<!!)\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
        const target = match[1].replace(/^<|>$/g, "");
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) continue;
        const path = decodeURIComponent(target.split(/[?#]/)[0]).replace(/^\.\//, "");
        if (/\.md$/i.test(path)) assert.ok(files.includes(path), `${readme} links to unpackaged ${path}`);
      }
    }
    assert.ok(files.every((file: string) => /^(?:dist\/tui\.(?:js|d\.ts)|docs\/(?:[^/.][^/]*\/)*[^/.][^/]*\.md|package\.json|LICENSE|README(?:\.ru)?\.md|CHANGELOG\.md|CONTRIBUTING\.md|SECURITY\.md)$/.test(file)), "package contains only public entrypoints and documentation");
    const install = join(directory, "consumer");
    mkdirSync(install);
    writeFileSync(join(install, "package.json"), JSON.stringify({ private: true, type: "module" }));
    execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(directory, pack.filename)], { cwd: install, stdio: "pipe" });
    const manifest = JSON.parse(readFileSync(join(install, "node_modules/opencode-command-hotkeys/package.json"), "utf8"));
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.exports["./tui"].types, "./dist/tui.d.ts");
    execFileSync(process.execPath, ["--input-type=module", "-e", "import plugin from 'opencode-command-hotkeys/tui'; if (typeof plugin.setup !== 'function') throw Error('missing setup')"], { cwd: install, stdio: "pipe" });
    const consumerRequire = createRequire(join(install, "package.json"));
    assert.throws(() => consumerRequire.resolve("@opencode/plugin/tui"), { code: "MODULE_NOT_FOUND" }, "consumer must not resolve the repository's development SDK through ancestor directories");
    writeFileSync(join(install, "consumer.ts"), [
      'import plugin, { parseBindings, type Binding } from "opencode-command-hotkeys/tui";',
      'const bindings: Binding[] = parseBindings({});',
      'const setup: NonNullable<typeof plugin.setup> = plugin.setup!;',
      'void bindings;',
      'void setup;',
      '',
    ].join("\n"));
    writeFileSync(join(install, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
      files: ["consumer.ts"],
    }));
    const compile = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--project", join(install, "tsconfig.json"), "--pretty", "false"], { cwd: install, encoding: "utf8" });
    assert.ifError(compile.error);
    assert.equal(compile.status, 0, `isolated TypeScript consumer must compile without the development SDK:\n${compile.stdout}${compile.stderr}`);
  } finally {
    assert.notEqual(resolve(directory), resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  }
});
