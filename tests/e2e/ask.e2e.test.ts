/**
 * End-to-end: one `ask_user_question` tool call, from raw model output to the
 * text the model reads back, through the real pieces of pi.
 *
 * The pipeline mirrors `prepareToolCall()` in pi's agent loop:
 *   prepareArguments() -> validateToolArguments() -> execute()
 * where `validateToolArguments` is imported from `@earendil-works/pi-ai`, the
 * same function pi calls, so a schema mistake fails here exactly as it would
 * in a session. The dialog then runs inside a real `TUI` (see tui-harness.ts)
 * and is driven with real terminal byte sequences.
 */
import { validateToolArguments } from "@earendil-works/pi-ai/compat";
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import registerExtension from "../../src/index.js";
import { at, createFakePiState, emit, fakePi } from "../helpers.js";
import { createHost, type Host, KEY, type } from "./tui-harness.js";

interface ToolResult {
  content: { type: string; text: string }[];
  details: { version: number; status: string; answers: unknown[] };
}

interface AskTool {
  name: string;
  parameters: unknown;
  prepareArguments: (args: unknown) => unknown;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<ToolResult>;
  renderCall: (args: unknown, theme: unknown, context: unknown) => never;
  renderResult: (
    result: unknown,
    options: unknown,
    theme: unknown,
    context: unknown,
  ) => never;
}

