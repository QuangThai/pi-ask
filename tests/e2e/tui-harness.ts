/**
 * A real pi TUI, driven from a test.
 *
 * The point of this harness is that nothing about the rendering or input path
 * is simulated: it builds the actual `TuiMainScreen` from
 * `@earendil-works/pi-tui` (the `TUI` pi runs in its regular screen mode), the
 * actual `Theme` from the theme file pi ships, and the actual
 * `KeybindingsManager`, then mounts the component exactly the way pi's
 * interactive mode mounts an extension component in `showExtensionCustom()`
 * (clear the editor container, add the component, move focus, request a
 * render). Keystrokes are delivered as the byte sequences a terminal emits,
 * through `TUI.handleInput`.
 *
 * That matters because the renderer enforces a hard contract — every line a
 * component returns must fit the terminal width, or `doRender()` throws — and
 * this project has already shipped one crash caused by violating it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Container,
  Editor,
  KeybindingsManager,
  type Terminal,
  type TUI,
  TUI_KEYBINDINGS,
  TuiMainScreen,
} from "@earendil-works/pi-tui";

export interface ThemeJson {
  vars: Record<string, string>;
  colors: Record<string, string>;
}

const BACKGROUND_KEYS = new Set([
  "selectedBg",
  "userMessageBg",
  "customMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
]);

const THEME_RELATIVE_PATH = join(
  "node_modules",
  "@earendil-works",
  "pi-coding-agent",
  "dist",
  "modes",
  "interactive",
  "theme",
  "dark.json",
);

/**
 * pi-coding-agent only exports its entry point, so the shipped theme file is
 * located on disk instead of through module resolution.
 */
function findPiThemeFile(from = process.cwd()): string {
  let directory = from;
  for (;;) {
    const candidate = join(directory, THEME_RELATIVE_PATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory || parent === parse(directory).root) {
      throw new Error(`Could not find ${THEME_RELATIVE_PATH} from ${from}`);
    }
    directory = parent;
  }
}

/** Load the dark theme pi ships and build the real Theme instance from it. */
export function loadPiTheme(): Theme {
  const json = JSON.parse(readFileSync(findPiThemeFile(), "utf8")) as ThemeJson;
  const fg: Record<string, string> = {};
  const bg: Record<string, string> = {};
  for (const [key, value] of Object.entries(json.colors)) {
    const resolved = json.vars[value] ?? value;
    if (BACKGROUND_KEYS.has(key)) bg[key] = resolved;
    else fg[key] = resolved;
  }
  return new Theme(fg as never, bg as never, "truecolor");
}

/** Terminal stand-in: records output, replays input, never touches a device. */
class RecordingTerminal implements Terminal {
  private input?: (data: string) => void;
  private resize?: () => void;
  readonly output: string[] = [];
  constructor(
    private width: number,
    private height: number,
  ) {}

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.input = onInput;
    this.resize = onResize;
  }
  stop(): void {
    this.input = undefined;
  }
  async drainInput(): Promise<void> {}
  write(data: string): void {
    this.output.push(data);
  }
  get columns(): number {
    return this.width;
  }
  get rows(): number {
    return this.height;
  }
  get kittyProtocolActive(): boolean {
    return false;
  }
  moveBy(): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(): void {}
  setProgress(): void {}
  setProgramStatus(): void {}

  send(data: string): void {
    if (!this.input) throw new Error("Terminal is not started");
    this.input(data);
  }
  resizeTo(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.resize?.();
  }
}

export interface CustomOptions {
  overlay?: boolean;
}

export type CustomFactory<T> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: T) => void,
) =>
  | (Component & { dispose?(): void })
  | Promise<Component & { dispose?(): void }>;

