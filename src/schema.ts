import { type Static, Type } from "typebox";

export const MAX_CUSTOM_TEXT_LENGTH = 4_000;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 500;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 4_000;

function hasTerminalControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || (code >= 127 && code <= 159)) {
      return true;
    }
  }
  return false;
}

export const OptionSchema = Type.Object({
  value: Type.String({
    minLength: 1,
    maxLength: MAX_ID_LENGTH,
    description: "Stable value returned to the agent.",
  }),
  label: Type.String({
    minLength: 1,
    maxLength: MAX_LABEL_LENGTH,
    description: "Concise option shown to the user.",
  }),
  description: Type.Optional(
    Type.String({
      maxLength: MAX_CONTEXT_LENGTH,
      description: "Optional supporting detail.",
    }),
  ),
  recommended: Type.Optional(
    Type.Boolean({
      description:
        "Marks the recommended option; always shown first in the list.",
    }),
  ),
});

export const QuestionSchema = Type.Object({
  id: Type.String({
    minLength: 1,
    maxLength: MAX_ID_LENGTH,
    description: "Unique stable question identifier.",
  }),
  header: Type.String({
    minLength: 1,
    maxLength: 12,
    description: "Short tab label.",
  }),
  question: Type.String({
    minLength: 1,
    maxLength: MAX_QUESTION_LENGTH,
    description: "Question shown to the user.",
  }),
  context: Type.Optional(
    Type.String({
      maxLength: MAX_CONTEXT_LENGTH,
      description: "Optional evidence or context.",
    }),
  ),
  multiSelect: Type.Optional(
    Type.Boolean({
      default: false,
      description: "Allow more than one selected option. Defaults to false.",
    }),
  ),
  required: Type.Optional(
    Type.Boolean({
      description: "Whether the user must provide an answer. Defaults to true.",
    }),
  ),
  showWhen: Type.Optional(
    Type.Object(
      {
        questionId: Type.String({
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description: "Parent question id that controls visibility.",
        }),
        equals: Type.String({
          minLength: 1,
          maxLength: MAX_ID_LENGTH,
          description:
            "Parent option value that must be selected for this question to appear.",
        }),
      },
      {
        description:
          "Show this question only when the parent is confirmed with the given option value.",
      },
    ),
  ),
  options: Type.Array(OptionSchema, {
    minItems: 2,
    maxItems: 4,
    description: "Two to four choices. Do not include an Other option.",
  }),
});

export const AskParameters = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    maxItems: 4,
    description:
      "One to four questions answered in a keyboard-first review flow.",
  }),
});

export const AnswerSchema = Type.Object({
  questionId: Type.String(),
  selectedValues: Type.Array(Type.String()),
  customText: Type.Optional(Type.String()),
});

export const AskResultSchema = Type.Object({
  version: Type.Literal(1),
  status: Type.Union([
    Type.Literal("submitted"),
    Type.Literal("dismissed"),
    Type.Literal("unavailable"),
    Type.Literal("aborted"),
    Type.Literal("invalid"),
  ]),
  answers: Type.Array(AnswerSchema),
});

export type Option = Static<typeof OptionSchema>;
export type Question = Static<typeof QuestionSchema>;
export type AskParameters = Static<typeof AskParameters>;
export type Answer = Static<typeof AnswerSchema>;
export type AskResult = Static<typeof AskResultSchema>;

/** Stable-partition options so recommended entries appear first. */
export function withRecommendedFirst(options: Option[]): Option[] {
  const recommended: Option[] = [];
  const rest: Option[] = [];
  for (const option of options) {
    if (option.recommended) recommended.push(option);
    else rest.push(option);
  }
  return recommended.length === 0 ? [...options] : [...recommended, ...rest];
}

