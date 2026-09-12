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
    ).toEqual([`features: review ("Review tab"); (wrote) Support CSV`]);
  });

  it("leads with the stable option value the model supplied", () => {
    expect(
      summarizeAnswers(questions, [
        { questionId: "features", selectedValues: ["review", "export"] },
      ]),
    ).toEqual([`features: review ("Review tab"), export ("Export")`]);
  });

  it("omits the label when it carries no extra information", () => {
    const plain = [
      {
        id: "mode",
        header: "Mode",
        question: "Which mode?",
        multiSelect: false,
        options: [
          { value: "fast", label: "fast" },
          { value: "slow", label: "slow" },
        ],
      },
    ] satisfies Question[];

    expect(
      summarizeAnswers(plain, [
        { questionId: "mode", selectedValues: ["fast"] },
      ]),
    ).toEqual(["mode: fast"]);
  });

  it("uses stable values when the source option is unavailable", () => {
    expect(
      summarizeAnswers(questions, [
        { questionId: "missing", selectedValues: ["legacy"] },
      ]),
    ).toEqual(["missing: legacy"]);
  });

  it("reports when every optional question was skipped", () => {
    expect(summarizeAnswers(questions, [])).toEqual([
      "All optional questions were skipped.",
    ]);
  });
});
