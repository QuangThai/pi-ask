import type { Answer, Question } from "./schema.js";
import { formatInlineText } from "./text.js";

/**
 * Format submitted answers for the model.
 *
 * The tool description promises that each option `value` is "returned to you",
 * so the value is what leads every line; the human label follows in quotes when
 * it adds information, and free-text answers are marked so the model can tell
 * them apart from a picked option.
 */
export function summarizeAnswers(
  questions: Question[],
  answers: Answer[],
): string[] {
  if (answers.length === 0) return ["All optional questions were skipped."];

  return answers.map((answer) => {
    const question = questions.find((item) => item.id === answer.questionId);
    const selected = answer.selectedValues
      .map((value) => {
        const label = question?.options.find(
          (option) => option.value === value,
        )?.label;
        return label && label !== value ? `${value} ("${label}")` : value;
      })
      .join(", ");
    const parts = [
      selected,
      answer.customText
        ? `(wrote) ${formatInlineText(answer.customText)}`
        : undefined,
    ].filter((part): part is string => Boolean(part));
    return `${answer.questionId}: ${parts.join("; ")}`;
  });
}
