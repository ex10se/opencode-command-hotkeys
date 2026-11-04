import assert from "node:assert/strict";
import { test } from "node:test";

// Dynamic loading makes missing implementation an explicit red assertion.
const implementation = await import("../src/tui.ts").catch(() => undefined);
const binding = { id: "resume", key: "ctrl+g", title: "Продолжить", command: "goal", text: "resume" };
const toggle = { id: "toggle", key: "f4", title: "Goal", action: "goal-toggle" };
function host(options: unknown = { bindings: [binding] }) {
  let route: any = { type: "session", sessionID: "one" };
  let mode = "base";
  const layers: any[] = [], calls: any[] = [], toasts: any[] = [];
  let command = async (_: any) => {};
  const context: any = {
    options,
    keymap: { layer: (factory: any) => { factory(); layers.push(factory()); }, mode: { current: () => mode } },
    ui: { router: { current: () => route }, toast: { show: (value: any) => toasts.push(value) } },
    client: { session: { command: (input: any) => { calls.push(input); return command(input); } } },
  };
  Object.defineProperty(context, "composer", { get() { throw new Error("must not touch draft"); } });
  return { context, layers, calls, toasts, route: (value: any) => { route = value; }, mode: (value: string) => { mode = value; }, command: (value: typeof command) => { command = value; } };
}
function setup(h = host()) {
  assert.ok(implementation, "TUI implementation must exist");
  const dispose = implementation.default.setup(h.context);
  return { ...h, dispose, action: h.layers.find(layer => layer.mode === "base")?.commands[0], palette: h.layers.find(layer => layer.mode === "global")?.commands[0] };
}
test("no defaults and invalid config registers nothing", () => {
  assert.equal(setup(host({})).layers.length, 0);
  for (const options of [null, [], { extra: true }, { bindings: {} }, { bindings: [null] }, ...["id", "key", "title", "command"].flatMap(field => [{ bindings: [{ ...binding, [field]: " " }] }, { bindings: [{ ...binding, [field]: 42 }] }]), { bindings: [{ ...binding, text: 1 }] }, { bindings: [{ ...binding, extra: 1 }] }, { bindings: [binding, binding] }, { bindings: [binding, { ...binding, id: "other", key: " Control + G " }] }]) {
    const h = setup(host(options));
    assert.equal(h.layers.length, 0);
    assert.equal(h.toasts.length, 1);
  }
});
test("pure config parser snapshots values and detects modifier-order duplicates", () => {
  assert.ok(implementation);
  const input = { bindings: [{ ...binding }] };
  const parsed = implementation.parseBindings(input);
  input.bindings[0].command = "changed";
  assert.equal(parsed[0].command, "goal");
  assert.throws(() => implementation.parseBindings({ bindings: [
    { ...binding, key: "ctrl+shift+g" },
    { ...binding, id: "other", key: "Shift+Control+G" },
  ] }));
});
test("separates named global palette discovery from anonymous base keyboard dispatch", async () => {
  const h = setup();
  assert.equal(h.layers.length, 2);
  assert.equal(h.palette.id, "command-hotkeys.resume");
  assert.equal(h.palette.palette, true);
  assert.equal(h.palette.bind, false);
  for (const field of ["id", "palette", "slash"]) assert.equal(field in h.action, false);
  assert.equal(h.action.bind, "ctrl+g");
  await h.action.run();
  assert.deepEqual(h.calls, [{ sessionID: "one", name: "goal", text: "resume" }]);
  assert.equal(h.toasts.length, 0);
});
test("omitted text becomes empty and explicit whitespace text is preserved", async () => {
  for (const text of [undefined, "  sensitive argument  "]) {
    const h = setup(host({ bindings: [{ ...binding, text }] }));
    await h.action.run();
    assert.equal(h.calls[0].text, text ?? "");
  }
});
test("guards route and input mode both in discovery and direct invocation", async () => {
  const h = setup();
  for (const route of [{ type: "home" }, { type: "plugin", id: "x", name: "x" }]) {
    h.route(route);
    assert.equal(h.action.enabled(), false);
    await h.action.run();
  }
  h.route({ type: "session", sessionID: "one" });
  for (const mode of ["modal", "dialog", "prompt", "custom"]) {
    h.mode(mode);
    assert.equal(h.action.enabled(), false);
    await h.action.run();
  }
  assert.equal(h.calls.length, 0);
  h.mode("base");
  assert.equal(h.action.enabled(), true);
});
test("blocks double invocation but isolates session and binding; captures session immediately", async () => {
  const h = setup(host({ bindings: [binding, { ...binding, id: "second", key: "ctrl+h" }] }));
  let release!: () => void;
  h.command(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = h.action.run();
  await h.action.run();
  assert.equal(h.calls.length, 1);
  h.command(async () => {});
  await h.layers.find(layer => layer.mode === "base").commands[1].run();
  h.route({ type: "session", sessionID: "two" });
  await h.action.run();
  assert.deepEqual(h.calls.map(call => call.sessionID), ["one", "one", "two"]);
  release(); await pending;
  h.route({ type: "session", sessionID: "one" });
  await h.action.run();
  assert.equal(h.calls.length, 4);
});
test("palette stays discoverable in modal while keyboard dispatch returns without waiting", async () => {
  const h = setup();
  h.mode("modal");
  assert.equal(h.palette.enabled(), true);
  assert.equal(h.action.enabled(), false);
  const ignored = h.action.run();
  h.mode("base");
  await ignored;
  assert.equal(h.calls.length, 0);
  await h.palette.run();
  assert.equal(h.calls.length, 1);
});
test("palette tolerates one microtask of modal cleanup and otherwise refuses dispatch", async () => {
  const h = setup();
  h.mode("modal");
  await h.palette.run();
  assert.equal(h.calls.length, 0);
  queueMicrotask(() => h.mode("base"));
  await h.palette.run();
  assert.equal(h.calls.length, 1);
});
test("palette cancels after session navigation or disposal during modal cleanup", async () => {
  for (const change of ["session", "home", "dispose"]) {
    const h = setup();
    h.mode("modal");
    const pending = h.palette.run();
    h.mode("base");
    if (change === "session") h.route({ type: "session", sessionID: "two" });
    if (change === "home") h.route({ type: "home" });
    if (change === "dispose") h.dispose();
    await pending;
    assert.equal(h.calls.length, 0);
  }
});
test("keyboard and palette share the same in-flight lock in either order", async () => {
  for (const first of ["action", "palette"] as const) {
    const h = setup();
    let release!: () => void;
    h.command(() => new Promise<void>(resolve => { release = resolve; }));
    const pending = h[first].run();
    await h[first === "action" ? "palette" : "action"].run();
    assert.equal(h.calls.length, 1);
    release(); await pending;
  }
});
test("normalizes host key aliases and comma alternatives without inventing cmd aliases", () => {
  assert.ok(implementation);
  for (const [a, b] of [["ctrl+pgdown", "ctrl+pagedown"], ["pgup", "pageup"], ["enter", "return"], ["esc", "escape"], ["f4,f5", "f5"], ["alt+x", "meta+x"], ["option+x", "meta+x"]]) {
    assert.throws(() => implementation.parseBindings({ bindings: [binding, { ...binding, id: "a", key: a }, { ...binding, id: "b", key: b }] }));
  }
  for (const key of [",f4", "f4,", "f4,,f5", "f4, f4"]) {
    assert.throws(() => implementation.parseBindings({ bindings: [{ ...binding, key }] }));
  }
  assert.equal(implementation.parseBindings({ bindings: [
    { ...binding, key: "f4,f5" }, { ...binding, id: "b", key: "f6" },
    { ...binding, id: "c", key: "cmd+x" }, { ...binding, id: "d", key: "meta+x" },
  ] }).length, 4);
});
test("command names reject leading slash and embedded whitespace", () => {
  assert.ok(implementation);
  for (const command of ["/goal", "goal resume", "goal\nresume"]) assert.throws(() => implementation.parseBindings({ bindings: [{ ...binding, command }] }));
});
function goalHost() {
  const h = host({ bindings: [toggle] });
  const reads: any[] = [], rpcs: any[] = [];
  h.context.client.session.get = async (input: any) => { reads.push(input); return { location: { directory: "/project" } }; };
  h.context.client.rpc = { call: async (input: any) => { rpcs.push(input); return { output: { id: "goal-id", status: "active" } }; } };
  return { ...setup(h), reads, rpcs };
}
test("binding union accepts explicit command and goal toggle, rejects mixed/unknown actions", () => {
  assert.ok(implementation);
  assert.equal(implementation.parseBindings({ bindings: [toggle, { ...binding, action: "command" }] }).length, 2);
  for (const value of [{ ...toggle, command: "goal" }, { ...toggle, text: "" }, { ...toggle, text: undefined }, { ...binding, action: "unknown" }, { ...toggle, action: null }]) {
    assert.throws(() => implementation.parseBindings({ bindings: [value] }));
  }
});
test("goal toggle uses authoritative session directory and only pause/resume commands", async () => {
  for (const [status, text] of [["active", "pause"], ["paused", "resume"]]) {
    const h = goalHost();
    h.context.client.rpc.call = async (input: any) => { h.rpcs.push(input); return { output: { id: "g", status } }; };
    await h.action.run();
    assert.deepEqual(h.reads, [{ sessionID: "one" }]);
    assert.deepEqual(h.rpcs, [{ rpcID: "opencode.goal", method: "get", location: { directory: "/project" }, input: { sessionID: "one" } }]);
    assert.deepEqual(h.calls, [{ sessionID: "one", name: "goal", text }]);
  }
});
test("absent and complete goals are silent no-ops; malformed protocol is an error", async () => {
  for (const output of [null, { id: "g", status: "complete" }, undefined, {}, { id: 1, status: "active" }, { id: "g", status: "other" }]) {
    const h = goalHost();
    h.context.client.rpc.call = async () => ({ output });
    await h.action.run();
    assert.equal(h.calls.length, 0);
    assert.equal(h.toasts.length, output === null || output?.status === "complete" ? 0 : 1);
  }
});
test("goal toggle locks before either read and rechecks route/mode/disposal after each await", async () => {
  for (const stage of ["session", "rpc"]) for (const change of ["none", "modal", "route", "dispose"]) {
    const h = goalHost();
    let release!: (value: any) => void;
    let count = 0;
    const deferred = () => { count++; return new Promise(resolve => { release = resolve; }); };
    if (stage === "session") h.context.client.session.get = deferred;
    else h.context.client.rpc.call = deferred;
    const pending = h.action.run();
    await Promise.resolve();
    await h.palette.run();
    assert.equal(count, 1);
    if (change === "modal") h.mode("modal");
    if (change === "route") h.route({ type: "session", sessionID: "two" });
    if (change === "dispose") h.dispose();
    release(stage === "session" ? { location: { directory: "/project" } } : { output: { id: "g", status: "active" } });
    await pending;
    assert.equal(h.calls.length, change === "none" ? 1 : 0);
    if (stage === "session" && change !== "none") assert.equal(h.rpcs.length, 0);
  }
});
test("only exact selected goal command race errors are silent and release lock", async () => {
  for (const [status, message] of [["active", "No active goal to pause."], ["paused", "No paused goal to resume."]]) {
    const h = goalHost();
    h.context.client.rpc.call = async () => ({ output: { id: "g", status } });
    h.command(async () => { throw new Error(message); });
    await h.action.run();
    assert.equal(h.toasts.length, 0);
    h.command(async () => {});
    await h.action.run();
    assert.equal(h.calls.length, 2);
  }
});
test("read errors and nonmatching command errors remain visible and retryable", async () => {
  for (const stage of ["session", "rpc", "command"]) {
    const h = goalHost();
    const fail = async () => { throw new Error("No paused goal to resume."); };
    if (stage === "session") h.context.client.session.get = fail;
    if (stage === "rpc") h.context.client.rpc.call = fail;
    if (stage === "command") h.command(fail);
    await h.action.run(); await h.action.run();
    assert.equal(h.toasts.length, 2);
    assert.doesNotMatch(JSON.stringify(h.toasts), /No paused/);
  }
});
test("failure releases guard, gives safe actionable feedback and allows retry", async () => {
  const h = setup();
  h.command(async () => { throw new Error("SECRET argument"); });
  await h.action.run();
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].variant, "error");
  assert.doesNotMatch(JSON.stringify(h.toasts), /SECRET/);
  assert.match(h.toasts[0].message, /повтор/i);
  h.command(async () => {});
  await h.action.run();
  assert.equal(h.calls.length, 2);
});
test("cleanup disables stale handlers and suppresses late failure toast; fresh setup works", async () => {
  const h = setup();
  let reject!: (error: Error) => void;
  h.command(() => new Promise<void>((_, fail) => { reject = fail; }));
  const pending = h.action.run();
  h.dispose();
  assert.equal(h.action.enabled(), false);
  await h.action.run();
  reject(new Error("late")); await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.toasts.length, 0);
  // Host owns removal of the old layer, not the plugin's cleanup.
  h.layers.length = 0;
  h.command(async () => {});
  const next = setup(h);
  await next.action.run();
  assert.equal(next.calls.length, 2);
});
