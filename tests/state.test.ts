import { describe, expect, it } from "vitest";
import { MAX_CUSTOM_TEXT_LENGTH, type Question } from "../src/schema.js";
import {
  createQuestionnaireState,
  isQuestionVisible,
  type QuestionnaireAction,
  reduceQuestionnaire,
  toResult,
  visibleQuestionIndices,
} from "../src/state.js";

const questions: Question[] = [
  {
    id: "persistence",
    header: "Persist",
    question: "How should answers persist?",
    multiSelect: false,
    options: [
      { value: "tool-results", label: "Tool results", recommended: true },
      { value: "file", label: "File" },
    ],
  },
  {
    id: "features",
    header: "Features",
    question: "Which features?",
    multiSelect: true,
    options: [
      { value: "review", label: "Review" },
      { value: "history", label: "History" },
    ],
  },
];

function apply(actions: QuestionnaireAction[], qs: Question[] = questions) {
  return actions.reduce(
    (state, action) => reduceQuestionnaire(state, action, qs),
    createQuestionnaireState(qs),
  );
}

describe("questionnaire state", () => {
  it("requires every question before review can submit", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
    ]);
    expect(state.activeTab).toBe(1);
    expect(state.canSubmit).toBe(false);
  });

  it("records multi-select values and returns a stable result", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
      { type: "toggle", optionIndex: 0 },
      { type: "toggle", optionIndex: 1 },
      { type: "confirm" },
    ]);

    expect(state.activeTab).toBe(2);
    expect(state.canSubmit).toBe(true);
    expect(toResult(questions, state).answers).toEqual([
      { questionId: "persistence", selectedValues: ["tool-results"] },
      { questionId: "features", selectedValues: ["review", "history"] },
    ]);
  });

  it("replaces a selected option with a custom answer", () => {
    const state = apply([
      { type: "startCustom" },
      { type: "saveCustom", value: "Use SQLite" },
      { type: "confirm" },
    ]);
    expect(toResult(questions, state).answers[0]).toEqual({
      questionId: "persistence",
      selectedValues: [],
      customText: "Use SQLite",
    });
    expect(state.editing).toBeUndefined();
  });

  it("serializes multi-select values in source option order", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
      { type: "toggle", optionIndex: 1 },
      { type: "toggle", optionIndex: 0 },
      { type: "confirm" },
    ]);

    expect(toResult(questions, state).answers[1]?.selectedValues).toEqual([
      "review",
      "history",
    ]);
  });

  it("adds Other text without clearing multi-select values", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
      { type: "toggle", optionIndex: 0 },
      {
        type: "saveCustom",
        value: "Include an export",
        clearSelections: false,
      },
      { type: "confirm" },
    ]);

    expect(toResult(questions, state).answers[1]).toEqual({
      questionId: "features",
      selectedValues: ["review"],
      customText: "Include an export",
    });
  });

  it("caps and sanitizes Other text before it becomes a result", () => {
    const state = apply([
      {
        type: "saveCustom",
        value: `\u001b[31m${"a".repeat(MAX_CUSTOM_TEXT_LENGTH + 1)}`,
      },
      { type: "confirm" },
    ]);

    expect(toResult(questions, state).answers[0]?.customText).toBe(
      "a".repeat(MAX_CUSTOM_TEXT_LENGTH),
    );
  });

  it("keeps Other text when an option is toggled afterward in multi-select", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
      { type: "saveCustom", value: "Include export", clearSelections: false },
      { type: "toggle", optionIndex: 0 },
      { type: "confirm" },
    ]);

    expect(toResult(questions, state).answers[1]).toEqual({
      questionId: "features",
      selectedValues: ["review"],
      customText: "Include export",
    });
  });

  it("clearing a confirmed Other answer unconfirms the question", () => {
    const state = apply([
      { type: "saveCustom", value: "Use SQLite" },
      { type: "confirm" },
      { type: "goTab", tab: 0 },
      { type: "saveCustom", value: "" },
    ]);

    expect(state.answers[0]).toMatchObject({
      customText: undefined,
      confirmed: false,
    });
    expect(state.canSubmit).toBe(false);
  });

  it("retains selected values when blank Other text is cleared in multi-select", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
      { type: "toggle", optionIndex: 0 },
      { type: "saveCustom", value: "Extra", clearSelections: false },
      { type: "saveCustom", value: "", clearSelections: false },
    ]);

    expect(state.answers[1]).toMatchObject({
      selectedValues: ["0"],
      customText: undefined,
      confirmed: false,
    });
  });

  it("moves cursor with bounds", () => {
    const state = apply([{ type: "move", delta: 1, max: 3 }]);
    expect(state.answers[0].cursorIndex).toBe(1);
  });

  it("toggles multi-select option on/off", () => {
    const state = apply([
      { type: "toggle", optionIndex: 0 },
      { type: "toggle", optionIndex: 1 },
      { type: "toggle", optionIndex: 0 },
    ]);
    expect(state.answers[0].selectedValues).toEqual(["1"]);
  });

  it("unconfirms a multi-select question when its final selection is removed", () => {
    const state = apply([
      { type: "select", optionIndex: 0 },
      { type: "confirm" },
      { type: "toggle", optionIndex: 0 },
      { type: "confirm" },
      { type: "goTab", tab: 1 },
      { type: "toggle", optionIndex: 0 },
    ]);

    expect(state.answers[1]).toMatchObject({
      selectedValues: [],
      confirmed: false,
    });
    expect(state.canSubmit).toBe(false);
  });

  it("rejects confirm when nothing is selected", () => {
    const initialState = createQuestionnaireState(questions);
    const state = reduceQuestionnaire(
      initialState,
      { type: "confirm" },
      questions,
    );
    expect(state.answers[0].confirmed).toBe(false);
    expect(state.activeTab).toBe(0);
  });

  it("confirms an optional question without an answer", () => {
    const optionalQuestions: Question[] = [
      { ...questions[0], required: false },
    ];
    const initialState = createQuestionnaireState(optionalQuestions);
    const state = reduceQuestionnaire(
      initialState,
      { type: "confirm" },
      optionalQuestions,
    );

    expect(state.answers[0].confirmed).toBe(true);
    expect(state.activeTab).toBe(1);
    expect(toResult(optionalQuestions, state).answers).toEqual([]);
  });

  it("navigates between tabs", () => {
    const state = apply([{ type: "goTab", tab: 1 }]);
    expect(state.activeTab).toBe(1);

    const nextState = reduceQuestionnaire(
      state,
      { type: "goTab", tab: 99 },
      questions,
    );
    expect(nextState.activeTab).toBe(2);

    const prevState = reduceQuestionnaire(
      nextState,
      { type: "goTab", tab: -5 },
      questions,
    );
    expect(prevState.activeTab).toBe(0);
  });

  it("produces empty answers when dismissed", () => {
    const state = createQuestionnaireState(questions);
    expect(toResult(questions, state).status).toBe("submitted");
    expect(toResult(questions, state).answers).toEqual([]);
  });
});

