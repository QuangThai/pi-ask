import type { Theme as PiTheme } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type Focusable,
  Key,
  type Keybinding,
  type KeybindingsManager,
  type KeyId,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { keyLabelFor } from "./keys.js";
import { normalizeQuestions, type Option, type Question } from "./schema.js";
import {
  createQuestionnaireState,
  type QuestionnaireAction,
  type QuestionnaireState,
  reduceQuestionnaire,
  toResult,
  visibleQuestionIndices,
} from "./state.js";
import { formatInlineText } from "./text.js";

/**
 * Only the three styling helpers are used, so a test or a host that is not the
 * interactive TUI can supply a stand-in without implementing the whole class.
 */
export type Theme = Pick<PiTheme, "fg" | "bg" | "bold">;

type DoneFn = (result: unknown) => void;

/** Rows below the options list. Their order matches the rendered order. */
type ExtraRow = "other" | "skip";

/**
 * Pick the first hint variant that fits the available columns, falling back to
 * the shortest one. Hints are the only place the key bindings are discoverable,
 * so a narrow terminal should lose detail, not the whole line.
 */
function firstThatFits(width: number, variants: string[]): string {
  for (const variant of variants) {
    if (visibleWidth(variant) <= width) return variant;
  }
  return variants[variants.length - 1] ?? "";
}

