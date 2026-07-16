import type { Answer, Question } from "./schema.js";

/** Formats submitted answers for the model without discarding multi-select Other text. */
export function summarizeAnswers(
  questions: Question[],
  answers: Answer[],
): string[] {
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
    const parts = [selected, answer.customText].filter((part): part is string =>
      Boolean(part),
    );
    return `${header}: ${parts.join("; ")}`;
  });
}