export interface Host {
  tui: TUI;
  theme: Theme;
  keybindings: KeybindingsManager;
  terminal: RecordingTerminal;
  /** Mount a component the way pi's interactive mode does. */
  custom<T>(factory: CustomFactory<T>, options?: CustomOptions): Promise<T>;
  /** Deliver terminal bytes, then render. Render errors surface here. */
  press(...keys: string[]): void;
  /** Force a full render through the real renderer. */
  render(): void;
  /** Render a component outside the editor container (tool result rows). */
  renderDetached(component: Component): string[];
  resize(width: number, height: number): void;
  stop(): void;
}

export function createHost(
  { width = 80, height = 24 }: { width?: number; height?: number } = {},
  userKeybindings: Record<string, string | string[]> = {},
): Host {
  const terminal = new RecordingTerminal(width, height);
  const tui: TUI = new TuiMainScreen(terminal);
  const theme = loadPiTheme();
  const keybindings = new KeybindingsManager(
    TUI_KEYBINDINGS,
    userKeybindings as never,
  );

  // pi keeps the main editor inside a container and swaps the container's
  // child while an extension component is on screen.
  const editorContainer = new Container();
  const editor = new Editor(tui, {
    borderColor: (s: string) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t: string) => theme.fg("accent", t),
      selectedText: (t: string) => theme.fg("accent", t),
      description: (t: string) => theme.fg("muted", t),
      scrollInfo: (t: string) => theme.fg("dim", t),
      noMatch: (t: string) => theme.fg("warning", t),
    },
  });
  editorContainer.addChild(editor);
  tui.addChild(editorContainer);
  tui.setFocus(editor);
  tui.start();

  // `requestRender()` defers to a tick and throws from there, which would
  // escape the test as an unhandled rejection. Rendering synchronously keeps
  // the width-contract failure attached to the assertion that caused it.
  const renderNow = () => {
    (tui as unknown as { doRender(): void }).doRender();
  };

  const host: Host = {
    tui,
    theme,
    keybindings,
    terminal,
    custom<T>(factory: CustomFactory<T>, options?: CustomOptions): Promise<T> {
      const savedText = editor.getText();
      const restoreEditor = () => {
        editorContainer.clear();
        editorContainer.addChild(editor);
        editor.setText(savedText);
        tui.setFocus(editor);
      };
      return new Promise<T>((resolve, reject) => {
        let component: (Component & { dispose?(): void }) | undefined;
        let closed = false;
        const close = (result: T) => {
          if (closed) return;
          closed = true;
          if (options?.overlay) tui.hideOverlay();
          else restoreEditor();
          resolve(result);
          try {
            component?.dispose?.();
          } catch {
            /* ignore dispose errors, as pi does */
          }
        };
        Promise.resolve(factory(tui, theme, keybindings, close))
          .then((created) => {
            if (closed) return;
            component = created;
            if (options?.overlay) {
              tui.showOverlay(component);
            } else {
              editorContainer.clear();
              editorContainer.addChild(component);
              tui.setFocus(component);
            }
            renderNow();
          })
          .catch((error) => {
            if (closed) return;
            if (!options?.overlay) restoreEditor();
            reject(error);
          });
      });
    },
    press(...keys: string[]) {
      for (const key of keys) {
        terminal.send(key);
        renderNow();
      }
    },
    render: renderNow,
    renderDetached(component: Component): string[] {
      const container = new Container();
      container.addChild(component);
      tui.addChild(container);
      try {
        renderNow();
        return component.render(terminal.columns);
      } finally {
        tui.removeChild(container);
        renderNow();
      }
    },
    resize(nextWidth: number, nextHeight: number) {
      terminal.resizeTo(nextWidth, nextHeight);
      renderNow();
    },
    stop() {
      tui.stop();
    },
  };

  return host;
}

/** Byte sequences a terminal sends for the keys the questionnaire uses. */
export const KEY = {
  enter: "\r",
  escape: "\x1b",
  space: " ",
  tab: "\t",
  shiftTab: "\x1b[Z",
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
  backspace: "\x7f",
  ctrlC: "\x03",
  ctrlY: "\x19",
} as const;

export function type(text: string): string[] {
  return [...text];
}