function loadTool() {
  const state = createFakePiState();
  let tool: AskTool | undefined;
  registerExtension(
    fakePi((registered) => {
      tool = registered as unknown as AskTool;
    }, state),
  );
  if (!tool) throw new Error("ask_user_question was not registered");
  return { tool, state };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

/** prepareArguments + pi's own schema validation, exactly as the agent runs it. */
function prepareAndValidate(tool: AskTool, rawArguments: unknown) {
  const prepared = tool.prepareArguments(rawArguments);
  return validateToolArguments(
    tool as never,
    {
      name: tool.name,
      arguments: prepared,
    } as never,
  ) as unknown;
}

async function runDialog(
  tool: AskTool,
  host: Host,
  rawArguments: unknown,
  keys: string[],
  { signal }: { signal?: AbortSignal } = {},
): Promise<ToolResult> {
  const params = prepareAndValidate(tool, rawArguments);
  const execution = tool.execute("call-1", params, signal, undefined, {
    mode: "tui",
    ui: {
      custom: (factory: never, options: never) => host.custom(factory, options),
    },
  });
  await flush();
  host.press(...keys);
  return execution;
}

describe("e2e: a complete ask_user_question round trip", () => {
  it("repairs a sloppy model payload, runs the dialog, and returns stable values", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });

    // Deliberately the shape a model actually produces on a bad day: options
    // without `value`, a string boolean, multi-line context and description,
    // an over-long header, and five options where the schema allows four.
    const result = await runDialog(
      tool,
      host,
      {
        questions: [
          {
            id: "persistence",
            header: "Persistence strategy",
            question: "How should session state be persisted?",
            context:
              "Two constraints:\n- must survive /tree and /fork\n- no external files",
            multiSelect: "false",
            options: [
              {
                label: "Tool result details",
                description: "Stored in the session JSONL\nand branch aware",
                recommended: "yes",
              },
              { label: "Local file" },
              { label: "Environment variable" },
              { label: "SQLite" },
              { label: "Redis" },
            ],
          },
          {
            id: "ui",
            header: "UI",
            question: "Which interaction styles?",
            multiSelect: true,
            options: [
              { value: "review", label: "Review tab" },
              { value: "custom", label: "Custom answer" },
            ],
          },
        ],
      },
      [
        KEY.enter, // pick the recommended option, advance to the UI tab
        KEY.space, // toggle "Review tab"
        KEY.down,
        KEY.space, // toggle "Custom answer"
        KEY.enter, // confirm the multi-select, advance to review
        KEY.enter, // submit
      ],
    );

    expect(result.details).toMatchObject({
      version: 1,
      status: "submitted",
      answers: [
        { questionId: "persistence", selectedValues: ["tool-result-details"] },
        { questionId: "ui", selectedValues: ["review", "custom"] },
      ],
    });
    expect(at(result.content, 0).text).toBe(
      [
        `persistence: tool-result-details ("Tool result details")`,
        `ui: review ("Review tab"), custom ("Custom answer")`,
      ].join("\n"),
    );
    host.stop();
  });

  it("carries a free-text answer through the inline editor", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });

    const result = await runDialog(
      tool,
      host,
      {
        questions: [
          {
            id: "stack",
            header: "Stack",
            question: "Which stack?",
            options: [
              { value: "node", label: "Node" },
              { value: "deno", label: "Deno" },
            ],
          },
        ],
      },
      [
        KEY.down,
        KEY.down, // "Other — add your own answer"
        KEY.enter, // open the inline editor
        ...type("Bun, actually"),
        KEY.enter, // save, confirm, advance to review
        KEY.enter, // submit
      ],
    );

    expect(result.details.answers).toEqual([
      { questionId: "stack", selectedValues: [], customText: "Bun, actually" },
    ]);
    expect(at(result.content, 0).text).toBe("stack: (wrote) Bun, actually");
    host.stop();
  });

  it("skips an optional question only from its own row", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });
    const args = {
      questions: [
        {
          id: "telemetry",
          header: "Telemetry",
          question: "Send anonymous usage data?",
          required: false,
          options: [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ],
        },
      ],
    };

    const picked = await runDialog(tool, host, args, [KEY.enter, KEY.enter]);
    expect(picked.details.answers).toEqual([
      { questionId: "telemetry", selectedValues: ["yes"] },
    ]);

    const host2 = createHost({ width: 80 });
    const skipped = await runDialog(tool, host2, args, [
      KEY.down,
      KEY.down,
      KEY.down, // "Skip this question"
      KEY.enter,
      KEY.enter, // submit
    ]);
    expect(skipped.details.answers).toEqual([]);
    expect(at(skipped.content, 0).text).toBe(
      "All optional questions were skipped.",
    );
    host.stop();
    host2.stop();
  });

  it("reveals a showWhen follow-up once the parent matches", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });

    const result = await runDialog(
      tool,
      host,
      {
        questions: [
          {
            id: "stack",
            header: "Stack",
            question: "What are you building?",
            options: [
              { value: "frontend", label: "Frontend UI" },
              { value: "backend", label: "Backend API" },
            ],
          },
          {
            id: "db",
            header: "DB",
            question: "Which database?",
            showWhen: { questionId: "stack", equals: "backend" },
            options: [
              { value: "postgres", label: "PostgreSQL" },
              { value: "sqlite", label: "SQLite" },
            ],
          },
        ],
      },
      [
        KEY.down, // Backend API
        KEY.enter, // confirm -> the DB tab appears
        KEY.enter, // PostgreSQL
        KEY.enter, // submit
      ],
    );

    expect(result.details.answers).toEqual([
      { questionId: "stack", selectedValues: ["backend"] },
      { questionId: "db", selectedValues: ["postgres"] },
    ]);
    host.stop();
  });

  it("returns dismissed when the user presses escape", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });

    const result = await runDialog(
      tool,
      host,
      {
        questions: [
          {
            id: "q1",
            header: "Q1",
            question: "Pick",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ],
      },
      [KEY.escape],
    );

    expect(result.details.status).toBe("dismissed");
    expect(at(result.content, 0).text).toBe("Cancelled by user.");
    host.stop();
  });

  it("aborts while the dialog is open", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });
    const controller = new AbortController();

    const params = prepareAndValidate(tool, {
      questions: [
        {
          id: "q1",
          header: "Q1",
          question: "Pick",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    });
    const execution = tool.execute(
      "call-1",
      params,
      controller.signal,
      undefined,
      {
        mode: "tui",
        ui: {
          custom: (factory: never, options: never) =>
            host.custom(factory, options),
        },
      },
    );
    await flush();
    controller.abort();

    const result = await execution;
    expect(result.details.status).toBe("aborted");
    host.stop();
  });

  it("honours a remapped confirm key end to end", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 }, { "tui.select.confirm": "ctrl+y" });

    const result = await runDialog(
      tool,
      host,
      {
        questions: [
          {
            id: "q1",
            header: "Q1",
            question: "Pick",
            options: [
              { value: "a", label: "A" },
              { value: "b", label: "B" },
            ],
          },
        ],
      },
      [KEY.enter, KEY.ctrlY, KEY.ctrlY],
    );

    expect(result.details).toMatchObject({
      status: "submitted",
      answers: [{ questionId: "q1", selectedValues: ["a"] }],
    });
    host.stop();
  });

  it("keeps ctrl+c for the editor while the inline editor is open", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 80 });
    const params = prepareAndValidate(tool, {
      questions: [
        {
          id: "q1",
          header: "Q1",
          question: "Pick",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    });

    let settled = false;
    const execution = tool
      .execute("call-1", params, undefined, undefined, {
        mode: "tui",
        ui: {
          custom: (factory: never, options: never) =>
            host.custom(factory, options),
        },
      })
      .then((value) => {
        settled = true;
        return value;
      });
    await flush();

    host.press(KEY.down, KEY.down, KEY.enter, ...type("draft"));
    // ctrl+c is bound to tui.select.cancel *and* to the editor's copy action;
    // inside the editor the dialog must stay open.
    host.press(KEY.ctrlC);
    await flush();
    expect(settled).toBe(false);

    host.press(KEY.enter, KEY.enter); // save + submit
    const result = await execution;
    expect(result.details.answers).toEqual([
      { questionId: "q1", selectedValues: [], customText: "draft" },
    ]);
    host.stop();
  });
});

