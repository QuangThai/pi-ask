import { describe, expect, it } from "vitest";
import registerExtension from "../src/index.js";
import type { Question } from "../src/schema.js";
import { validateQuestions } from "../src/schema.js";
import {
  createQuestionnaireState,
  reduceQuestionnaire,
  toResult,
} from "../src/state.js";

describe("tool integration helpers", () => {
  it("rejects malformed question payloads without throwing", () => {
    expect(() => validateQuestions(undefined as never)).not.toThrow();
    expect(validateQuestions(undefined as never)).toBe(
      "Questions must be an array.",
    );
    expect(validateQuestions([null] as never)).toBe(
      "Question 1 must be an object.",
    );
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

  it("accepts valid input", () => {
    const questions = [
      {
        id: "q1",
        header: "Q",
        question: "Test",
        multiSelect: false,
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ] satisfies Question[];
    expect(validateQuestions(questions)).toBeUndefined();
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
    ].reduce(reduceQuestionnaire, createQuestionnaireState(questions));

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
