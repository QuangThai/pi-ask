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
      `Set multiSelect: true when multiple options can apply. ` +
      `The header field is a short tab label (max 12 characters). ` +
      `If you recommend an option, add recommended: true to that option.`,
    promptSnippet:
      "ask_user_question: Structured multi‑question UI with review.",
    promptGuidelines: [
      `Use ${toolName} for user decisions instead of asking in plain text.`,
      `Review answers are collected in a review tab before submission.`,
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
          const component = new QuestionnaireComponent(
            questions,
            tui,
            theme as unknown as Theme,
            (value) => done(value as AskResult | null),
          );

          // Cleanup on abort
          const onAbort = () => {
            component.dispose();
            done({ version: 1, status: "aborted", answers: [] });
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
      const questions = (args.questions ?? []) as Question[];
      const count = questions.length;
      const headers = questions.map((q) => q.header).join(", ");
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
          // Compact: one line per answer
          // We don't have access to original question labels here,
          // so render the structured answer compactly
          const lines = details.answers.map((answer) => {
            const sel = answer.customText
              ? `(wrote) ${answer.customText}`
              : answer.selectedValues.join(", ");
            return `${theme.fg("success", "✓ ")}${theme.fg("accent", `${answer.questionId}: `)}${theme.fg("text", sel)}`;
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
