import type { Plugin } from "@opencode/plugin/tui";

// Only the host capabilities used here belong in the published declaration.
interface Host {
  readonly options: Readonly<Record<string, unknown>>;
  readonly ui: {
    readonly router: {
      current(): { readonly type: "home" | "plugin" } | { readonly type: "session"; readonly sessionID: string };
    };
    readonly toast: {
      show(options: { variant: "error"; title: string; message: string; sessionID?: string }): void;
    };
  };
  readonly keymap: {
    readonly mode: { current(): string };
    layer(factory: () => {
      mode: "global" | "base";
      commands: {
        id?: string;
        title: string;
        bind: string | false;
        palette?: true;
        enabled: () => boolean;
        run: () => Promise<void>;
      }[];
    }): void;
  };
  readonly client: {
    readonly session: {
      command(input: { sessionID: string; name: string; text: string }): Promise<void>;
      get(input: { sessionID: string }): Promise<{ readonly location: { readonly directory?: string } }>;
    };
    readonly rpc: {
      call(input: {
        rpcID: string; method: string; location: { directory: string }; input: { sessionID: string };
      }): Promise<{ readonly output: unknown }>;
    };
  };
}

interface BindingCommon {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}
export type Binding = BindingCommon & (
  | { readonly action?: "command"; readonly command: string; readonly text?: string }
  | { readonly action: "goal-toggle"; readonly command?: never; readonly text?: never }
);

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Normalize common modifier aliases/order, retaining sequence boundaries.
function keyIdentity(key: string): string {
  const aliases: Record<string, string> = { enter: "return", esc: "escape", pgdown: "pagedown", pgup: "pageup" };
  return key.trim().toLowerCase()
    .replace(/(^|[+,\s>])(enter|esc|pgdown|pgup)(?=$|[+,\s<])/gi, (_, prefix: string, alias: string) => prefix + aliases[alias.toLowerCase()])
    .replace(/\s*\+\s*/g, "+").split(/\s+/).map(step => {
      const parts = step.split("+").map(part => ({ control: "ctrl", option: "meta", alt: "meta" })[part] ?? part);
      const key = parts.pop();
      return [...parts.sort(), key].join("+");
    }).join(" ");
}

/** Validate the whole config before registering any commands. Never echo values. */
export function parseBindings(options: unknown): Binding[] {
  if (!object(options) || Object.keys(options).some(key => key !== "bindings")) {
    throw new Error("Разрешено только поле bindings");
  }
  if (options.bindings === undefined) return [];
  if (!Array.isArray(options.bindings)) throw new Error("bindings должен быть массивом");
  const ids = new Set<string>();
  const keys = new Set<string>();
  return options.bindings.map((value, index) => {
    const invalid = () => new Error(`Проверьте bindings[${index}]: id, key, title и параметры action`);
    if (!object(value) || Object.keys(value).some(key => !["id", "key", "title", "action", "command", "text"].includes(key))) throw invalid();
    if (value.action !== undefined && value.action !== "command" && value.action !== "goal-toggle") throw invalid();
    for (const field of ["id", "key", "title"]) {
      if (typeof value[field] !== "string" || !value[field].trim()) throw invalid();
    }
    const common = {
      id: (value.id as string).trim(), key: (value.key as string).trim(),
      title: (value.title as string).trim(),
    };
    let result: Binding;
    if (value.action === "goal-toggle") {
      if ("command" in value || "text" in value) throw invalid();
      result = { ...common, action: "goal-toggle" };
    } else {
      if (typeof value.command !== "string" || !value.command.trim()) throw invalid();
      if (value.text !== undefined && typeof value.text !== "string") throw invalid();
      const command = value.command.trim();
      if (command.startsWith("/") || /\s/.test(command)) throw invalid();
      result = { ...common, command, ...(value.action === "command" ? { action: "command" as const } : {}), ...(value.text === undefined ? {} : { text: value.text as string }) };
    }
    if (ids.has(result.id)) throw new Error(`Повтор id в bindings[${index}]`);
    ids.add(result.id);
    for (const alternative of result.key.split(",")) {
      if (!alternative.trim()) throw invalid();
      const key = keyIdentity(alternative);
      if (keys.has(key)) throw new Error(`Повтор key в bindings[${index}]`);
      keys.add(key);
    }
    return result;
  });
}

