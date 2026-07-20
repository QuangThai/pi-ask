import { describe, expect, it } from "vitest";
import registerExtension from "../src/index.js";
import type { Question } from "../src/schema.js";
import {
  normalizeQuestions,
  validateQuestions,
  withRecommendedFirst,
} from "../src/schema.js";
import {
  createQuestionnaireState,
  reduceQuestionnaire,
  toResult,
} from "../src/state.js";

describe("tool integration helpers", () => {
  it("stable-partitions recommended options to the front", () => {
    const options = [
      { value: "a", label: "Alpha" },
      { value: "b", label: "Bravo", recommended: true },
      { value: "c", label: "Charlie" },
      { value: "d", label: "Delta", recommended: true },
    ];
    expect(withRecommendedFirst(options).map((o) => o.value)).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    expect(
      withRecommendedFirst(options.slice(0, 2)).map((o) => o.value),
    ).toEqual(["b", "a"]);
    expect(
      withRecommendedFirst(options.filter((option) => !option.recommended)).map(
        (option) => option.value,
      ),
    ).toEqual(["a", "c"]);
  });

  it("rejects malformed question payloads without throwing", () => {
    expect(() => validateQuestions(undefined as never)).not.toThrow();
    expect(validateQuestions(undefined as never)).toBe(
      "Questions must be an array.",
    );
    expect(validateQuestions([null] as never)).toBe(
      "Question 1 must be an object.",
    );
  });

  it("defaults an omitted multiSelect flag to false", () => {
    const questions = [
      {
        id: "scope",
        header: "Scope",
        question: "What do you want?",
        options: [
          { value: "a", label: "Option A" },
          { value: "b", label: "Option B" },
        ],
      },
    ] satisfies Question[];

    expect(validateQuestions(questions)).toBeUndefined();
    expect(normalizeQuestions(questions)[0]?.multiSelect).toBe(false);
  });

  it("rejects a non-boolean multiSelect flag", () => {
    expect(
      validateQuestions([
        {
          id: "scope",
          header: "Scope",
          question: "What do you want?",
          multiSelect: "false",
          options: [
            { value: "a", label: "Option A" },
            { value: "b", label: "Option B" },
          ],
        },
      ]),
    ).toBe("Question multiSelect must be a boolean: scope.");
  });

  it("returns invalid instead of throwing for malformed tool parameters", async () => {
    let definition:
      | {
          execute: (...args: never[]) => Promise<{
            details: { status: string };
          }>;
        }
      | undefined;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);

    const result = await definition?.execute(
      "call-id" as never,
      null as never,
      undefined as never,
      undefined as never,
      { mode: "rpc" } as never,
    );

    expect(result?.details.status).toBe("invalid");
  });

  it("rejects terminal control characters in display text", () => {
    const questions = [
      {
        id: "q1",
        header: "Q",
        question: "Test",
        multiSelect: false,
        options: [
          { value: "a", label: "\u001b[31mRed" },
          { value: "b", label: "Blue" },
        ],
      },
    ] satisfies Question[];

    expect(validateQuestions(questions)).toBe(
      "Option label in q1 contains terminal control characters.",
    );
  });

  it("rejects newline characters in model-provided display text", () => {
    const questions = [
      {
        id: "q1",
        header: "Q",
        question: "Test",
        multiSelect: false,
        options: [
          { value: "a", label: "First\nline" },
          { value: "b", label: "Second" },
        ],
      },
    ] satisfies Question[];

    expect(validateQuestions(questions)).toBe(
      "Option label in q1 contains terminal control characters.",
    );
  });

  it("rejects an invalid question count", () => {
    expect(validateQuestions([])).toBe("Provide between 1 and 4 questions.");
  });

  it("rejects an invalid option count", () => {
    const questions = [
      {
        id: "one-option",
        header: "Count",
        question: "Is one enough?",
        multiSelect: false,
        options: [{ value: "only", label: "Only" }],
      },
    ] as Question[];
    expect(validateQuestions(questions)).toBe(
      "Question one-option must have between 2 and 4 options.",
    );
  });

  it("rejects duplicate question ids", () => {
    const questions = [
      {
        id: "dup",
        header: "Q1",
        question: "First?",
        multiSelect: false,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
      {
        id: "dup",
        header: "Q2",
        question: "Second?",
        multiSelect: false,
        options: [
          { value: "c", label: "C" },
          { value: "d", label: "D" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBe("Duplicate question id: dup");
  });

  it("rejects duplicate option values within a question", () => {
    const questions = [
      {
        id: "q1",
        header: "Q",
        question: "Test",
        multiSelect: false,
        options: [
          { value: "same", label: "First" },
          { value: "same", label: "Second" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBe(
      "Duplicate option value in q1: same",
    );
  });

  it("rejects blank identifiers and labels", () => {
    const questions = [
      {
        id: " ",
        header: "Q",
        question: "Test",
        multiSelect: false,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBe("Question id must not be blank.");
  });

  it("accepts an optional question", () => {
    const questions = [
      {
        id: "q1",
        header: "Q",
        question: "Test",
        multiSelect: false,
        required: false,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBeUndefined();
  });

  it("rejects a non-boolean required flag", () => {
    const questions = [
      {
        id: "q1",
        header: "Q",
        question: "Test",
        multiSelect: false,
        required: "false",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBe(
      "Question required must be a boolean: q1.",
    );
  });

  it("accepts a valid showWhen follow-up", () => {
    const questions = [
      {
        id: "stack",
        header: "Stack",
        question: "What are you building?",
        multiSelect: false,
        options: [
          { value: "frontend", label: "Frontend" },
          { value: "backend", label: "Backend" },
        ],
      },
      {
        id: "db",
        header: "DB",
        question: "Which database?",
        multiSelect: false,
        showWhen: { questionId: "stack", equals: "backend" },
        options: [
          { value: "postgres", label: "Postgres" },
          { value: "sqlite", label: "SQLite" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBeUndefined();
  });

  it("rejects showWhen with an unknown parent id", () => {
    const questions = [
      {
        id: "db",
        header: "DB",
        question: "Which database?",
        multiSelect: false,
        showWhen: { questionId: "missing", equals: "backend" },
        options: [
          { value: "postgres", label: "Postgres" },
          { value: "sqlite", label: "SQLite" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBe(
      "Question showWhen.questionId is unknown: db → missing.",
    );
  });

  it("rejects self-referential showWhen", () => {
    const questions = [
      {
        id: "db",
        header: "DB",
        question: "Which database?",
        multiSelect: false,
        showWhen: { questionId: "db", equals: "postgres" },
        options: [
          { value: "postgres", label: "Postgres" },
          { value: "sqlite", label: "SQLite" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBe(
      "Question showWhen cannot reference itself: db.",
    );
  });

  it("rejects showWhen when the parent is itself conditional", () => {
    const questions = [
      {
        id: "stack",
        header: "Stack",
        question: "What are you building?",
        multiSelect: false,
        options: [
          { value: "frontend", label: "Frontend" },
          { value: "backend", label: "Backend" },
        ],
      },
      {
        id: "db",
        header: "DB",
        question: "Which database?",
        multiSelect: false,
        showWhen: { questionId: "stack", equals: "backend" },
        options: [
          { value: "postgres", label: "Postgres" },
          { value: "sqlite", label: "SQLite" },
        ],
      },
      {
        id: "host",
        header: "Host",
        question: "Where is it hosted?",
        multiSelect: false,
        showWhen: { questionId: "db", equals: "postgres" },
        options: [
          { value: "cloud", label: "Cloud" },
          { value: "local", label: "Local" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBe(
      "Question showWhen parent must not be conditional: host → db.",
    );
  });

  it("rejects showWhen.equals that is not a parent option value", () => {
    const questions = [
      {
        id: "stack",
        header: "Stack",
        question: "What are you building?",
        multiSelect: false,
        options: [
          { value: "frontend", label: "Frontend" },
          { value: "backend", label: "Backend" },
        ],
      },
      {
        id: "db",
        header: "DB",
        question: "Which database?",
        multiSelect: false,
        showWhen: { questionId: "stack", equals: "mobile" },
        options: [
          { value: "postgres", label: "Postgres" },
          { value: "sqlite", label: "SQLite" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBe(
      "Question showWhen.equals is not an option on parent stack: db.",
    );
  });

  it("rejects showWhen when child appears before parent in array", () => {
    const questions = [
      {
        id: "db",
        header: "DB",
        question: "Which database?",
        multiSelect: false,
        showWhen: { questionId: "stack", equals: "backend" },
        options: [
          { value: "postgres", label: "Postgres" },
          { value: "sqlite", label: "SQLite" },
        ],
      },
      {
        id: "stack",
        header: "Stack",
        question: "What are you building?",
        multiSelect: false,
        options: [
          { value: "frontend", label: "Frontend" },
          { value: "backend", label: "Backend" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBe(
      "Question showWhen parent must appear before child: stack → db.",
    );
  });

  it("state machine produces valid result for single question", () => {
    const questions = [
      {
        id: "test",
        header: "Test",
        question: "Pick one",
        multiSelect: false,
        options: [
          { value: "x", label: "X" },
          { value: "y", label: "Y" },
        ],
      },
    ] satisfies Question[];
    const state = [
      { type: "select" as const, optionIndex: 0 },
      { type: "confirm" as const },
    ].reduce(
      (current, action) => reduceQuestionnaire(current, action, questions),
      createQuestionnaireState(questions),
    );

    const result = toResult(questions, state);
    expect(result.status).toBe("submitted");
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0].questionId).toBe("test");
    expect(result.answers[0].selectedValues).toEqual(["x"]);
  });

  it("result with version field for forward compatibility", () => {
    const questions = [] as Question[];
    const result = toResult(questions, createQuestionnaireState(questions));
    expect(result.version).toBe(1);
  });

  it("renders selected values and Other text together in result transcript", () => {
    let definition:
      | {
          renderResult: (...args: never[]) => {
            render: (width: number) => string[];
          };
        }
      | undefined;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);

    const rendered = definition?.renderResult(
      {
        details: {
          version: 1,
          status: "submitted",
          answers: [
            {
              questionId: "features",
              selectedValues: ["review"],
              customText: "Support CSV",
            },
          ],
        },
        content: [],
      } as never,
      {} as never,
      { fg: (_color: string, text: string) => text } as never,
      {} as never,
    );

    const text = rendered?.render(80).join("\n");
    expect(text).toContain("review");
    expect(text).toContain("Support CSV");
  });

  it("renders an explicit skipped summary for empty submitted answers", () => {
    let definition:
      | {
          renderResult: (...args: never[]) => {
            render: (width: number) => string[];
          };
        }
      | undefined;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);

    const text = definition
      ?.renderResult(
        {
          details: { version: 1, status: "submitted", answers: [] },
          content: [],
        } as never,
        {} as never,
        { fg: (_color: string, value: string) => value } as never,
        {} as never,
      )
      .render(80)
      .join("\n");

    expect(text).toContain("All optional questions were skipped.");
  });

  it("renders malformed tool calls defensively", () => {
    let definition:
      | {
          renderCall: (...args: never[]) => {
            render: (width: number) => string[];
          };
        }
      | undefined;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    };

    expect(() =>
      definition?.renderCall(null as never, theme as never, {} as never),
    ).not.toThrow();
    expect(() =>
      definition?.renderCall(
        { questions: {} } as never,
        theme as never,
        {} as never,
      ),
    ).not.toThrow();
    const text = definition
      ?.renderCall(
        { questions: [{ header: "\u001b[2Junsafe" }] } as never,
        theme as never,
        {} as never,
      )
      .render(80)
      .join("\n");
    expect(text).not.toContain("\u001b");
  });

  it("disables the tool in RPC mode because custom TUI needs a terminal", async () => {
    let definition:
      | {
          execute: (...args: never[]) => Promise<{
            details: { status: string };
          }>;
        }
      | undefined;
    let activeTools = ["ask_user_question"];
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
      getActiveTools: () => activeTools,
      setActiveTools: (tools: string[]) => {
        activeTools = tools;
      },
    } as never);

    const result = await definition?.execute(
      "call-id" as never,
      {
        questions: [
          {
            id: "mode",
            header: "Mode",
            question: "Is TUI required?",
            multiSelect: false,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
        ],
      } as never,
      undefined as never,
      undefined as never,
      { mode: "rpc" } as never,
    );

    expect(result?.details.status).toBe("unavailable");
    expect(activeTools).not.toContain("ask_user_question");
  });

  it("returns an aborted result when the signal fires after the TUI opens", async () => {
    let definition:
      | {
          execute: (...args: never[]) => Promise<{
            details: { status: string };
          }>;
        }
      | undefined;
    let onAbort: (() => void) | undefined;
    let settle: ((value: unknown) => void) | undefined;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);

    const execution = definition?.execute(
      "call-id" as never,
      {
        questions: [
          {
            id: "abort-open",
            header: "Abort",
            question: "Abort after opening?",
            multiSelect: false,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
        ],
      } as never,
      {
        aborted: false,
        addEventListener: (_event: string, listener: () => void) => {
          onAbort = listener;
        },
        removeEventListener() {},
      } as never,
      undefined as never,
      {
        mode: "tui",
        ui: {
          custom: (
            factory: (
              tui: unknown,
              theme: unknown,
              kb: unknown,
              done: (value: unknown) => void,
            ) => unknown,
          ) => {
            factory({ requestRender() {} }, {}, undefined, (value) => {
              settle?.(value);
            });
            return new Promise((resolve) => {
              settle = resolve;
            });
          },
        },
      } as never,
    );

    onAbort?.();
    const result = await execution;
    expect(result?.details.status).toBe("aborted");
  });

  it("settles only once when submit and abort interleave", async () => {
    let definition:
      | {
          execute: (...args: never[]) => Promise<{
            details: { status: string };
          }>;
        }
      | undefined;
    let onAbort: (() => void) | undefined;
    let doneCalls = 0;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);

    const result = await definition?.execute(
      "call-id" as never,
      {
        questions: [
          {
            id: "race",
            header: "Race",
            question: "Submit then abort?",
            multiSelect: false,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
        ],
      } as never,
      {
        aborted: false,
        addEventListener: (_event: string, listener: () => void) => {
          onAbort = listener;
        },
        removeEventListener() {},
      } as never,
      undefined as never,
      {
        mode: "tui",
        ui: {
          custom: (
            factory: (
              tui: unknown,
              theme: unknown,
              kb: unknown,
              done: (value: unknown) => void,
            ) => { handleInput: (data: string) => void },
          ) =>
            new Promise((resolve) => {
              const view = factory(
                { requestRender() {} },
                {},
                undefined,
                (value) => {
                  doneCalls++;
                  resolve(value);
                },
              );
              view.handleInput("\r");
              view.handleInput("\r");
              onAbort?.();
            }),
        },
      } as never,
    );

    expect(doneCalls).toBe(1);
    expect(result?.details.status).toBe("submitted");
  });

  it("returns an aborted result before opening the TUI", async () => {
    let definition:
      | {
          execute: (...args: never[]) => Promise<{
            details: { status: string };
          }>;
        }
      | undefined;
    registerExtension({
      registerTool: (tool: typeof definition) => {
        definition = tool;
      },
    } as never);

    const result = await definition?.execute(
      "call-id" as never,
      {
        questions: [
          {
            id: "abort",
            header: "Abort",
            question: "Abort before opening?",
            multiSelect: false,
            options: [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ],
          },
        ],
      } as never,
      { aborted: true } as never,
      undefined as never,
      { mode: "tui" } as never,
    );

    expect(result?.details.status).toBe("aborted");
  });
});
