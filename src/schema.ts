import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import {
  hasUnsafeControlCharacters,
  toSingleLine,
  toWrappedText,
} from "./text.js";

export const MAX_CUSTOM_TEXT_LENGTH = 4_000;
/** Max header width (in terminal columns) displayed in the TUI tab bar. */
export const HEADER_DISPLAY_MAX = 12;
/** Options beyond this are dropped rather than rejected — see normalizeQuestions. */
export const MAX_OPTIONS = 4;
const MIN_OPTIONS = 2;
const MAX_QUESTIONS = 4;
const MAX_ID_LENGTH = 128;
const MAX_LABEL_LENGTH = 500;
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 4_000;

/**
 * Public schemas: strict where the model contract matters, tolerant where
 * prepareArguments()/normalizeQuestions() can auto-fix.
 *
 * Pi's framework validates tool arguments against this schema BEFORE execute()
 * runs and hard-rejects with a raw "Validation failed for tool ..." error.
 * The extension therefore registers a prepareArguments() hook (official pi
 * mechanism) that derives defaults for anything the model omitted BEFORE this
 * schema is checked, so required fields never reject real calls.
 *
 * Remaining tolerance is intentional:
 * - item counts (2–4 options, 1–4 questions) and field lengths are NOT enforced
 *   here, so over/under-sized payloads reach validateQuestions() which returns
 *   a clean, actionable error instead of a raw framework exception.
 * - `question` text is optional because it can be empty after derivation; the
 *   extension rejects a blank question with a clean error.
 */
