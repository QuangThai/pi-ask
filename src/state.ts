import {
  type Answer,
  type AskResult,
  MAX_CUSTOM_TEXT_LENGTH,
  type Question,
} from "./schema.js";

function isTerminalControlCharacter(code: number): boolean {
  return (
    code <= 8 || (code >= 11 && code <= 31) || (code >= 127 && code <= 159)
  );
}

function normalizeCustomText(value: string): string | undefined {
  let normalized = "";

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 27) {
      const next = value.charCodeAt(index + 1);
      if (next === 91) {
        // CSI: skip through its final byte.
        index++;
        while (++index < value.length) {
          const csiCode = value.charCodeAt(index);
          if (csiCode >= 64 && csiCode <= 126) break;
        }
      } else if (next === 93) {
        // OSC: skip through BEL or the string terminator (ESC + backslash).
        index += 2;
        while (index < value.length) {
          if (value.charCodeAt(index) === 7) break;
          if (value.charCodeAt(index) === 27 && value[index + 1] === "\\") {
            index++;
            break;
          }
          index++;
        }
      } else {
        index++;
      }
      continue;
    }
    if (!isTerminalControlCharacter(code)) normalized += value[index];
  }

  normalized = normalized.trim().slice(0, MAX_CUSTOM_TEXT_LENGTH);
  return normalized || undefined;
}

export interface AnswerState {
  cursorIndex: number;
  selectedValues: string[];
  customText?: string;
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
  | { type: "goTab"; tab: number }
  | { type: "cancelEdit" };

export function createQuestionnaireState(
  questions: Question[],
): QuestionnaireState {
  return {
    activeTab: 0,
    answers: questions.map(() => ({
      cursorIndex: 0,
      selectedValues: [],
      confirmed: false,
    })),
    canSubmit: false,
    editing: undefined,
  };
}

function recompute(state: QuestionnaireState): QuestionnaireState {
  return {
    ...state,
    canSubmit: state.answers.every((answer) => answer.confirmed),
  };
}

function updateAnswer(
  state: QuestionnaireState,
  updater: (answer: AnswerState) => AnswerState,
): QuestionnaireState {
  const answers = state.answers.map((answer, index) =>
    index === state.activeTab ? updater(answer) : answer,
  );
  return recompute({ ...state, answers });
}

export function reduceQuestionnaire(
  state: QuestionnaireState,
  action: QuestionnaireAction,
): QuestionnaireState {
  const answer = state.answers[state.activeTab];
  if (!answer && action.type !== "goTab") return state;

  switch (action.type) {
    case "move":
      return updateAnswer(state, (current) => ({
        ...current,
        cursorIndex: Math.max(
          0,
          Math.min(action.max, current.cursorIndex + action.delta),
        ),
      }));
    case "select":
      return updateAnswer(state, (current) => ({
        ...current,
        cursorIndex: action.optionIndex,
        selectedValues: [String(action.optionIndex)],
        customText: undefined,
        confirmed: false,
      }));
    case "toggle": {
      const value = String(action.optionIndex);
      return updateAnswer(state, (current) => ({
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
      const next = updateAnswer(state, (current) => ({
        ...current,
        ...(action.clearSelections !== false ? { selectedValues: [] } : {}),
        customText: normalizeCustomText(action.value),
        confirmed: false,
      }));
      return { ...next, editing: undefined };
    }
    case "cancelEdit":
      return { ...state, editing: undefined };
    case "goTab":
      return {
        ...state,
        activeTab: Math.max(0, Math.min(state.answers.length, action.tab)),
        editing: undefined,
      };
    case "confirm": {
      const hasAnswer =
        answer.selectedValues.length > 0 || Boolean(answer.customText);
      if (!hasAnswer) return state;
      const next = updateAnswer(state, (current) => ({
        ...current,
        confirmed: true,
      }));
      return {
        ...next,
        activeTab: Math.min(next.answers.length, state.activeTab + 1),
        editing: undefined,
      };
    }
  }
}

export function toResult(
  questions: Question[],
  state: QuestionnaireState,
): AskResult {
  const answers: Answer[] = questions.flatMap((question, index) => {
    const answer = state.answers[index];
    if (!answer?.confirmed) return [];
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
