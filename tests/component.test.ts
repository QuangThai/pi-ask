import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { QuestionnaireComponent } from "../src/component.js";
import type { Question } from "../src/schema.js";

/** Terminal control sequences expected by pi-tui's matchesKey */
const KEYS = {
  enter: "\r",
  escape: "\x1b",
  space: " ",
  backspace: "\x7f",
  up: "\x1b[A",
  down: "\x1b[B",
  left: "\x1b[D",
  right: "\x1b[C",
};

const questions: Question[] = [
  {
    id: "storage",
    header: "Storage",
    question: "Where should answers be stored?",
    context: "Answers must respect session branches.",
    multiSelect: false,
    options: [
      { value: "details", label: "Tool details", recommended: true },
      { value: "file", label: "Local file" },
    ],
  },
  {
    id: "ui",
    header: "UI",
    question: "Which interaction styles?",
    multiSelect: true,
    options: [
      { value: "review", label: "Review tab" },
      { value: "other", label: "Custom answer" },
    ],
  },
];

const tui = { requestRender() {} };
const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

describe("QuestionnaireComponent", () => {
  it("renders choices, custom row, and review tab label", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );
    const output = component.render(80).join("\n");
    expect(output).toContain("Tool details");
    expect(output).toContain("Local file");
    expect(output).toContain("Other — add your own answer");
    expect(output).toContain("Tool details (Recommended)");
    expect(output).not.toContain("✓ Tool details");
    expect(output).toContain("Submit");
  });

  it("moves recommended option to the top even when declared later", () => {
    let result: unknown;
    const unordered: Question[] = [
      {
        id: "pick",
        header: "Pick",
        question: "Choose one",
        multiSelect: false,
        options: [
          { value: "a", label: "Alpha" },
          { value: "b", label: "Bravo", recommended: true },
          { value: "c", label: "Charlie" },
        ],
      },
    ];
    const component = new QuestionnaireComponent(
      unordered,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    const lines = component.render(80);
    const bravo = lines.findIndex((line) => line.includes("Bravo"));
    const alpha = lines.findIndex((line) => line.includes("Alpha"));
    const charlie = lines.findIndex((line) => line.includes("Charlie"));
    expect(bravo).toBeGreaterThan(-1);
    expect(bravo).toBeLessThan(alpha);
    expect(alpha).toBeLessThan(charlie);
    expect(lines[bravo]).toContain("(Recommended)");

    // Cursor starts on first row (recommended); Enter selects + confirms
    component.handleInput(KEYS.enter);
    component.handleInput(KEYS.enter); // Review → Submit
    expect(result).toMatchObject({
      status: "submitted",
      answers: [{ questionId: "pick", selectedValues: ["b"] }],
    });
  });

  it("submits answers after confirming all questions", () => {
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    // Q1 (single-select, tool-details auto-selected): confirm
    component.handleInput(KEYS.enter);

    // Q2 (multi-select): toggle Review then Custom, confirm
    component.handleInput(KEYS.space);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.space);
    component.handleInput(KEYS.enter);

    // Review tab: submit
    component.handleInput(KEYS.enter);

    expect(result).toMatchObject({
      status: "submitted",
      answers: [
        { questionId: "storage", selectedValues: ["details"] },
        { questionId: "ui", selectedValues: ["review", "other"] },
      ],
    });
  });

  it("shows both selected options and Other text in review", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    component.handleInput(KEYS.enter);
    component.handleInput(KEYS.space);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.enter);
    component.handleInput("Include export");
    component.handleInput(KEYS.enter);
    component.handleInput(KEYS.enter);

    const review = component.render(80).join("\n");
    expect(review).toContain("Review tab");
    expect(review).toContain("Include export");
  });

  it("dismisses on escape", () => {
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.escape);
    expect(result).toBeNull();
  });

  it("saves, confirms, and continues with a single Enter on an Other answer", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    component.handleInput(KEYS.down);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.enter);
    component.handleInput("SQLite");
    component.handleInput(KEYS.enter);

    // One Enter from the editor saves AND advances to the next tab.
    expect(component.render(80).join("\n")).toContain(
      "Which interaction styles?",
    );

    // Going back shows the saved preview on the question tab.
    component.handleInput(KEYS.left);
    expect(component.render(80).join("\n")).toContain(
      "Other — add your own answer: SQLite",
    );
  });

  it("keeps saved Other text when the user cancels a later edit", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    component.handleInput(KEYS.down);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.enter);
    component.handleInput("keep this");
    component.handleInput(KEYS.enter); // saves + continues to next tab
    component.handleInput(KEYS.left); // back to the answered tab
    component.handleInput(KEYS.space); // reopen the Other editor
    component.handleInput(KEYS.escape); // cancel the edit

    expect(component.render(80).join("\n")).toContain("keep this");
  });

  it("renders multiline Other text as a safe inline preview", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    component.handleInput(KEYS.down);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.enter);
    component.handleInput("first\nsecond");
    component.handleInput(KEYS.enter); // saves + continues
    component.handleInput(KEYS.left); // back to the answered tab

    const lines = component.render(80);
    expect(lines.join("\n")).toContain("first ↵ second");
    expect(lines.some((line) => line.includes("first\nsecond"))).toBe(false);
  });

  it("blocks submit after a confirmed Other answer is cleared", () => {
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.down);
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.enter);
    component.handleInput("SQLite");
    component.handleInput(KEYS.enter); // saves + confirms -> Q2

    // Go back and clear the confirmed Other answer.
    component.handleInput(KEYS.left);
    component.handleInput(KEYS.space); // reopen the Other editor
    for (let i = 0; i < "SQLite".length; i++) {
      component.handleInput(KEYS.backspace);
    }
    component.handleInput(KEYS.enter); // blank save -> cleared, stays unconfirmed

    component.handleInput(KEYS.right);
    component.handleInput(KEYS.right);
    component.handleInput(KEYS.enter);

    expect(result).toBeUndefined();
  });

  it("does not submit an unanswered questionnaire from the review tab", () => {
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.left);
    component.handleInput(KEYS.enter);

    expect(component.render(80).join("\n")).toContain("Review your answers");
    expect(result).toBeUndefined();
  });

  it("allows an optional question to be skipped and omits it from the result", () => {
    let result: unknown;
    const optionalQuestion: Question = {
      ...questions[0],
      required: false,
    };
    const component = new QuestionnaireComponent(
      [optionalQuestion],
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.enter);
    expect(component.render(80).join("\n")).toContain("Skipped");

    component.handleInput(KEYS.enter);
    expect(result).toMatchObject({ status: "submitted", answers: [] });
  });

  it("hides a conditional follow-up until the parent matches", () => {
    let result: unknown;
    const conditional: Question[] = [
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
    ];
    const component = new QuestionnaireComponent(
      conditional,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    expect(component.render(80).join("\n")).not.toContain("□ DB");

    // Confirm Frontend — child stays hidden; jumps to Review
    component.handleInput(KEYS.enter);
    const afterFrontend = component.render(80).join("\n");
    expect(afterFrontend).toContain("Review your answers");
    expect(afterFrontend).not.toContain("DB:");

    component.handleInput(KEYS.enter);
    expect(result).toMatchObject({
      status: "submitted",
      answers: [{ questionId: "stack", selectedValues: ["frontend"] }],
    });
  });

  it("shows a conditional follow-up after a matching parent answer", () => {
    let result: unknown;
    const conditional: Question[] = [
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
    ];
    const component = new QuestionnaireComponent(
      conditional,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.down);
    component.handleInput(KEYS.enter);
    expect(component.render(80).join("\n")).toContain("Which database?");

    component.handleInput(KEYS.enter);
    component.handleInput(KEYS.enter);
    expect(result).toMatchObject({
      status: "submitted",
      answers: [
        { questionId: "stack", selectedValues: ["backend"] },
        { questionId: "db", selectedValues: ["postgres"] },
      ],
    });
  });

  it("advances to the next tab when a single-select option is picked with Space", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    component.handleInput(KEYS.space); // pick "Tool details" (Q1)
    expect(component.render(80).join("\n")).toContain(
      "Which interaction styles?",
    );
  });

  it("saves Other text and continues without clearing multi-select picks", () => {
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.enter); // Q1: pick & go -> Q2
    component.handleInput(KEYS.space); // Q2: toggle "Review tab"
    component.handleInput(KEYS.down);
    component.handleInput(KEYS.down); // Q2 cursor -> Other row
    component.handleInput(KEYS.enter); // open editor
    component.handleInput("Add an export option");
    component.handleInput(KEYS.enter); // save + confirm -> Review

    expect(component.render(80).join("\n")).toContain("Review your answers");

    component.handleInput(KEYS.enter); // submit
    expect(result).toMatchObject({
      status: "submitted",
      answers: [
        { questionId: "storage", selectedValues: ["details"] },
        {
          questionId: "ui",
          selectedValues: ["review"],
          customText: "Add an export option",
        },
      ],
    });
  });

  it("wraps tab navigation from the first question to review", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    component.handleInput(KEYS.left);
    expect(component.render(80).join("\n")).toContain("Review your answers");

    component.handleInput(KEYS.right);
    expect(component.render(80).join("\n")).toContain(
      "Where should answers be stored?",
    );
  });

  it("renders safely at narrow terminal widths", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );

    for (const width of [0, 1, 2, 8, 16]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(Math.max(1, width));
      }
    }
  });

  it("keeps Unicode labels within very narrow terminal widths", () => {
    const unicodeQuestions: Question[] = [
      {
        id: "unicode",
        header: "日本語",
        question: "Choose 😀 or 界",
        multiSelect: false,
        options: [
          { value: "emoji", label: "😀 emoji" },
          { value: "cjk", label: "界 CJK" },
        ],
      },
    ];
    const component = new QuestionnaireComponent(
      unicodeQuestions,
      tui as never,
      theme as never,
      () => {},
    );

    for (const width of [1, 2, 3, 8, 16]) {
      for (const line of component.render(width)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("navigates away from and dismisses the review tab", () => {
    let result: unknown;
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      (value) => {
        result = value;
      },
    );

    component.handleInput(KEYS.right);
    component.handleInput(KEYS.right);
    expect(component.render(80).join("\n")).toContain("Review your answers");

    component.handleInput(KEYS.left);
    expect(component.render(80).join("\n")).toContain(
      "Which interaction styles?",
    );

    component.handleInput(KEYS.right);
    component.handleInput(KEYS.escape);
    expect(result).toBeNull();
  });

  it("moves cursor with up/down keys", () => {
    const component = new QuestionnaireComponent(
      questions,
      tui as never,
      theme as never,
      () => {},
    );
    component.handleInput(KEYS.down);
    const lines = component.render(80).join("\n");
    expect(lines).toContain("Local file");

    component.handleInput(KEYS.up);
    const lines2 = component.render(80).join("\n");
    expect(lines2).toContain("Tool details");
  });
});
