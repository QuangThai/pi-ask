/**
 * Regressions for the issues found in the extension audit.
 *
 * Each test below pins a behaviour that used to be wrong: a model-shaped call
 * that was rejected instead of repaired, a keystroke that discarded the user's
 * pick, a header that reached the terminal as a broken glyph, or a result the
 * model could not map back to the keys it supplied.
 */
import {
  KeybindingsManager,
  TUI_KEYBINDINGS,
  visibleWidth,
} from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { QuestionnaireComponent } from "../src/component.js";
import registerExtension from "../src/index.js";
import type { Question } from "../src/schema.js";
import {
  HEADER_DISPLAY_MAX,
  MAX_OPTIONS,
  normalizeQuestionArgs,
  truncateHeader,
  validateQuestions,
} from "../src/schema.js";
import { at, createFakePiState, emit, fakePi } from "./helpers.js";

const KEYS = {
  enter: "\r",
  escape: "\x1b",
  space: " ",
  up: "\x1b[A",
  down: "\x1b[B",
  ctrlY: "\x19",
  ctrlC: "\x03",
};

const tui = { requestRender() {} };
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

function loadTool() {
  const state = createFakePiState();
  let definition:
    | {
        prepareArguments: (args: unknown) => unknown;
        execute: (...args: never[]) => Promise<{
          content: { type: string; text: string }[];
          details: { status: string };
        }>;
        renderResult: (...args: never[]) => { render: (w: number) => string[] };
      }
    | undefined;
  registerExtension(
    fakePi((tool) => {
      definition = tool as typeof definition;
    }, state),
  );
  if (!definition) throw new Error("tool was not registered");
  return { tool: definition, state };
}

describe("model-shaped input is repaired, not rejected", () => {
  it("keeps multi-line context and option descriptions", () => {
    const prepared = normalizeQuestionArgs({
      questions: [
        {
          id: "stack",
          header: "Stack",
          question: "Which stack?",
          context: "Two constraints:\n- must run offline\n- must be typed",
          options: [
            { value: "node", label: "Node", description: "fast\nand boring" },
            { value: "deno", label: "Deno" },
          ],
        },
      ],
    });

    const question = at(prepared.questions, 0);
    expect(question.context).toContain("\n");
    expect(at(question.options, 0).description).toContain("\n");
    expect(validateQuestions(prepared.questions)).toBeUndefined();
  });

  it("collapses line breaks in fields rendered as a single line", () => {
    const prepared = normalizeQuestionArgs({
      questions: [
        {
          id: "q\n1",
          header: "Two\nlines",
          question: "Pick",
          options: [
            { value: "a\nb", label: "First\nline" },
            { value: "c", label: "Second" },
          ],
        },
      ],
    });

    const question = at(prepared.questions, 0);
    expect(question.id).toBe("q 1");
    expect(question.header).toBe("Two lines");
    expect(at(question.options, 0).label).toBe("First line");
    expect(at(question.options, 0).value).toBe("a b");
    expect(validateQuestions(prepared.questions)).toBeUndefined();
  });

  it("strips escape sequences the model may echo back", () => {
    const prepared = normalizeQuestionArgs({
      questions: [
        {
          id: "q1",
          header: "Colors",
          question: "\u001b[31mPick one\u001b[0m",
          options: [
            { value: "a", label: "\u001b[1mBold\u001b[0m" },
            { value: "b", label: "Plain" },
          ],
        },
      ],
    });

    const question = at(prepared.questions, 0);
    expect(question.question).toBe("Pick one");
    expect(at(question.options, 0).label).toBe("Bold");
    expect(validateQuestions(prepared.questions)).toBeUndefined();
  });

  it("drops extra options instead of failing a five-option call", () => {
    const prepared = normalizeQuestionArgs({
      questions: [
        {
          id: "q1",
          header: "Pick",
          question: "Pick one",
          options: [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
            { value: "c", label: "C" },
            { value: "d", label: "D" },
            { value: "e", label: "E", recommended: true },
          ],
        },
      ],
    });

    const options = at(prepared.questions, 0).options;
    expect(options).toHaveLength(MAX_OPTIONS);
    // The recommended option is moved to the front first, so it survives.
    expect(at(options, 0).value).toBe("e");
    expect(validateQuestions(prepared.questions)).toBeUndefined();
  });
});

describe("header truncation", () => {
  it("never emits a lone surrogate", () => {
    const header = truncateHeader("abcdefghijk🚀more");
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(header)).toBe(false);
    expect(visibleWidth(header)).toBeLessThanOrEqual(HEADER_DISPLAY_MAX);
  });

  it("measures wide characters in terminal columns", () => {
    const header = truncateHeader("日本語のヘッダーテキストです");
    expect(visibleWidth(header)).toBeLessThanOrEqual(HEADER_DISPLAY_MAX);
    expect(header).toBe("日本語のヘッ");
  });

  it("leaves a header that already fits untouched", () => {
    expect(truncateHeader("Storage")).toBe("Storage");
  });

  it("keeps the truncated header free of escape sequences", () => {
    expect(truncateHeader("A very long header indeed")).not.toContain("\u001b");
  });
});