describe("e2e: the renderer's width contract", () => {
  const wideArgs = {
    questions: [
      {
        id: "performance-defaults",
        header: "日本語のヘッダーテキストです",
        question:
          "Which performance defaults should the extension ship with for very long questions that must wrap?",
        context:
          "Measured on a cold cache:\n- 120ms p50\n- 480ms p99 with four questions open",
        options: [
          {
            value: "both-recommended",
            label: "Both, with the recommended option marked 🚀",
            description:
              "A description long enough to wrap several times on a narrow terminal, including 日本語 and emoji 🎉",
          },
          { value: "neither", label: "Neither" },
        ],
      },
    ],
  };

  it("renders the dialog at every width without breaking the frame", async () => {
    const { tool } = loadTool();

    for (const width of [20, 24, 40, 80, 120]) {
      const host = createHost({ width });
      const params = prepareAndValidate(tool, wideArgs);
      const execution = tool.execute("call-1", params, undefined, undefined, {
        mode: "tui",
        ui: {
          custom: (factory: never, options: never) =>
            host.custom(factory, options),
        },
      });
      await flush();

      // Walk the whole dialog: every row, the inline editor, and the review
      // tab. Any line wider than the terminal throws inside doRender().
      host.press(
        KEY.down,
        KEY.down,
        KEY.enter,
        ...type("free text ".repeat(12)),
        KEY.escape,
        KEY.up,
        KEY.enter,
        KEY.enter,
      );

      const result = await execution;
      expect(result.details.status).toBe("submitted");
      host.stop();
    }
  });

  it("renders the call and result rows inside the width the host gives", async () => {
    const { tool } = loadTool();
    const host = createHost({ width: 40 });
    const params = prepareAndValidate(tool, wideArgs) as {
      questions: unknown[];
    };

    const details = {
      version: 1,
      status: "submitted",
      answers: [
        {
          questionId: "performance-defaults",
          selectedValues: ["both-recommended"],
          customText: "x".repeat(300),
        },
      ],
    };

    const compact = host.renderDetached(
      tool.renderResult(
        { details, content: [] },
        { expanded: false },
        host.theme,
        { args: params },
      ),
    );
    // One line per answer plus the expand hint, each inside the width.
    expect(compact).toHaveLength(2);
    for (const line of compact) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
    expect(at(compact, 0)).toContain("Both, with the");
    expect(at(compact, 1)).toContain("to expand");

    const expanded = host.renderDetached(
      tool.renderResult(
        { details, content: [] },
        { expanded: true },
        host.theme,
        { args: params },
      ),
    );
    for (const line of expanded) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
    const expandedText = expanded.join("");
    expect(expandedText).toContain("[both-recommended]");
    expect(expandedText).toContain("(wrote)");
    // The full free-text answer survives instead of being cut at the width.
    expect(expanded.length).toBeGreaterThan(compact.length);

    const callRow = host.renderDetached(
      tool.renderCall(params, host.theme, {}),
    );
    for (const line of callRow) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(40);
    }
    host.stop();
  });
});

describe("e2e: mode handling", () => {
  it("removes itself from the model's tool list outside a terminal", async () => {
    const { tool, state } = loadTool();
    emit(state, "session_start", { mode: "print" });
    expect(state.activeTools).not.toContain("ask_user_question");

    const params = prepareAndValidate(tool, {
      questions: [
        {
          id: "q1",
          header: "Q1",
          question: "Pick",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
          ],
        },
      ],
    });
    const result = await tool.execute("call-1", params, undefined, undefined, {
      mode: "print",
      ui: {},
    });
    expect(result.details.status).toBe("unavailable");
  });
});
