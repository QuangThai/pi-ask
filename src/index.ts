import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { TruncatedText } from "@earendil-works/pi-tui";
import { QuestionnaireComponent, type Theme } from "./component.js";
import { summarizeAnswers } from "./result.js";
import {
  AskParameters,
  type AskResult,
  type Question,
  validateQuestions,
} from "./schema.js";
import { formatInlineText } from "./text.js";

export default function (pi: ExtensionAPI) {
  const toolName = "ask_user_question";

  pi.registerTool({
    name: toolName,
    label: "Ask User",
    description:
      `Ask the user 1–4 clarifying questions before proceeding. ` +
      `Use this tool to clarify ambiguous instructions, get preferences, ` +
      `make decisions, or offer choices. Each question has 2–4 options. ` +
      `Do not include an "Other" option — it is automatic. ` +
      `multiSelect defaults to false; set it to true only when users may select multiple options. ` +
      `Set required: false to allow skipping a question. ` +
      `Use showWhen: { questionId, equals } for a one-level follow-up that appears only after the parent is confirmed with that option value. ` +
      `The header field is a short tab label (max 12 characters). ` +
      `If you recommend an option, add recommended: true to that option — it is shown first.`,
    promptSnippet:
      "ask_user_question: Structured multi‑question UI with review.",
    promptGuidelines: [
      `Use ${toolName} for user decisions instead of asking in plain text.`,
      `Review answers are collected in a review tab before submission.`,
      `Use showWhen for conditional follow-ups; do not nest showWhen deeper than one level.`,
      `When unavailable (print/JSON mode) the tool disables automatically.`,
    ],
    parameters: AskParameters,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Validate every runtime value before it reaches the TUI.
      const rawQuestions =
        typeof params === "object" && params !== null && "questions" in params
          ? (params as { questions?: unknown }).questions
          : undefined;
      const validationError = validateQuestions(rawQuestions);
      if (validationError) {
        return {
          content: [{ type: "text", text: `Error: ${validationError}` }],
          details: {
            version: 1,
            status: "invalid",
            answers: [],
          } satisfies AskResult,
        };
      }

      const questions = rawQuestions as Question[];

      // ctx.ui.custom() requires an interactive terminal TUI; RPC UI helpers do
      // not guarantee a focusable terminal component.
      if (ctx.mode !== "tui") {
        pi.setActiveTools(
          pi.getActiveTools().filter((name) => name !== toolName),
        );
        return {
          content: [
            {
              type: "text",
              text: `${toolName} requires interactive UI. Tool disabled for this session.`,
            },
          ],
          details: {
            version: 1,
            status: "unavailable",
            answers: [],
          } satisfies AskResult,
        };
      }

      // Abort signal already fired
      if (signal?.aborted) {
        return {
          content: [{ type: "text", text: "Cancelled before dialog opened." }],
          details: {
            version: 1,
            status: "aborted",
            answers: [],
          } satisfies AskResult,
        };
      }

      // Open the interactive TUI
      const result = await ctx.ui.custom<AskResult | null>(
        (tui, theme, _kb, done) => {
          let settled = false;
          const settleOnce = (value: AskResult | null) => {
            if (settled) return;
            settled = true;
            done(value);
          };
          const component = new QuestionnaireComponent(
            questions,
            tui,
            theme as unknown as Theme,
            (value) => settleOnce(value as AskResult | null),
          );

          // Cleanup on abort
          const onAbort = () => {
            component.dispose();
            settleOnce({ version: 1, status: "aborted", answers: [] });
          };
          signal?.addEventListener("abort", onAbort, { once: true });

          return {
            get focused() {
              return component.focused;
            },
            set focused(value: boolean) {
              component.focused = value;
            },
            render: (width) => component.render(width),
            invalidate: () => component.invalidate(),
            handleInput: (data) => component.handleInput(data),
            dispose: () => {
              component.dispose();
              signal?.removeEventListener("abort", onAbort);
            },
          };
        },
        { overlay: false },
      );

      if (result?.status === "aborted") {
        return {
          content: [{ type: "text", text: "Cancelled by abort signal." }],
          details: result,
        };
      }

      // User dismissed the dialog
      if (result?.status !== "submitted") {
        return {
          content: [{ type: "text", text: "Cancelled by user." }],
          details: {
            version: 1,
            status: "dismissed",
            answers: [],
          } satisfies AskResult,
        };
      }

      // Build a concise summary for the LLM without losing selected values
      // when a multi-select answer also contains Other text.
      const summaryLines = summarizeAnswers(questions, result.answers);

      return {
        content: [{ type: "text", text: summaryLines.join("\n") }],
        details: result satisfies AskResult,
      };
    },

    renderCall(args, theme, _context) {
      const questions =
        args &&
        typeof args === "object" &&
        Array.isArray((args as { questions?: unknown }).questions)
          ? ((args as { questions: unknown[] }).questions ?? [])
          : [];
      const count = questions.length;
      const headers = questions
        .map((question) => {
          if (
            !question ||
            typeof question !== "object" ||
            typeof (question as { header?: unknown }).header !== "string"
          ) {
            return "?";
          }
          return formatInlineText((question as { header: string }).header);
        })
        .join(", ");
      let text =
        theme.fg("toolTitle", theme.bold("ask ")) +
        theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
      if (headers) text += theme.fg("dim", ` (${headers})`);
      return new TruncatedText(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as AskResult | undefined;

      if (!details) {
        const t = result.content[0];
        return new TruncatedText(t?.type === "text" ? t.text : "", 0, 0);
      }

      switch (details.status) {
        case "dismissed":
          return new TruncatedText(theme.fg("warning", "Dismissed"), 0, 0);
        case "aborted":
          return new TruncatedText(theme.fg("warning", "Aborted"), 0, 0);
        case "unavailable":
          return new TruncatedText(theme.fg("error", "Unavailable"), 0, 0);
        case "invalid":
          return new TruncatedText(theme.fg("error", "Invalid input"), 0, 0);
        case "submitted": {
          // Compact: one line per answer. A submitted empty array means every
          // optional question was explicitly skipped.
          const lines =
            details.answers.length === 0
              ? [theme.fg("muted", "All optional questions were skipped.")]
              : details.answers.map((answer) => {
                  const answerText = [
                    answer.selectedValues.join(", "),
                    answer.customText
                      ? `(wrote) ${formatInlineText(answer.customText)}`
                      : undefined,
                  ]
                    .filter((part): part is string => Boolean(part))
                    .join("; ");
                  return `${theme.fg("accent", `${formatInlineText(answer.questionId)}: `)}${theme.fg("text", answerText)}`;
                });
          // Build a TruncatedText from joined lines
          const box = {
            render(_width: number) {
              // Simple rendering: join with newline
              let result = "";
              for (const line of lines) {
                if (result) result += "\n";
                result += line;
              }
              return [result];
            },
            invalidate() {},
          };
          return box;
        }
      }
    },
  });
}