describe("keyboard bindings follow the user's configuration", () => {
  const questions: Question[] = [
    {
      id: "q1",
      header: "Pick",
      question: "Pick one",
      multiSelect: false,
      options: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Bravo" },
      ],
    },
  ];

  it("confirms with a remapped confirm key and ignores the default", () => {
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
      "tui.select.confirm": "ctrl+y",
    });
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
      keybindings,
    );

    component.handleInput(KEYS.enter);
    expect(result).toBeUndefined();

    component.handleInput(KEYS.ctrlY); // select + advance to review
    component.handleInput(KEYS.ctrlY); // submit
    expect(result).toMatchObject({
      status: "submitted",
      answers: [{ questionId: "q1", selectedValues: ["a"] }],
    });
  });

  it("cancels with every key bound to tui.select.cancel", () => {
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS);
    let result: unknown = "untouched";
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
      keybindings,
    );

    component.handleInput(KEYS.ctrlC);
    expect(result).toBeNull();
  });

  it("renders hints with the configured key", () => {
    const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, {
      "tui.select.confirm": "ctrl+y",
    });
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
      keybindings,
    );

    expect(component.render(80).join("\n")).toContain("Ctrl+Y");
  });
});

describe("tool lifecycle", () => {
  it("drops itself on session_start outside an interactive terminal", () => {
    const { state } = loadTool();
    expect(state.activeTools).toContain("ask_user_question");

    emit(state, "session_start", { mode: "print" });
    expect(state.activeTools).not.toContain("ask_user_question");
    expect(state.activeTools).toContain("read");
  });

  it("stays registered in TUI mode", () => {
    const { state } = loadTool();
    emit(state, "session_start", { mode: "tui" });
    expect(state.activeTools).toContain("ask_user_question");
  });
});

