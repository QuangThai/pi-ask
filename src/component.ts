import {
  Editor,
  type Focusable,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
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

export type Theme = {
  fg: (color: string, text: string) => string;
  bg: (color: string, text: string) => string;
  bold: (text: string) => string;
};

type TUILike = { requestRender(): void };
type DoneFn = (result: unknown) => void;

export class QuestionnaireComponent implements Focusable {
  private questions: Question[];
  private state: QuestionnaireState;
  private theme: Theme;
  private tui: TUILike;
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

  constructor(questions: Question[], tui: TUILike, theme: Theme, done: DoneFn) {
    // Normalize once so recommended options lead and selectedValues indices match.
    this.questions = normalizeQuestions(questions);
    this.state = createQuestionnaireState(this.questions);
    this.tui = tui;
    this.theme = theme;
    this.done = done;
    this.editor = new Editor(tui as never, {
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

  private dispatch(action: QuestionnaireAction): void {
    this.state = reduceQuestionnaire(this.state, action, this.questions);
    this.invalidate();
    this.tui.requestRender();
  }

  private getOptions(question: Question): Option[] {
    return [...question.options];
  }

  private getRowCount(question: Question): number {
    return this.getOptions(question).length + 1; // options + Other
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
    this.dispatch({
      type: "goTab",
      tab: tabs[(from + delta + tabs.length) % tabs.length],
    });
  }

  handleInput(data: string): void {
    if (this.settled) return;

    const t = this.state.editing;

    if (t === "custom") {
      if (matchesKey(data, Key.escape)) {
        this.dispatch({ type: "cancelEdit" });
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const value = this.editor.getText();
        this.dispatch({
          type: "saveCustom",
          value,
          clearSelections: !this.questions[this.state.activeTab]?.multiSelect,
        });
        this.editor.setText("");
        return;
      }
      this.editor.handleInput(data);
      this.invalidate();
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, Key.escape)) {
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
    if (matchesKey(data, "shift+tab") || matchesKey(data, Key.shift("tab"))) {
      this.moveTab(-1);
      return;
    }

    // Review tab
    if (this.state.activeTab === this.questions.length) {
      if (matchesKey(data, Key.enter) && this.state.canSubmit) {
        this.finish(toResult(this.questions, this.state));
      }
      return;
    }

    const q = this.questions[this.state.activeTab];
    if (!q) return;

    if (matchesKey(data, Key.up)) {
      this.dispatch({ type: "move", delta: -1, max: this.getRowCount(q) - 1 });
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.dispatch({ type: "move", delta: 1, max: this.getRowCount(q) - 1 });
      return;
    }
    const cursor = this.state.answers[this.state.activeTab]?.cursorIndex ?? 0;
    const opts = this.getOptions(q);

    if (cursor === opts.length) {
      // Other / custom answer: Enter confirms an existing value; Space edits it.
      const answer = this.state.answers[this.state.activeTab];
      if (matchesKey(data, Key.enter) && answer?.customText) {
        this.dispatch({ type: "confirm" });
        return;
      }
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
        this.dispatch({ type: "startCustom" });
        this.editor.setText(answer?.customText ?? "");
      }
      return;
    }
    if (q.multiSelect) {
      if (matchesKey(data, Key.space)) {
        this.dispatch({ type: "toggle", optionIndex: cursor });
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const ans = this.state.answers[this.state.activeTab];
        if (!ans) return;
        // Toggle cursor option if not yet selected (Enter = toggle + confirm)
        if (!ans.selectedValues.includes(String(cursor))) {
          this.dispatch({ type: "toggle", optionIndex: cursor });
        }
        const updated = this.state.answers[this.state.activeTab];
        if (
          updated &&
          (updated.selectedValues.length > 0 || updated.customText)
        ) {
          this.dispatch({ type: "confirm" });
        } else if (q.required === false) {
          this.dispatch({ type: "confirm" });
        }
        return;
      }
    } else {
      if (matchesKey(data, Key.space)) {
        this.dispatch({ type: "select", optionIndex: cursor });
        return;
      }
      if (matchesKey(data, Key.enter)) {
        const answer = this.state.answers[this.state.activeTab];
        if (
          q.required === false &&
          answer &&
          answer.selectedValues.length === 0 &&
          !answer.customText
        ) {
          this.dispatch({ type: "confirm" });
        } else {
          this.dispatch({ type: "select", optionIndex: cursor });
          this.dispatch({ type: "confirm" });
        }
        return;
      }
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
    const add = (text = "") =>
      lines.push(truncateToWidth(text, renderWidth, ""));
    const addWrapped = (text: string, indent = "") => {
      const max = Math.max(1, renderWidth - visibleWidth(indent));
      for (const line of wrapTextWithAnsi(text, max)) {
        add(`${indent}${line}`);
      }
    };

    const th = this.theme;

    add(th.fg("accent", "─".repeat(renderWidth)));

    const visibleIndices = visibleQuestionIndices(
      this.questions,
      this.state.answers,
    );

    // Tab bar — only visible questions (+ Review)
    if (visibleIndices.length > 1) {
      const parts: string[] = [];
      for (const i of visibleIndices) {
        const isActive = i === this.state.activeTab;
        const isConfirmed = this.state.answers[i]?.confirmed ?? false;
        const label = ` ${this.questions[i].header} `;
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
        addWrapped(
          th.fg("muted", `${reviewIndex + 1}. ${qq.header}: ${qq.question}`),
          " ",
        );
        if (a) {
          const labels = a.selectedValues
            .map((v) => qq.options[Number(v)]?.label)
            .filter(Boolean)
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
            add(th.fg("muted", "   Skipped"));
          }
        }
      }
      add("");
      if (this.state.canSubmit) {
        add(th.fg("success", " Press Enter to submit"));
      }
      add(th.fg("dim", " ←→/Tab tabs  •  Enter submit  •  Esc dismiss"));
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
        ` ${q.required === false ? "Optional — press Enter to skip" : q.multiSelect ? "Choose any that apply" : "Choose one"}`,
      ),
    );
    add("");

    const opts = this.getOptions(q);
    const cursor = ans.cursorIndex;

    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i];
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

    // Custom answer row
    {
      const isCursor = cursor === opts.length;
      const prefix = isCursor ? th.fg("accent", "> ") : "  ";
      const hasCustom = Boolean(ans.customText);
      const labelStyle = hasCustom ? "success" : isCursor ? "accent" : "muted";
      const customPreview = hasCustom
        ? `: ${formatInlineText(ans.customText ?? "")}`
        : "";
      add(
        `${prefix}${th.fg(labelStyle, `Other — add your own answer${customPreview}`)}`,
      );
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
      add(th.fg("dim", " Enter to save  •  Esc to cancel"));
    } else if (visibleIndices.length === 1) {
      add(
        th.fg(
          "dim",
          " ↑↓ navigate  •  Space select/toggle  •  Enter confirm  •  Esc dismiss",
        ),
      );
    } else {
      add(
        th.fg(
          "dim",
          " ↑↓ navigate  •  Space select/toggle  •  Enter confirm  •  ←→/Tab tabs  •  Esc dismiss",
        ),
      );
    }

    add(th.fg("accent", "─".repeat(renderWidth)));
    this.cachedLines = lines;
    return lines;
  }

  dispose(): void {
    this.settled = true;
  }
}
