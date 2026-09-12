import {
  type Answer,
  type AskResult,
  MAX_CUSTOM_TEXT_LENGTH,
  type Question,
} from "./schema.js";
import { toWrappedText } from "./text.js";

/**
 * The user's own free-text answer keeps its line breaks (the review tab and
 * the transcript render them inline with `formatInlineText`), but every escape
 * sequence and control character is removed before the text is stored.
 */
function normalizeCustomText(value: string): string | undefined {
  const normalized = toWrappedText(value)
    .trim()
    .slice(0, MAX_CUSTOM_TEXT_LENGTH);
  return normalized || undefined;
}

export interface AnswerState {
  cursorIndex: number;
  selectedValues: string[];
  customText?: string;
  required: boolean;
  confirmed: boolean;
}

export interface QuestionnaireState {
  activeTab: number;
  answers: AnswerState[];
  canSubmit: boolean;
  editing: "custom" | undefined;
}

export type QuestionnaireAction =
  | { type: "move"; delta: -1 | 1; max: number }
  | { type: "select"; optionIndex: number }
  | { type: "toggle"; optionIndex: number }
  | { type: "startCustom" }
  | { type: "saveCustom"; value: string; clearSelections?: boolean }
  | { type: "confirm" }
  | { type: "skip" }
  | { type: "goTab"; tab: number }
  | { type: "cancelEdit" };

function clearAnswer(answer: AnswerState): AnswerState {
  return {
    ...answer,
    cursorIndex: 0,
    selectedValues: [],
    customText: undefined,
    confirmed: false,
  };
}

/** Whether question at index is visible given current answer state. */
export function isQuestionVisible(
  questions: Question[],
  answers: AnswerState[],
  index: number,
): boolean {
  const question = questions[index];
  if (!question?.showWhen) return true;

  const parentIndex = questions.findIndex(
    (candidate) => candidate.id === question.showWhen?.questionId,
  );
  if (parentIndex < 0) return false;

  const parentAnswer = answers[parentIndex];
  const parentQuestion = questions[parentIndex];
  if (!parentAnswer?.confirmed || !parentQuestion) return false;

  const optionIndex = parentQuestion.options.findIndex(
    (option) => option.value === question.showWhen?.equals,
  );
  if (optionIndex < 0) return false;

  return parentAnswer.selectedValues.includes(String(optionIndex));
}

export function visibleQuestionIndices(
  questions: Question[],
  answers: AnswerState[],
): number[] {
  return questions
    .map((_, index) => index)
    .filter((index) => isQuestionVisible(questions, answers, index));
}

function nextVisibleTab(
  questions: Question[],
  answers: AnswerState[],
  fromTab: number,
): number {
  for (let index = fromTab + 1; index < questions.length; index++) {
    if (isQuestionVisible(questions, answers, index)) return index;
  }
  return questions.length;
}

function clampActiveTab(
  questions: Question[],
  answers: AnswerState[],
  activeTab: number,
): number {
  if (activeTab >= questions.length) return questions.length;
  if (isQuestionVisible(questions, answers, activeTab)) return activeTab;

  for (let index = activeTab + 1; index < questions.length; index++) {
    if (isQuestionVisible(questions, answers, index)) return index;
  }
  for (let index = activeTab - 1; index >= 0; index--) {
    if (isQuestionVisible(questions, answers, index)) return index;
  }
  return questions.length;
}

function syncConditionalState(
  state: QuestionnaireState,
  questions: Question[],
): QuestionnaireState {
  const answers = state.answers.map((answer, index) => {
    if (isQuestionVisible(questions, state.answers, index)) return answer;
    if (
      answer.selectedValues.length === 0 &&
      !answer.customText &&
      !answer.confirmed
    ) {
      return answer;
    }
    return clearAnswer(answer);
  });

  const canSubmit = questions.every((_, index) => {
    if (!isQuestionVisible(questions, answers, index)) return true;
    return answers[index]?.confirmed === true;
  });

  return {
    ...state,
    answers,
    canSubmit,
    activeTab: clampActiveTab(questions, answers, state.activeTab),
  };
}