const conditionalQuestions: Question[] = [
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

describe("conditional showWhen", () => {
  it("hides the child until the parent is confirmed with a matching value", () => {
    const initial = createQuestionnaireState(conditionalQuestions);
    expect(
      visibleQuestionIndices(conditionalQuestions, initial.answers),
    ).toEqual([0]);
    expect(isQuestionVisible(conditionalQuestions, initial.answers, 1)).toBe(
      false,
    );

    const mismatched = apply(
      [{ type: "select", optionIndex: 0 }, { type: "confirm" }],
      conditionalQuestions,
    );
    expect(mismatched.activeTab).toBe(2);
    expect(mismatched.canSubmit).toBe(true);
    expect(
      visibleQuestionIndices(conditionalQuestions, mismatched.answers),
    ).toEqual([0]);
    expect(toResult(conditionalQuestions, mismatched).answers).toEqual([
      { questionId: "stack", selectedValues: ["frontend"] },
    ]);
  });

  it("shows the child after a matching parent confirm", () => {
    const state = apply(
      [{ type: "select", optionIndex: 1 }, { type: "confirm" }],
      conditionalQuestions,
    );
    expect(state.activeTab).toBe(1);
    expect(state.canSubmit).toBe(false);
    expect(visibleQuestionIndices(conditionalQuestions, state.answers)).toEqual(
      [0, 1],
    );
  });

  it("includes both answers when the child is confirmed", () => {
    const state = apply(
      [
        { type: "select", optionIndex: 1 },
        { type: "confirm" },
        { type: "select", optionIndex: 0 },
        { type: "confirm" },
      ],
      conditionalQuestions,
    );
    expect(state.canSubmit).toBe(true);
    expect(toResult(conditionalQuestions, state).answers).toEqual([
      { questionId: "stack", selectedValues: ["backend"] },
      { questionId: "db", selectedValues: ["postgres"] },
    ]);
  });

  it("clears and hides the child when the parent no longer matches", () => {
    const answered = apply(
      [
        { type: "select", optionIndex: 1 },
        { type: "confirm" },
        { type: "select", optionIndex: 0 },
        { type: "confirm" },
        { type: "goTab", tab: 0 },
        { type: "select", optionIndex: 0 },
      ],
      conditionalQuestions,
    );

    expect(answered.answers[0]).toMatchObject({
      selectedValues: ["0"],
      confirmed: false,
    });
    expect(answered.answers[1]).toMatchObject({
      selectedValues: [],
      customText: undefined,
      confirmed: false,
    });
    expect(isQuestionVisible(conditionalQuestions, answered.answers, 1)).toBe(
      false,
    );
    expect(toResult(conditionalQuestions, answered).answers).toEqual([]);
  });

  it("resets the child when the parent is edited then rematched", () => {
    // Editing the parent unconfirms it, which hides and clears the child.
    // Rematching after reconfirm must start the child empty again.
    const state = apply(
      [
        { type: "select", optionIndex: 1 },
        { type: "confirm" },
        { type: "select", optionIndex: 0 },
        { type: "confirm" },
        { type: "goTab", tab: 0 },
        { type: "select", optionIndex: 1 },
        { type: "confirm" },
      ],
      conditionalQuestions,
    );

    expect(state.answers[1]).toMatchObject({
      selectedValues: [],
      confirmed: false,
    });
    expect(state.canSubmit).toBe(false);
    expect(toResult(conditionalQuestions, state).answers).toEqual([
      { questionId: "stack", selectedValues: ["backend"] },
    ]);
  });

  it("does not reveal the child for parent Other text alone", () => {
    const state = apply(
      [{ type: "saveCustom", value: "backend" }, { type: "confirm" }],
      conditionalQuestions,
    );
    expect(isQuestionVisible(conditionalQuestions, state.answers, 1)).toBe(
      false,
    );
    expect(state.activeTab).toBe(2);
    expect(toResult(conditionalQuestions, state).answers).toEqual([
      {
        questionId: "stack",
        selectedValues: [],
        customText: "backend",
      },
    ]);
  });

  it("allows submit when a hidden required child is unanswered", () => {
    const state = apply(
      [{ type: "select", optionIndex: 0 }, { type: "confirm" }],
      conditionalQuestions,
    );
    expect(conditionalQuestions[1].required).not.toBe(false);
    expect(state.canSubmit).toBe(true);
  });

  it("shows a multi-select child when the parent includes the equals value", () => {
    const multiParent: Question[] = [
      {
        id: "stack",
        header: "Stack",
        question: "What are you building?",
        multiSelect: true,
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

    const state = apply(
      [
        { type: "toggle", optionIndex: 0 },
        { type: "toggle", optionIndex: 1 },
        { type: "confirm" },
      ],
      multiParent,
    );
    expect(isQuestionVisible(multiParent, state.answers, 1)).toBe(true);
    expect(state.activeTab).toBe(1);
  });

  it("lets a visible optional child be skipped", () => {
    const optionalChild: Question[] = [
      conditionalQuestions[0],
      { ...conditionalQuestions[1], required: false },
    ];
    const state = apply(
      [
        { type: "select", optionIndex: 1 },
        { type: "confirm" },
        { type: "confirm" },
      ],
      optionalChild,
    );
    expect(state.canSubmit).toBe(true);
    expect(toResult(optionalChild, state).answers).toEqual([
      { questionId: "stack", selectedValues: ["backend"] },
    ]);
  });
});