const plugin = {
  id: "command-hotkeys",
  setup(ctx: Host) {
    let bindings: Binding[];
    try {
      bindings = parseBindings(ctx.options);
    } catch {
      ctx.ui.toast.show({ variant: "error", title: "Command Hotkeys", message: "Проверьте bindings: строки id, key, title; для action command нужны command и необязательный text, для goal-toggle они запрещены. Неизвестные поля и повторяющиеся id/key запрещены." });
      return;
    }
    let disposed = false;
    const pending = new Set<string>();
    const available = () => !disposed && ctx.ui.router.current().type === "session";
    const canExecute = () => available() && ctx.keymap.mode.current() === "base";
    async function execute(binding: Binding) {
      if (!canExecute()) return;
      const route = ctx.ui.router.current();
      if (route.type !== "session") return;
      const sessionID = route.sessionID;
      const lockKey = JSON.stringify([sessionID, binding.id]);
      if (pending.has(lockKey)) return;
      pending.add(lockKey);
      try {
        if (binding.action !== "goal-toggle") {
          await ctx.client.session.command({ sessionID, name: binding.command, text: binding.text ?? "" });
          return;
        }
        const stillCurrent = () => {
          const current = ctx.ui.router.current();
          return canExecute() && current.type === "session" && current.sessionID === sessionID;
        };
        const session = await ctx.client.session.get({ sessionID });
        if (!stillCurrent()) return;
        const directory = session.location.directory;
        if (typeof directory !== "string" || !directory.trim()) throw new Error("Invalid session location");
        const response = await ctx.client.rpc.call({ rpcID: "opencode.goal", method: "get", location: { directory }, input: { sessionID } });
        if (!stillCurrent()) return;
        const goal: unknown = response.output;
        if (goal === null) return;
        if (!object(goal) || typeof goal.id !== "string" || !goal.id.trim() || !["active", "paused", "complete"].includes(goal.status as string)) throw new Error("Invalid goal response");
        if (goal.status === "complete") return;
        const text = goal.status === "active" ? "pause" : "resume";
        try {
          // Native API has no goal-id CAS; never fall back to creating an objective.
          await ctx.client.session.command({ sessionID, name: "goal", text });
        } catch (error) {
          const race = text === "pause" ? "No active goal to pause." : "No paused goal to resume.";
          if (!(error instanceof Error && error.message === race)) throw error;
        }
      } catch {
        if (!disposed) ctx.ui.toast.show({
          variant: "error", title: "Command Hotkeys", sessionID,
          message: "Не удалось выполнить команду. Проверьте её имя и аргументы в настройках плагина, доступность сессии и повторите попытку.",
        });
      } finally {
        pending.delete(lockKey);
      }
    }
    const paletteCommands = bindings.map(binding => ({
      id: `command-hotkeys.${binding.id}`,
      title: binding.title,
      bind: false as const,
      palette: true as const,
      enabled: available,
      async run() {
        if (!available()) return;
        const captured = ctx.ui.router.current();
        if (captured.type !== "session") return;
        // Palette selection clears its modal before invoking run; allow its cleanup microtask.
        if (ctx.keymap.mode.current() !== "base") await Promise.resolve();
        const current = ctx.ui.router.current();
        if (current.type !== "session" || current.sessionID !== captured.sessionID || !canExecute()) return;
        await execute(binding);
      },
    }));
    const keyboardCommands = bindings.map(binding => ({
      title: binding.title,
      bind: binding.key,
      enabled: canExecute,
      run: () => execute(binding),
    }));
    // The host owns layer removal. The reactive factory has no side effects.
    if (bindings.length) {
      ctx.keymap.layer(() => ({ mode: "global", commands: paletteCommands }));
      ctx.keymap.layer(() => ({ mode: "base", commands: keyboardCommands }));
    }
    return () => { disposed = true; };
  },
} satisfies Plugin.Definition;

export default plugin;
