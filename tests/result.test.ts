import { describe, expect, it } from "vitest";
import { summarizeAnswers } from "../src/result.js";
import type { Question } from "../src/schema.js";

const questions = [
  {
    id: "features",
    header: "Features",
    question: "Which features?",
    multiSelect: true,
    options: [
      { value: "review", label: "Review tab" },
      { value: "export", label: "Export" },
    ],
  },
] satisfies Question[];

describe("summarizeAnswers", () => {
  it("keeps selected values and Other text together", () => {
    expect(
      summarizeAnswers(questions, [
        {
          questionId: "features",
          selectedValues: ["review"],
          customText: "Support CSV",
        },
      ]),
    ).toEqual(["Features: Review tab; Support CSV"]);
  });

  it("uses stable values when the source option is unavailable", () => {
    expect(
      summarizeAnswers(questions, [
        { questionId: "missing", selectedValues: ["legacy"] },
      ]),
    ).toEqual(["missing: legacy"]);
  });
});