export class QuestionnaireComponent implements Focusable {
  private questions: Question[];
  private state: QuestionnaireState;
  private theme: Theme;
  private tui: TUI;
  private keybindings?: KeybindingsManager;
  private done: DoneFn;
  private editor: Editor;
  private cachedWidth?: number;
  private cachedLines?: string[];
  private settled = false;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.editor.focused = value;
  }

  constructor(
    questions: Question[],
    tui: TUI,
    theme: Theme,
    done: DoneFn,
    keybindings?: KeybindingsManager,
  ) {
    // Normalize once so recommended options lead and selectedValues indices match.
    this.questions = normalizeQuestions(questions);
    this.state = createQuestionnaireState(this.questions);
    this.tui = tui;
    this.theme = theme;
    this.keybindings = keybindings;
    this.done = done;
    this.editor = new Editor(tui, {
      borderColor: (s: string) => theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => theme.fg("accent", t),
        description: (t: string) => theme.fg("muted", t),
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
      },
    });
    this.editor.disableSubmit = true;
    this.editor.onChange = () => {
      this.invalidate();
      this.tui.requestRender();
    };
  }

  /**
   * Match against the user's configured keybindings when the host injected its
   * manager (pi always does), falling back to the documented defaults for
   * direct construction in tests. Keys with no keybinding id — Space and the
   * tab-switching arrows — always use their literal binding.
   */
  private matches(data: string, binding: Keybinding, fallback: KeyId): boolean {
    return this.keybindings
      ? this.keybindings.matches(data, binding)
      : matchesKey(data, fallback);
  }

  private keyLabel(binding: Keybinding, fallback: KeyId): string {
    return keyLabelFor(this.keybindings, binding, fallback);
  }

  private dispatch(action: QuestionnaireAction): void {
    this.state = reduceQuestionnaire(this.state, action, this.questions);
    this.invalidate();
    this.tui.requestRender();
  }

  /** Rows shown under the options for a question, in render order. */
  private getExtraRows(question: Question): ExtraRow[] {
    return question.required === false ? ["other", "skip"] : ["other"];
  }

  private getRowCount(question: Question): number {
    return question.options.length + this.getExtraRows(question).length;
  }

  /** Which non-option row the cursor is on, if any. */
  private getExtraRow(
    question: Question,
    cursor: number,
  ): ExtraRow | undefined {
    return this.getExtraRows(question)[cursor - question.options.length];
  }

  /** Visible question indices plus the Review tab index. */
  private getNavTabs(): number[] {
    return [
      ...visibleQuestionIndices(this.questions, this.state.answers),
      this.questions.length,
    ];
  }

  private moveTab(delta: -1 | 1): void {
    const tabs = this.getNavTabs();
    if (tabs.length === 0) return;
    const current = tabs.indexOf(this.state.activeTab);
    const from = current >= 0 ? current : 0;
    const next = tabs[(from + delta + tabs.length) % tabs.length];
    if (next === undefined) return;
    this.dispatch({ type: "goTab", tab: next });
  }

  handleInput(data: string): void {
    if (this.settled) return;

    if (this.state.editing === "custom") {
      // `tui.select.cancel` also covers ctrl+c, which inside a text editor is
      // the copy binding — leave that one to the editor.
      const isEditorCopy =
        this.keybindings?.matches(data, "tui.input.copy") ?? false;
      if (
        !isEditorCopy &&
        this.matches(data, "tui.select.cancel", Key.escape)
      ) {
        this.dispatch({ type: "cancelEdit" });
        return;
      }
      if (this.matches(data, "tui.input.submit", Key.enter)) {
        const value = this.editor.getText();
        this.dispatch({
          type: "saveCustom",
          value,
          clearSelections: !this.questions[this.state.activeTab]?.multiSelect,
        });
        this.editor.setText("");
        // Single Enter: save + confirm + advance. A blank save leaves no
        // answer, so confirm() is a no-op and the user stays on the tab.
        this.dispatch({ type: "confirm" });
        return;
      }
      this.editor.handleInput(data);
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (this.matches(data, "tui.select.cancel", Key.escape)) {
      this.finish(null);
      return;
    }
    if (matchesKey(data, Key.left)) {
      this.moveTab(-1);
      return;
    }
    if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
      this.moveTab(1);
      return;
    }
    if (matchesKey(data, Key.shift("tab"))) {
      this.moveTab(-1);
      return;
    }

    // Review tab
    if (this.state.activeTab === this.questions.length) {
      if (
        this.matches(data, "tui.select.confirm", Key.enter) &&
        this.state.canSubmit
      ) {
        this.finish(toResult(this.questions, this.state));
      }
      return;
    }

    const question = this.questions[this.state.activeTab];
    const answer = this.state.answers[this.state.activeTab];
    if (!question || !answer) return;

    if (this.matches(data, "tui.select.up", Key.up)) {
      this.dispatch({
        type: "move",
        delta: -1,
        max: this.getRowCount(question) - 1,
      });
      return;
    }
    if (this.matches(data, "tui.select.down", Key.down)) {
      this.dispatch({
        type: "move",
        delta: 1,
        max: this.getRowCount(question) - 1,
      });
      return;
    }

    const cursor = answer.cursorIndex;
    const isConfirm = this.matches(data, "tui.select.confirm", Key.enter);
    const isSpace = matchesKey(data, Key.space);
    const extraRow = this.getExtraRow(question, cursor);

    if (extraRow === "skip") {
      if (isConfirm || isSpace) this.dispatch({ type: "skip" });
      return;
    }

    if (extraRow === "other") {
      // Enter confirms an already saved answer; otherwise open the editor.
      if (isConfirm && answer.customText) {
        this.dispatch({ type: "confirm" });
        return;
      }
      if (isConfirm || isSpace) {
        this.dispatch({ type: "startCustom" });
        this.editor.setText(answer.customText ?? "");
      }
      return;
    }

    if (question.multiSelect) {
      if (isSpace) {
        this.dispatch({ type: "toggle", optionIndex: cursor });
        return;
      }
      if (isConfirm) {
        // Enter = toggle the highlighted option if needed, then confirm.
        if (!answer.selectedValues.includes(String(cursor))) {
          this.dispatch({ type: "toggle", optionIndex: cursor });
        }
        const updated = this.state.answers[this.state.activeTab];
        if (
          updated &&
          (updated.selectedValues.length > 0 || updated.customText)
        ) {
          this.dispatch({ type: "confirm" });
        }
      }
      return;
    }

    // Single select: picking an option always selects it, confirms the tab and
    // advances — including on an optional question, where skipping has its own
    // row so Enter can never silently discard the highlighted choice.
    if (isConfirm || isSpace) {
      this.dispatch({ type: "select", optionIndex: cursor });
      this.dispatch({ type: "confirm" });
    }
  }

  private finish(result: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.done(result);
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
    this.cachedWidth = width;

    const renderWidth = Math.max(1, width);
    const lines: string[] = [];
    // A row too wide for the terminal ends in "…", so a cut label or hint
    // reads as cut rather than complete. Rows that fit are kept as built.
    const add = (text = "") =>
      lines.push(truncateToWidth(text, renderWidth, "…"));
    const addWrapped = (text: string, indent = "") => {
      const max = Math.max(1, renderWidth - visibleWidth(indent));
      for (const line of wrapTextWithAnsi(text, max)) {
        add(`${indent}${line}`);
      }
    };

    const th = this.theme;
    const confirmKey = this.keyLabel("tui.select.confirm", Key.enter);
    const cancelKey = this.keyLabel("tui.select.cancel", Key.escape);

    add(th.fg("accent", "─".repeat(renderWidth)));

    const visibleIndices = visibleQuestionIndices(
      this.questions,
      this.state.answers,
    );

    // Tab bar — only visible questions (+ Review)
    if (visibleIndices.length > 1) {
      const parts: string[] = [];
      for (const i of visibleIndices) {
        const question = this.questions[i];
        if (!question) continue;
        const isActive = i === this.state.activeTab;
        const isConfirmed = this.state.answers[i]?.confirmed ?? false;
        const label = ` ${question.header} `;
        if (isActive) {
          parts.push(th.bg("selectedBg", th.fg("text", label)));
        } else {
          parts.push(th.fg(isConfirmed ? "success" : "muted", label));
        }
      }
      const isSubmit = this.state.activeTab === this.questions.length;
      const submitLabel = " Submit ";
      parts.push(
        isSubmit
          ? th.bg("selectedBg", th.fg("text", submitLabel))
          : th.fg(this.state.canSubmit ? "success" : "dim", submitLabel),
      );
      add(` ${parts.join(" ")}`);
      add("");
    }

    const ans = this.state.answers[this.state.activeTab];
    const q = this.questions[this.state.activeTab];
    const isReview = this.state.activeTab === this.questions.length;

    if (isReview) {
      add(th.fg("accent", th.bold("Review your answers")));
      add("");
      for (const [reviewIndex, i] of visibleIndices.entries()) {
        const a = this.state.answers[i];
        const qq = this.questions[i];
        if (!qq) continue;
        addWrapped(
          th.fg("muted", `${reviewIndex + 1}. ${qq.header}: ${qq.question}`),
          " ",
        );
        if (a) {
          const labels = a.selectedValues
            .map((v) => qq.options[Number(v)]?.label)
            .filter((label): label is string => Boolean(label))
            .join(", ");
          const answerText = [
            labels,
            a.customText ? formatInlineText(a.customText) : undefined,
          ]
            .filter((part): part is string => Boolean(part))
            .join("; ");
          if (answerText) {
            addWrapped(th.fg("text", `   ${answerText}`), " ");
          } else if (a.confirmed && qq.required === false) {
            addWrapped(th.fg("muted", "   Skipped"), " ");
          }
        }
      }
      add("");
      if (this.state.canSubmit) {
        add(th.fg("success", ` Press ${confirmKey} to submit`));
      }
      add(
        th.fg(
          "dim",
          ` ←→/Tab tabs  •  ${confirmKey} submit  •  ${cancelKey} dismiss`,
        ),
      );
      add(th.fg("accent", "─".repeat(renderWidth)));
      this.cachedLines = lines;
      return lines;
    }

    if (!q || !ans) {
      add("");
      add(th.fg("accent", "─".repeat(renderWidth)));
      this.cachedLines = lines;
      return lines;
    }

    // Question header
    if (q.context) {
      addWrapped(th.fg("muted", q.context), " ");
      add("");
    }
    addWrapped(th.fg("text", th.bold(q.question)), " ");
    add(
      th.fg(
        "muted",
        ` ${
          q.multiSelect
            ? `Choose any that apply — ${confirmKey} when done`
            : `Choose one — Space or ${confirmKey} to continue`
        }${q.required === false ? " — optional" : ""}`,
      ),
    );
    add("");

    const opts: Option[] = q.options;
    const cursor = ans.cursorIndex;

    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
      if (!opt) continue;
      const selected = ans.selectedValues.includes(String(i));
      const isCursor = cursor === i;
      const prefix = isCursor ? th.fg("accent", "> ") : "  ";
      const labelStyle = selected ? "success" : isCursor ? "accent" : "text";
      const labelText = opt.recommended
        ? `${opt.label}${th.fg("muted", " (Recommended)")}`
        : opt.label;
      add(`${prefix}${th.fg(labelStyle, labelText)}`);
      if (opt.description) {
        addWrapped(th.fg("muted", opt.description), "    ");
      }
    }

    for (const [extraIndex, row] of this.getExtraRows(q).entries()) {
      const rowIndex = opts.length + extraIndex;
      const isCursor = cursor === rowIndex;
      const prefix = isCursor ? th.fg("accent", "> ") : "  ";
      if (row === "other") {
        const hasCustom = Boolean(ans.customText);
        const labelStyle = hasCustom
          ? "success"
          : isCursor
            ? "accent"
            : "muted";
        const customPreview = hasCustom
          ? `: ${formatInlineText(ans.customText ?? "")}`
          : "";
        add(
          `${prefix}${th.fg(labelStyle, `Other — add your own answer${customPreview}`)}`,
        );
      } else {
        const skipped =
          ans.confirmed && ans.selectedValues.length === 0 && !ans.customText;
        const labelStyle = skipped ? "success" : isCursor ? "accent" : "muted";
        add(
          `${prefix}${th.fg(labelStyle, `Skip this question${skipped ? " (skipped)" : ""}`)}`,
        );
      }
    }

    // Editor
    if (this.state.editing) {
      add("");
      add(th.fg("muted", " Your answer:"));
      const maxWidth = Math.max(1, renderWidth - 2);
      for (const line of this.editor.render(maxWidth)) {
        add(` ${line}`);
      }
    }

    add("");
    if (this.state.editing) {
      add(
        th.fg(
          "dim",
          ` ${confirmKey} to save & continue  •  ${cancelKey} to cancel`,
        ),
      );
    } else {
      const navHint = q.multiSelect
        ? `↑↓ navigate  •  Space toggle  •  ${confirmKey} confirm`
        : `↑↓ navigate  •  Space/${confirmKey} choose & continue`;
      const tabHint = visibleIndices.length === 1 ? "" : "  •  ←→/Tab tabs";
      // Drop the least important hints first rather than letting the line be
      // cut off mid-word on a narrow terminal.
      const hint = firstThatFits(renderWidth - 1, [
        `${navHint}${tabHint}  •  ${cancelKey} dismiss`,
        `${navHint}  •  ${cancelKey} dismiss`,
        `↑↓ move  •  ${confirmKey} choose  •  ${cancelKey} dismiss`,
        `${confirmKey} choose  •  ${cancelKey} dismiss`,
      ]);
      add(th.fg("dim", ` ${hint}`));
    }

    add(th.fg("accent", "─".repeat(renderWidth)));
    this.cachedLines = lines;
    return lines;
  }

  dispose(): void {
    this.settled = true;
  }
}