describe("result reporting", () => {
  const args = {
    questions: [
      {
        id: "persistence",
        header: "Persist",
        question: "How should answers persist?",
        multiSelect: false,
        options: [
          { value: "details", label: "Tool result details" },
          { value: "file", label: "Local file" },
        ],
      },
    ],
  };
  const submitted = {
    details: {
      version: 1,
      status: "submitted",
      answers: [
        {
          questionId: "persistence",
          selectedValues: ["details"],
          customText: "plus a sidecar file",
        },
      ],
    },
    content: [],
  };

  it("returns the stable option value to the model", async () => {
    const { tool } = loadTool();
    const prepared = tool.prepareArguments(args) as { questions: Question[] };
    const questions = prepared.questions;

    let submit: ((value: unknown) => void) | undefined;
    const execution = tool.execute(
      "call-id" as never,
      { questions } as never,
      undefined as never,
      undefined as never,
      {
        mode: "tui",
        ui: {
          custom: (factory: (...factoryArgs: never[]) => unknown) =>
            new Promise((resolve) => {
              factory(
                tui as never,
                theme as never,
                undefined as never,
                ((value: unknown) => resolve(value)) as never,
              );
              submit = resolve;
            }),
        },
      } as never,
    );

    submit?.({
      version: 1,
      status: "submitted",
      answers: [{ questionId: "persistence", selectedValues: ["details"] }],
    });

    const result = await execution;
    expect(at(result.content, 0).text).toBe(
      `persistence: details ("Tool result details")`,
    );
  });

  it("shows the full question and answer in the default transcript", () => {
    const { tool } = loadTool();
    const lines = tool
      .renderResult(
        submitted as never,
        { expanded: false } as never,
        theme as never,
        { args } as never,
      )
      .render(120);

    expect(at(lines, 0)).toContain("How should answers persist?");
    expect(at(lines, 1)).toContain(
      "Tool result details; (wrote) plus a sidecar file",
    );
    expect(lines.join("\n")).not.toContain("[details]");
    expect(at(lines, 3)).toContain("to expand");
  });

  it("shows the stable keys and full free text when expanded", () => {
    const { tool } = loadTool();
    const text = tool
      .renderResult(
        submitted as never,
        { expanded: true } as never,
        theme as never,
        { args } as never,
      )
      .render(120)
      .join("\n");

    expect(text).toContain("Tool result details [details]");
    expect(text).toContain("plus a sidecar file");
    expect(text).not.toContain("to expand");
  });

  it("separates full question/answer pairs and keeps multi-select and Other text", () => {
    const { tool } = loadTool();
    const result = {
      content: [],
      details: {
        version: 1,
        status: "submitted",
        answers: [
          { questionId: "food", selectedValues: ["pho"] },
          {
            questionId: "features",
            selectedValues: ["search", "export"],
            customText: "Offline\nSupport",
          },
        ],
      },
    };
    const context = {
      args: {
        questions: [
          {
            id: "food",
            header: "Food",
            question: "Bạn thích món ăn nào?",
            options: [{ value: "pho", label: "Phở" }],
          },
          {
            id: "features",
            header: "Features",
            question: "Which features do you need?",
            options: [
              { value: "search", label: "Search" },
              { value: "export", label: "Export" },
            ],
          },
        ],
      },
    };
    const before = JSON.stringify({ result, context });
    const text = tool
      .renderResult(
        result as never,
        { expanded: false } as never,
        theme as never,
        context as never,
      )
      .render(100)
      .map((line) => line.trimEnd())
      .join("\n");
    expect(text).toContain(
      "Bạn thích món ăn nào?\nPhở\n\nWhich features do you need?\nSearch, Export; (wrote) Offline\nSupport",
    );
    expect(text).not.toContain("[pho]");
    expect(JSON.stringify({ result, context })).toBe(before);
  });

  it("wraps and sanitizes full questions and answers at narrow widths", () => {
    const { tool } = loadTool();
    const result = {
      content: [],
      details: {
        version: 1,
        status: "submitted",
        answers: [
          {
            questionId: "q",
            selectedValues: [],
            customText: `\u001b[2J${"Phở 日本語 ".repeat(20)}`,
          },
        ],
      },
    };
    const context = {
      args: {
        questions: [
          {
            id: "q",
            header: "Short",
            question:
              "\u001b[31mWhich approach should we use?\nPlease explain.",
            options: [],
          },
        ],
      },
    };
    for (const width of [12, 24, 80]) {
      const lines = tool
        .renderResult(
          result as never,
          { expanded: false } as never,
          theme as never,
          context as never,
        )
        .render(width);
      expect(
        lines.every(
          (line) => visibleWidth(line) <= width && !line.includes("\n"),
        ),
      ).toBe(true);
      const text = lines.join("\n");
      expect(text).not.toContain("\u001b");
      expect(text).not.toContain("Short");
      const unwrapped = text.replace(/\s/g, "");
      expect(unwrapped.match(/Phở/g)).toHaveLength(20);
      expect(unwrapped.match(/日本語/g)).toHaveLength(20);
      expect(text).not.toContain("to expand");
    }
  });

  it("shows the question and label when the model omitted ids and values", () => {
    const { tool } = loadTool();
    // What the model sends and what Pi hands renderResult as context.args.
    const raw = {
      questions: [
        {
          header: "Defaults",
          question: "Which defaults should we ship?",
          options: [
            { label: "Both, recommended marked 🚀", recommended: true },
            { label: "Neither" },
          ],
        },
      ],
    };
    // execute() ran on the prepared arguments, so the answer carries derived keys.
    const prepared = tool.prepareArguments(raw) as { questions: Question[] };
    const question = prepared.questions[0];
    const option = question?.options[0];
    expect(question?.id).toBeTruthy();
    expect(option?.value).toBeTruthy();
    const result = {
      content: [],
      details: {
        version: 1,
        status: "submitted",
        answers: [
          {
            questionId: question?.id,
            selectedValues: [option?.value],
          },
        ],
      },
    };
    const render = (expanded: boolean) =>
      tool
        .renderResult(
          result as never,
          { expanded } as never,
          theme as never,
          { args: raw } as never,
        )
        .render(120)
        .map((line) => line.trimEnd())
        .join("\n");

    const collapsed = render(false);
    expect(collapsed).toContain(
      "Which defaults should we ship?\nBoth, recommended marked 🚀",
    );
    expect(collapsed).toContain("to expand");
    expect(collapsed).not.toContain(question?.id ?? "?");
    expect(render(true)).toContain(
      `Both, recommended marked 🚀 [${option?.value}]`,
    );
    expect(JSON.stringify(raw)).not.toContain('"id"');
  });

  it("uses the header for older calls without question text", () => {
    const { tool } = loadTool();
    const text = tool
      .renderResult(
        submitted as never,
        { expanded: false } as never,
        theme as never,
        {
          args: {
            questions: [{ id: "persistence", header: "Persist", options: [] }],
          },
        } as never,
      )
      .render(120)
      .map((line) => line.trimEnd())
      .join("\n");
    expect(text).toContain("Persist\ndetails; (wrote) plus a sidecar file");
  });

  it("falls back to raw ids when the call arguments are unavailable", () => {
    const { tool } = loadTool();
    const lines = tool
      .renderResult(
        submitted as never,
        { expanded: false } as never,
        theme as never,
        {} as never,
      )
      .render(120);

    expect(at(lines, 0)).toContain("persistence");
    expect(at(lines, 1)).toContain("details");
  });
});