export function createQuestionnaireState(
  questions: Question[],
): QuestionnaireState {
  return syncConditionalState(
    {
      activeTab: 0,
      answers: questions.map((question) => ({
        cursorIndex: 0,
        selectedValues: [],
        required: question.required !== false,
        confirmed: false,
      })),
      canSubmit: false,
      editing: undefined,
    },
    questions,
  );
}

function updateAnswer(
  state: QuestionnaireState,
  questions: Question[],
  updater: (answer: AnswerState) => AnswerState,
): QuestionnaireState {
  const answers = state.answers.map((answer, index) =>
    index === state.activeTab ? updater(answer) : answer,
  );
  return syncConditionalState({ ...state, answers }, questions);
}

export function reduceQuestionnaire(
  state: QuestionnaireState,
  action: QuestionnaireAction,
  questions: Question[],
): QuestionnaireState {
  // The review tab has no answer row of its own; only tab navigation is valid
  // there.
  if (action.type === "goTab") {
    return syncConditionalState(
      {
        ...state,
        activeTab: Math.max(0, Math.min(questions.length, action.tab)),
        editing: undefined,
      },
      questions,
    );
  }

  const answer = state.answers[state.activeTab];
  if (!answer) return state;

  switch (action.type) {
    case "move":
      return updateAnswer(state, questions, (current) => ({
        ...current,
        cursorIndex: Math.max(
          0,
          Math.min(action.max, current.cursorIndex + action.delta),
        ),
      }));
    case "select":
      return updateAnswer(state, questions, (current) => ({
        ...current,
        cursorIndex: action.optionIndex,
        selectedValues: [String(action.optionIndex)],
        customText: undefined,
        confirmed: false,
      }));
    case "toggle": {
      const value = String(action.optionIndex);
      return updateAnswer(state, questions, (current) => ({
        ...current,
        cursorIndex: action.optionIndex,
        selectedValues: current.selectedValues.includes(value)
          ? current.selectedValues.filter((selected) => selected !== value)
          : [...current.selectedValues, value],
        confirmed: false,
      }));
    }
    case "startCustom":
      return { ...state, editing: "custom" };
    case "saveCustom": {
      const next = updateAnswer(state, questions, (current) => ({
        ...current,
        ...(action.clearSelections !== false ? { selectedValues: [] } : {}),
        customText: normalizeCustomText(action.value),
        confirmed: false,
      }));
      return { ...next, editing: undefined };
    }
    case "cancelEdit":
      return { ...state, editing: undefined };
    case "skip": {
      // Explicitly answering "nothing" on an optional question: clear whatever
      // was picked before, mark it confirmed, and move on.
      if (answer.required) return state;
      const skipped = updateAnswer(state, questions, (current) => ({
        ...clearAnswer(current),
        cursorIndex: current.cursorIndex,
        confirmed: true,
      }));
      return {
        ...skipped,
        activeTab: nextVisibleTab(questions, skipped.answers, state.activeTab),
        editing: undefined,
      };
    }
    case "confirm": {
      const hasAnswer =
        answer.selectedValues.length > 0 || Boolean(answer.customText);
      if (!hasAnswer && answer.required) return state;
      const confirmed = updateAnswer(state, questions, (current) => ({
        ...current,
        confirmed: true,
      }));
      return {
        ...confirmed,
        activeTab: nextVisibleTab(
          questions,
          confirmed.answers,
          state.activeTab,
        ),
        editing: undefined,
      };
    }
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function toResult(
  questions: Question[],
  state: QuestionnaireState,
): AskResult {
  const answers: Answer[] = questions.flatMap((question, index) => {
    if (!isQuestionVisible(questions, state.answers, index)) return [];
    const answer = state.answers[index];
    if (
      !answer?.confirmed ||
      (answer.selectedValues.length === 0 && !answer.customText)
    ) {
      return [];
    }
    const selectedValues = question.options
      .filter((_option, optionIndex) =>
        answer.selectedValues.includes(String(optionIndex)),
      )
      .map((option) => option.value);
    return [
      {
        questionId: question.id,
        selectedValues,
        ...(answer.customText ? { customText: answer.customText } : {}),
      },
    ];
  });
  return { version: 1, status: "submitted", answers };
}
