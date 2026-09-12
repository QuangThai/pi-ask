/** Index into a fixture array, failing loudly instead of returning undefined. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Fixture has no entry at index ${index}`);
  }
  return item;
}

export interface FakePiState {
  activeTools: string[];
  handlers: Map<string, (event: unknown, ctx: unknown) => unknown>;
}

export function createFakePiState(
  activeTools: string[] = ["ask_user_question", "read"],
): FakePiState {
  return { activeTools, handlers: new Map() };
}

/**
 * Minimal ExtensionAPI stand-in: records the registered tool, the active tool
 * set and any event handlers the extension subscribes to.
 */
export function fakePi(
  onRegisterTool: (tool: never) => void,
  state: FakePiState = createFakePiState(),
): never {
  return {
    registerTool: onRegisterTool,
    getActiveTools: () => state.activeTools,
    setActiveTools: (tools: string[]) => {
      state.activeTools = tools;
    },
    on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      state.handlers.set(event, handler);
    },
  } as never;
}

/** Invoke an extension event handler registered through `fakePi`. */
export function emit(
  state: FakePiState,
  event: string,
  ctx: unknown,
  payload: unknown = {},
): void {
  const handler = state.handlers.get(event);
  if (!handler) throw new Error(`No handler registered for "${event}"`);
  handler(payload, ctx);
}