export const OptionSchema = Type.Object({
  value: Type.String({
    minLength: 1,
    description:
      "Stable value returned to the agent. If omitted, derived from the label.",
  }),
  label: Type.String({
    minLength: 1,
    description:
      "Concise option shown to the user. If omitted, the value (or a numbered fallback) is shown.",
  }),
  description: Type.Optional(
    Type.String({
      description: "Optional supporting detail. May span several lines.",
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
    description:
      "Unique stable question identifier. If omitted, derived (question-1, question-2, ...).",
  }),
  header: Type.String({
    minLength: 1,
    description: `Short tab label (truncated to ${HEADER_DISPLAY_MAX} columns in the TUI).`,
  }),
  question: Type.Optional(
    Type.String({
      description:
        "Question shown to the user. If omitted, the header text is used.",
    }),
  ),
  context: Type.Optional(
    Type.String({
      description: "Optional evidence or context. May span several lines.",
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
        questionId: Type.Optional(
          Type.String({
            description: "Parent question id that controls visibility.",
          }),
        ),
        equals: Type.Optional(
          Type.String({
            description:
              "Parent option value that must be selected for this question to appear.",
          }),
        ),
      },
      {
        description:
          "Show this question only when the parent is confirmed with the given option value.",
      },
    ),
  ),
  options: Type.Array(OptionSchema, {
    description: `Two to ${MAX_OPTIONS} choices. Do not include an Other option.`,
  }),
});

export const AskParameters = Type.Object({
  questions: Type.Optional(
    Type.Array(QuestionSchema, {
      description:
        "One to four questions answered in a keyboard-first review flow.",
    }),
  ),
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

/** Normalized option shape — `value` and `label` are guaranteed by normalizeQuestions. */
export interface Option {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface ShowWhen {
  questionId: string;
  equals: string;
}

/** Normalized question shape — required fields are guaranteed by normalizeQuestions. */
export interface Question {
  id: string;
  header: string;
  question: string;
  context?: string;
  multiSelect: boolean;
  required?: boolean;
  showWhen?: ShowWhen;
  options: Option[];
}

export type Answer = Static<typeof AnswerSchema>;
export type AskResult = Static<typeof AskResultSchema>;

/**
 * Truncate a header to HEADER_DISPLAY_MAX terminal columns.
 *
 * Measured in display columns, not UTF-16 code units: a CJK header of 12
 * characters occupies 24 columns, and slicing code units can cut a surrogate
 * pair in half and emit a lone surrogate to the terminal.
 */
export function truncateHeader(header: string): string {
  if (visibleWidth(header) <= HEADER_DISPLAY_MAX) return header;
  // truncateToWidth appends an SGR reset because it is built for rendering;
  // the header is stored data, so strip escapes back out.
  return toSingleLine(truncateToWidth(header, HEADER_DISPLAY_MAX, ""));
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Slugify a label into a stable option value. Diacritics are stripped so
 * Vietnamese/French/etc. labels produce readable keys ("Chọn" -> "chon").
 */
function deriveSlug(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_ID_LENGTH);
}

/**
 * Return a candidate that is neither already assigned (`used`) nor claimed
 * later in the payload (`reserved`), registering it in `used`.
 */
function uniqueString(
  candidate: string,
  used: Set<string>,
  reserved?: ReadonlySet<string>,
): string {
  const taken = (value: string) => used.has(value) || reserved?.has(value);
  if (!taken(candidate)) {
    used.add(candidate);
    return candidate;
  }
  for (let suffix = 2; ; suffix++) {
    const next = `${candidate}-${suffix}`;
    if (!taken(next)) {
      used.add(next);
      return next;
    }
  }
}

/**
 * Lenient boolean parsing for LLM output. Pi's own coercion already handles
 * "true"/"false"/"1"/"0"; this additionally accepts "yes"/"no"/"on"/"off"
 * and rejects everything else so a garbage flag can never fail schema
 * validation.
 */
function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    switch (value.trim().toLowerCase()) {
      case "true":
      case "yes":
      case "on":
      case "1":
        return true;
      case "false":
      case "no":
      case "off":
      case "0":
        return false;
      default:
        return undefined;
    }
  }
  return undefined;
}

/** Read a model-supplied string that is rendered as exactly one line. */
function readSingleLine(value: unknown): string {
  return typeof value === "string" ? toSingleLine(value).trim() : "";
}

/** Read a model-supplied string that the renderer is allowed to wrap. */
function readWrapped(value: unknown): string {
  return typeof value === "string" ? toWrappedText(value).trim() : "";
}

/**
 * Normalize raw (possibly LLM-malformed) questions into the runtime shape.
 *
 * Container hygiene:
 * - a single question object instead of an array is wrapped: [obj]
 * - null/undefined/missing containers become []
 * - non-object entries (null placeholders, strings, numbers) are dropped
 *
 * Everything the model might forget or format badly is repaired, not rejected:
 * - ANSI escapes and control characters are stripped from every display string;
 *   line breaks survive only in fields the renderer wraps (`question`,
 *   `context`, option `description`) and collapse to spaces everywhere else
 * - missing option `value` -> slug of the label (or `option-N`), de-duplicated
 * - missing option `label` -> the value (or `Option N`)
 * - duplicate explicit ids/values get a `-2`, `-3`, ... suffix
 * - missing question `id` -> `question-N`, de-duplicated
 * - missing `question` text -> the header
 * - missing `header` -> the question text, truncated to the tab width
 * - `multiSelect` defaults to false; non-boolean flags are dropped
 * - more than MAX_OPTIONS options -> extras dropped after recommended ones are
 *   moved to the front, so the call succeeds instead of costing a retry
 *
 * Truly unfixable input (no options, fewer than two options, a blank question,
 * broken showWhen) is left intact for validateQuestions() to reject with a
 * clean, actionable error.
 */
export function normalizeQuestions(input: unknown): Question[] {
  if (!Array.isArray(input)) return [];

  // Reserve every explicit id up front so a derived id never steals one that
  // a later question declared for itself.
  const explicitQuestionIds = new Set<string>();
  for (const rawQuestion of input) {
    const rawId = readSingleLine(isRecord(rawQuestion) ? rawQuestion.id : "");
    if (rawId) explicitQuestionIds.add(rawId);
  }
  const usedQuestionIds = new Set<string>();

  return input.map((rawQuestion, questionIndex) => {
    const q = isRecord(rawQuestion) ? rawQuestion : {};
    const rawId = readSingleLine(q.id);
    const id = rawId
      ? uniqueString(rawId, usedQuestionIds)
      : uniqueString(
          `question-${questionIndex + 1}`,
          usedQuestionIds,
          explicitQuestionIds,
        );

    const rawQuestionText = readWrapped(q.question);
    const rawHeader = readSingleLine(q.header);
    const question = rawQuestionText || rawHeader;
    const header = truncateHeader(
      rawHeader || toSingleLine(rawQuestionText).trim() || id,
    );
    const context = readWrapped(q.context);

    // Container hygiene for options: wrap a single object, drop non-objects.
    const rawOptions = isRecord(q.options)
      ? [q.options]
      : Array.isArray(q.options)
        ? q.options.filter(isRecord)
        : [];
    const explicitOptionValues = new Set<string>();
    for (const rawOption of rawOptions) {
      const rawValue = readSingleLine(rawOption.value);
      if (rawValue) explicitOptionValues.add(rawValue);
    }
    const usedOptionValues = new Set<string>();
    const options: Option[] = rawOptions.map((rawOption, optionIndex) => {
      const rawValue = readSingleLine(rawOption.value);
      const rawLabel = readSingleLine(rawOption.label);
      const label = rawLabel || rawValue || `Option ${optionIndex + 1}`;
      const value = rawValue
        ? uniqueString(rawValue, usedOptionValues)
        : uniqueString(
            deriveSlug(label) || `option-${optionIndex + 1}`,
            usedOptionValues,
            explicitOptionValues,
          );
      const description = readWrapped(rawOption.description);
      const recommended = toBoolean(rawOption.recommended);
      return {
        value,
        label,
        ...(description ? { description } : {}),
        ...(recommended !== undefined ? { recommended } : {}),
      };
    });

    const showWhen = isRecord(q.showWhen)
      ? {
          ...q.showWhen,
          ...(typeof q.showWhen.questionId === "string"
            ? { questionId: readSingleLine(q.showWhen.questionId) }
            : {}),
          ...(typeof q.showWhen.equals === "string"
            ? { equals: readSingleLine(q.showWhen.equals) }
            : {}),
        }
      : undefined;

    return {
      id,
      header,
      question,
      ...(context ? { context } : {}),
      multiSelect: toBoolean(q.multiSelect) ?? false,
      ...(toBoolean(q.required) !== undefined
        ? { required: toBoolean(q.required) as boolean }
        : {}),
      ...(showWhen ? { showWhen: showWhen as unknown as ShowWhen } : {}),
      options: withRecommendedFirst(options).slice(0, MAX_OPTIONS),
    };
  });
}

/**
 * Normalize the top-level `questions` container so it is always an array of
 * question records (see normalizeQuestions). Missing/malformed containers
 * become [] so the extension can reject with a clean, actionable error
 * instead of Pi's raw framework validation failure.
 */
export function questionsToArray(input: unknown): unknown[] {
  if (Array.isArray(input)) return input.filter(isRecord);
  if (isRecord(input)) return [input];
  return [];
}

/**
 * Normalize full tool-call arguments for the `prepareArguments` hook.
 * Runs BEFORE Pi's schema validation, so every fixable LLM mistake is already
 * repaired by the time the strict schema is checked. Never throws.
 */
export function normalizeQuestionArgs(args: unknown): {
  questions: Question[];
} {
  if (args && typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    return {
      ...record,
      questions: normalizeQuestions(questionsToArray(record.questions)),
    };
  }
  return { questions: [] };
}

/**
 * Detect questions that already went through normalizeQuestions()/prepareArguments().
 * Lets execute() skip re-normalization so prepareArguments semantics are
 * preserved exactly (e.g. a blank `question` stays blank and is rejected with
 * a clean error instead of being silently filled from a derived header).
 */
export function isNormalizedQuestions(input: unknown): input is Question[] {
  if (!Array.isArray(input) || input.length === 0) return false;
  return input.every((raw) => {
    if (!isRecord(raw)) return false;
    if (typeof raw.id !== "string" || raw.id.trim() === "") return false;
    if (typeof raw.header !== "string" || raw.header.trim() === "")
      return false;
    if (typeof raw.question !== "string") return false;
    if (typeof raw.multiSelect !== "boolean") return false;
    if (!Array.isArray(raw.options)) return false;
    return raw.options.every(
      (option) =>
        isRecord(option) &&
        typeof option.value === "string" &&
        option.value.trim() !== "" &&
        typeof option.label === "string" &&
        option.label.trim() !== "",
    );
  });
}

interface TextRule {
  maxLength: number;
  blankMessage: string;
  /** Fields the renderer wraps may contain line breaks; single-line fields may not. */
  allowNewlines?: boolean;
  /** Measure against terminal columns instead of UTF-16 length. */
  measure?: "width";
}

function validateText(
  value: unknown,
  field: string,
  rule: TextRule,
): string | undefined {
  if (typeof value !== "string") return `${field} must be a string.`;
  if (!value.trim()) return rule.blankMessage;
  const length = rule.measure === "width" ? visibleWidth(value) : value.length;
  if (length > rule.maxLength)
    return `${field} must be at most ${rule.maxLength} ${
      rule.measure === "width" ? "columns" : "characters"
    }.`;
  if (hasUnsafeControlCharacters(value, { allowNewlines: rule.allowNewlines }))
    return `${field} contains terminal control characters.`;
}

export function validateQuestions(questions: unknown): string | undefined {
  if (!Array.isArray(questions)) return "Questions must be an array.";
  if (questions.length < 1 || questions.length > MAX_QUESTIONS) {
    return `Provide between 1 and ${MAX_QUESTIONS} questions.`;
  }

  const questionIds = new Set<string>();
  const optionValuesById = new Map<string, Set<string>>();
  const hasShowWhenById = new Map<string, boolean>();

  for (const [questionIndex, question] of questions.entries()) {
    if (!isRecord(question))
      return `Question ${questionIndex + 1} must be an object.`;

    const idError = validateText(question.id, "Question id", {
      maxLength: MAX_ID_LENGTH,
      blankMessage: "Question id must not be blank.",
    });
    if (idError) return idError;
    const id = question.id as string;

    const headerError = validateText(
      question.header,
      `Question header: ${id}`,
      {
        maxLength: HEADER_DISPLAY_MAX,
        measure: "width",
        blankMessage: `Question header must not be blank: ${id}`,
      },
    );
    if (headerError) return headerError;
    const questionError = validateText(
      question.question,
      `Question text: ${id}`,
      {
        maxLength: MAX_QUESTION_LENGTH,
        allowNewlines: true,
        blankMessage: `Question text must not be blank: ${id}`,
      },
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
        {
          maxLength: MAX_CONTEXT_LENGTH,
          allowNewlines: true,
          blankMessage: `Question context must not be blank: ${id}`,
        },
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
        {
          maxLength: MAX_ID_LENGTH,
          blankMessage: `Question showWhen.questionId must not be blank: ${id}`,
        },
      );
      if (parentIdError) return parentIdError;
      const equalsError = validateText(
        showWhen.equals,
        `Question showWhen.equals: ${id}`,
        {
          maxLength: MAX_ID_LENGTH,
          blankMessage: `Question showWhen.equals must not be blank: ${id}`,
        },
      );
      if (equalsError) return equalsError;
    }
    if (!Array.isArray(question.options))
      return `Question options must be an array: ${id}.`;
    if (
      question.options.length < MIN_OPTIONS ||
      question.options.length > MAX_OPTIONS
    ) {
      return `Question ${id} must have between ${MIN_OPTIONS} and ${MAX_OPTIONS} options.`;
    }
    if (questionIds.has(id)) return `Duplicate question id: ${id}`;
    questionIds.add(id);
    hasShowWhenById.set(id, question.showWhen !== undefined);

    const optionValues = new Set<string>();
    for (const option of question.options) {
      if (!isRecord(option)) return `Option must be an object in ${id}.`;
      const valueError = validateText(option.value, `Option value in ${id}`, {
        maxLength: MAX_ID_LENGTH,
        blankMessage: `Option value must not be blank in ${id}.`,
      });
      if (valueError) return valueError;
      const labelError = validateText(option.label, `Option label in ${id}`, {
        maxLength: MAX_LABEL_LENGTH,
        blankMessage: `Option label must not be blank in ${id}.`,
      });
      if (labelError) return labelError;
      if (option.description !== undefined) {
        const descriptionError = validateText(
          option.description,
          `Option description in ${id}`,
          {
            maxLength: MAX_CONTEXT_LENGTH,
            allowNewlines: true,
            blankMessage: `Option description must not be blank in ${id}.`,
          },
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
