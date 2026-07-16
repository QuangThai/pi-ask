import type { Answer, Question } from "./schema.js";
import { formatInlineText } from "./text.js";

/** Formats submitted answers for the model without discarding multi-select Other text. */
export function summarizeAnswers(
  questions: Question[],
  answers: Answer[],
): string[] {
  if (answers.length === 0) return ["All optional questions were skipped."];

  return answers.map((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    const header = question?.header ?? answer.questionId;
    const selected = answer.selectedValues
      .map(
        (value) =>
          question?.options.find((option) => option.value === value)?.label ??
          value,
      )
      .join(", ");
    const parts = [
      selected,
      answer.customText ? formatInlineText(answer.customText) : undefined,
    ].filter((part): part is string => Boolean(part));
    return `${header}: ${parts.join("; ")}`;
  });
}