/** Normalize questions to apply runtime defaults and lead with recommended options. */
export function normalizeQuestions(questions: Question[]): Question[] {
  return questions.map((question) => ({
    ...question,
    multiSelect: question.multiSelect ?? false,
    options: withRecommendedFirst(question.options),
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateText(
  value: unknown,
  field: string,
  maxLength: number,
  blankMessage: string,
): string | undefined {
  if (typeof value !== "string") return `${field} must be a string.`;
  if (!value.trim()) return blankMessage;
  if (value.length > maxLength)
    return `${field} must be at most ${maxLength} characters.`;
  if (hasTerminalControlCharacters(value))
    return `${field} contains terminal control characters.`;
}

export function validateQuestions(questions: unknown): string | undefined {
  if (!Array.isArray(questions)) return "Questions must be an array.";
  if (questions.length < 1 || questions.length > 4) {
    return "Provide between 1 and 4 questions.";
  }

  const questionIds = new Set<string>();
  const optionValuesById = new Map<string, Set<string>>();
  const hasShowWhenById = new Map<string, boolean>();

  for (const [questionIndex, question] of questions.entries()) {
    if (!isRecord(question))
      return `Question ${questionIndex + 1} must be an object.`;

    const idError = validateText(
      question.id,
      "Question id",
      MAX_ID_LENGTH,
      "Question id must not be blank.",
    );
    if (idError) return idError;
    const id = question.id as string;

    const headerError = validateText(
      question.header,
      `Question header: ${id}`,
      12,
      `Question header must not be blank: ${id}`,
    );
    if (headerError) return headerError;
    const questionError = validateText(
      question.question,
      `Question text: ${id}`,
      MAX_QUESTION_LENGTH,
      `Question text must not be blank: ${id}`,
    );
    if (questionError) return questionError;
    if (
      question.multiSelect !== undefined &&
      typeof question.multiSelect !== "boolean"
    )
      return `Question multiSelect must be a boolean: ${id}.`;
    if (
      question.required !== undefined &&
      typeof question.required !== "boolean"
    ) {
      return `Question required must be a boolean: ${id}.`;
    }
    if (question.context !== undefined) {
      const contextError = validateText(
        question.context,
        `Question context: ${id}`,
        MAX_CONTEXT_LENGTH,
        `Question context must not be blank: ${id}`,
      );
      if (contextError) return contextError;
    }
    if (question.showWhen !== undefined) {
      if (!isRecord(question.showWhen)) {
        return `Question showWhen must be an object: ${id}.`;
      }
      const showWhen = question.showWhen;
      const parentIdError = validateText(
        showWhen.questionId,
        `Question showWhen.questionId: ${id}`,
        MAX_ID_LENGTH,
        `Question showWhen.questionId must not be blank: ${id}`,
      );
      if (parentIdError) return parentIdError;
      const equalsError = validateText(
        showWhen.equals,
        `Question showWhen.equals: ${id}`,
        MAX_ID_LENGTH,
        `Question showWhen.equals must not be blank: ${id}`,
      );
      if (equalsError) return equalsError;
    }
    if (!Array.isArray(question.options))
      return `Question options must be an array: ${id}.`;
    if (question.options.length < 2 || question.options.length > 4) {
      return `Question ${id} must have between 2 and 4 options.`;
    }
    if (questionIds.has(id)) return `Duplicate question id: ${id}`;
    questionIds.add(id);
    hasShowWhenById.set(id, question.showWhen !== undefined);

    const optionValues = new Set<string>();
    for (const option of question.options) {
      if (!isRecord(option)) return `Option must be an object in ${id}.`;
      const valueError = validateText(
        option.value,
        `Option value in ${id}`,
        MAX_ID_LENGTH,
        `Option value must not be blank in ${id}.`,
      );
      if (valueError) return valueError;
      const labelError = validateText(
        option.label,
        `Option label in ${id}`,
        MAX_LABEL_LENGTH,
        `Option label must not be blank in ${id}.`,
      );
      if (labelError) return labelError;
      if (option.description !== undefined) {
        const descriptionError = validateText(
          option.description,
          `Option description in ${id}`,
          MAX_CONTEXT_LENGTH,
          `Option description must not be blank in ${id}.`,
        );
        if (descriptionError) return descriptionError;
      }
      if (
        option.recommended !== undefined &&
        typeof option.recommended !== "boolean"
      ) {
        return `Option recommended must be a boolean in ${id}.`;
      }

      const value = option.value as string;
      if (optionValues.has(value)) {
        return `Duplicate option value in ${id}: ${value}`;
      }
      optionValues.add(value);
    }
    optionValuesById.set(id, optionValues);
  }

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];
    if (!isRecord(question) || question.showWhen === undefined) continue;
    const id = question.id as string;
    const showWhen = question.showWhen as Record<string, unknown>;
    const parentId = showWhen.questionId as string;
    const equals = showWhen.equals as string;

    if (parentId === id) {
      return `Question showWhen cannot reference itself: ${id}.`;
    }
    if (!questionIds.has(parentId)) {
      return `Question showWhen.questionId is unknown: ${id} → ${parentId}.`;
    }
    if (hasShowWhenById.get(parentId)) {
      return `Question showWhen parent must not be conditional: ${id} → ${parentId}.`;
    }
    // Parent must appear before child in array order
    const parentIdx = questions.findIndex(
      (q) => isRecord(q) && q.id === parentId,
    );
    if (parentIdx >= i) {
      return `Question showWhen parent must appear before child: ${parentId} → ${id}.`;
    }
    if (!optionValuesById.get(parentId)?.has(equals)) {
      return `Question showWhen.equals is not an option on parent ${parentId}: ${id}.`;
    }
  }
}
