import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, TruncatedText } from "@earendil-works/pi-tui";
import { QuestionnaireComponent } from "./component.js";
import { globalKeyLabel } from "./keys.js";
import { summarizeAnswers } from "./result.js";
import {
  AskParameters,
  type AskResult,
  HEADER_DISPLAY_MAX,
  isNormalizedQuestions,
  MAX_OPTIONS,
  normalizeQuestionArgs,
  normalizeQuestions,
  validateQuestions,
} from "./schema.js";
import { formatInlineText, toWrappedText } from "./text.js";

/** Minimal view of the tool arguments needed to label a stored result. */
interface QuestionMeta {
  question: string;
  labels: Map<string, string>;
}

/**
 * Rebuild question metadata from the recorded tool-call arguments so the
 * transcript can show what the user actually read ("Persist: Tool result
 * details") instead of the machine keys. Pi passes the same arguments back to
 * `renderResult`, which is why they are not duplicated into `details`.
 */
function readQuestionMeta(args: unknown): Map<string, QuestionMeta> {
  const meta = new Map<string, QuestionMeta>();
  const questions =
    args && typeof args === "object" && !Array.isArray(args)
      ? (args as { questions?: unknown }).questions
      : undefined;
  if (!Array.isArray(questions)) return meta;

  for (const question of questions) {
    if (!question || typeof question !== "object") continue;
    const record = question as {
      id?: unknown;
      header?: unknown;
      question?: unknown;
      options?: unknown;
    };
    if (typeof record.id !== "string" || !record.id) continue;
    const labels = new Map<string, string>();
    if (Array.isArray(record.options)) {
      for (const option of record.options) {
        if (!option || typeof option !== "object") continue;
        const { value, label } = option as { value?: unknown; label?: unknown };
        if (typeof value === "string" && typeof label === "string") {
          labels.set(value, label);
        }
      }
    }
    meta.set(record.id, {
      question:
        typeof record.question === "string" && record.question.trim()
          ? record.question
          : typeof record.header === "string" && record.header
            ? record.header
            : record.id,
      labels,
    });
  }
  return meta;
}

export default function (pi: ExtensionAPI) {
  const toolName = "ask_user_question";

  const deactivate = () => {
    pi.setActiveTools(pi.getActiveTools().filter((name) => name !== toolName));
  };

  pi.registerTool({
    name: toolName,
    label: "Ask User",
    description:
      `Ask the user 1–4 clarifying questions before proceeding. ` +
      `Use this tool to clarify ambiguous instructions, get preferences, ` +
      `make decisions, or offer choices. Each question has 2–${MAX_OPTIONS} options. ` +
      `Do not include an "Other" option — it is automatic. ` +
      `Every option needs a value (a short stable key that is returned to you, ` +
      `e.g. "minimal") and a label (the text shown to the user). If you omit a ` +
      `value it is auto-derived from the label, but providing one is preferred. ` +
      `multiSelect defaults to false; set it to true only when users may select multiple options. ` +
      `Set required: false to allow skipping a question. ` +
      `Use showWhen: { questionId, equals } for a one-level follow-up that appears only after the parent is confirmed with that option value. ` +
      `The header field is a short tab label (max ${HEADER_DISPLAY_MAX} columns). ` +
      `question, context and option description may span several lines; header, label and value must stay on one line. ` +
      `If you recommend an option, add recommended: true to that option — it is shown first.`,
    promptSnippet:
      "ask_user_question: Structured multi‑question UI with review.",
    promptGuidelines: [
      `Use ${toolName} for user decisions instead of asking in plain text.`,
      `Review answers are collected in a review tab before submission.`,
      `Choosing a single-choice option (Space/Enter) saves and continues to the next tab automatically; an Other answer is saved and continues on Enter.`,
      `Use showWhen for conditional follow-ups; do not nest showWhen deeper than one level.`,
      `Keep headers under ${HEADER_DISPLAY_MAX} columns for clean TUI tabs.`,
      `Every option needs both value and label; if value is omitted it is derived from the label.`,
      `${toolName} returns the option value you supplied, so choose values you can branch on.`,
    ],
    parameters: AskParameters,

    /**
     * Runs BEFORE Pi's framework validates the arguments against AskParameters.
     * Derives anything the model omitted (option values, labels, ids, headers),
     * wraps single-object containers, drops null placeholders, strips escape
     * sequences, and normalizes boolean flags — so the strict schema never
     * rejects a fixable call with a raw "Validation failed for tool ..." error.
     * Never throws.
     */
    prepareArguments(args) {
      return normalizeQuestionArgs(args);
    },

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Validate every runtime value before it reaches the TUI. Pi runs
      // prepareArguments() before schema validation, so in production the
      // questions arrive already normalized — re-normalizing them would mask
      // blank `question` text. For direct callers (RPC/SDK/tests) normalize
      // the raw input here as a safety net.
      const rawQuestions =
        typeof params === "object" && params !== null && "questions" in params
          ? (params as { questions?: unknown }).questions
          : undefined;
      const questions = isNormalizedQuestions(rawQuestions)
        ? rawQuestions
        : normalizeQuestions(rawQuestions);
      const validationError = validateQuestions(questions);
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

      // ctx.ui.custom() requires an interactive terminal TUI; RPC UI helpers do
      // not guarantee a focusable terminal component. session_start already
      // disables the tool outside TUI mode — this is the direct-caller guard.
      if (ctx.mode !== "tui") {
        deactivate();
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
        (tui, theme, keybindings, done) => {
          let settled = false;
          const settleOnce = (value: AskResult | null) => {
            if (settled) return;
            settled = true;
            done(value);
          };
          const component = new QuestionnaireComponent(
            questions,
            tui,
            theme,
            (value) => settleOnce(value as AskResult | null),
            keybindings,
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

    renderResult(result, { expanded }, theme, context) {
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
          // A submitted empty array means every optional question was skipped.
          if (details.answers.length === 0) {
            return new TruncatedText(
              theme.fg("muted", "All optional questions were skipped."),
              0,
              0,
            );
          }

          const meta = readQuestionMeta(context.args);
          let hasHiddenDetail = false;

          const rows = details.answers.map((answer) => {
            const question = meta.get(answer.questionId);
            const title = question?.question ?? answer.questionId;
            const picked = answer.selectedValues.map((value) => {
              const label = question?.labels.get(value);
              if (label && label !== value) hasHiddenDetail = true;
              return formatInlineText(
                expanded && label && label !== value
                  ? `${label} [${value}]`
                  : (label ?? value),
              );
            });
            const parts = [
              picked.join(", "),
              answer.customText
                ? `(wrote) ${toWrappedText(answer.customText)}`
                : undefined,
            ].filter((part): part is string => Boolean(part));
            return `${theme.fg("muted", toWrappedText(title))}\n${theme.fg("text", parts.join("; "))}`;
          });

          // The decision record is readable without expanding: full question,
          // then full answer, with one blank line between pairs. Text wraps
          // safely to the host width rather than truncating long answers.
          if (!expanded && hasHiddenDetail) {
            rows.push(
              theme.fg("dim", globalKeyLabel("app.tools.expand", "ctrl+o")) +
                theme.fg("muted", " to expand"),
            );
          }
          return new Text(rows.join("\n\n"), 0, 0);
        }
      }
    },
  });

  // Outside an interactive terminal the dialog cannot open, so drop the tool
  // before the model ever sees it instead of spending a tool call to find out.
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") deactivate();
  });
}
