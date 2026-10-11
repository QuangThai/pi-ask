# Changelog

All notable changes to this package are documented here.

## [0.2.3] - 2026-10-11

### Fixed

- On a narrow terminal, a dialog row too wide to fit now ends in `…` instead of stopping mid-word with no sign it was cut: an option label (`> Both, with the re…`), the `Choose one — Space…` hint, the `Other — add your …` row, and the key hints on the question and review screens. Rows that fit are rendered exactly as before, and descriptions and question text still wrap. Display-only: the dialog, validation, result data, and model-facing output are unchanged.

### Changed

- Development dependencies moved to Pi 1.1.0 (`@earendil-works/pi-coding-agent`, `pi-tui`, `pi-ai`); peer dependencies stay `*`. The real-TUI test harness builds `TuiMainScreen`, since `TUI` is now an interface in pi-tui 1.1.0, and its recording terminal implements `setProgramStatus`.

### Added

- Tests for the ellipsis on a cut row at 20 columns and for rows that fit staying byte-identical.

## [0.2.2] - 2026-10-11

### Fixed

- The result transcript showed `question-1` and the option's derived value (`both-with-the-recommended-option-marked`) instead of the question and the label the user picked, and offered no expand hint, whenever the model left out the optional `id` and `value` fields. Pi hands `renderResult` the raw model arguments, while the answers carry the keys `prepareArguments()` derived; the transcript now derives them the same way. Display-only: the dialog, validation, result data, and model-facing output are unchanged.

### Added

- Regression coverage for a call whose questions and options carry no `id` or `value`.

## [0.2.1] - 2026-09-29

### Changed

- The result transcript shows each full question above its selected answer labels and full Other text, wrapping long content in the default view. Expansion still adds stable option values. This is display-only: questionnaire interaction, validation, result data, and model-facing output are unchanged.

### Added

- Regression coverage for full question/answer pairs, multi-select with Other text, narrow-width Unicode wrapping, sanitized terminal text, and legacy-call fallbacks.

## [0.2.0] - 2026-09-12

### Fixed

- **Multi-line `context`, `question` and option `description` no longer fail the tool call.** Every model-supplied string is now sanitized in `prepareArguments()` — escape sequences and control characters are stripped, line breaks are kept where the renderer wraps text and collapsed to spaces where a single line is rendered. Previously a newline anywhere (a very common shape for `context`) was rejected with `contains terminal control characters`, which contradicted the whole point of the `prepareArguments()` repair hook.
- **`Enter` on an option of an optional question selects that option.** It used to skip the question and silently discard the highlighted choice, while the same key on a multi-select optional question selected it — three different meanings for one key. Skipping is now an explicit "Skip this question" row, shown only when `required: false`, which also clears an earlier pick.
- **Headers are truncated by terminal columns, on grapheme boundaries.** `header` was sliced by UTF-16 code unit, which could emit a lone surrogate to the terminal and counted a 12-character CJK header as fitting a 12-column tab.
- **The model gets back the option `value` it supplied.** The result text is now keyed by question `id` and leads with the stable value (`persistence: details ("Tool result details")`). It previously returned only the human label, even though the tool description promises the value is returned.
- **`engines.node` now matches reality (`>=22.19.0`).** Pi itself requires that version, so the previous `>=20.6.0` floor described a runtime the extension cannot run in; CI tested Node 20 for the same reason.

### Added

- **Configured keybindings are honoured.** The questionnaire matches against the `KeybindingsManager` Pi injects (`tui.select.up`/`down`/`confirm`/`cancel`, `tui.input.submit`) instead of hardcoded keys, and the hint lines show the configured key.
- **Expandable result transcript.** The tool result shows one compact line per answer with the question header and human labels; expanding it (`app.tools.expand`, `Ctrl+O` by default) reveals the stable values and the full text of a long free-text answer.
- **More model mistakes are repaired instead of rejected:** more than four options are trimmed to the first four (recommended first), and duplicate question ids or option values are de-duplicated with a `-2` suffix.
- **End-to-end tests.** `tests/e2e/ask.e2e.test.ts` runs a complete tool call against a real `TUI`, the theme Pi ships, a real `KeybindingsManager` and real terminal byte sequences, with arguments validated by Pi's own `validateToolArguments`. `tests/e2e/cli.e2e.test.ts` spawns a real `pi` process against a local mock model server and asserts on the tool list Pi sends and the tool result it returns.
- Coverage thresholds (`npm run test:coverage`) and `CONTRIBUTING.md`.

### Changed

- The tool is removed from the model's tool list on `session_start` outside TUI mode, instead of being advertised and disabled after the first failed call.
- `renderResult()` builds its rows from `TruncatedText` inside a `Container` rather than a hand-rolled component, as the TUI docs recommend.
- One sanitizer (`src/text.ts`) replaces the two slightly different control-character strippers that lived in `text.ts` and `state.ts`.
- `tsconfig.json` enables `noUncheckedIndexedAccess`, `noImplicitOverride` and `verbatimModuleSyntax`; the unused `sanitizeHeaders()` export was removed.
- CI runs on Node 22 and 24, with a concurrency group, job timeouts, SHA-pinned actions, and the end-to-end suite.

## [0.1.15] - 2026-09-03

### Fixed

- Fixed crash `Rendered line exceeds terminal width` when rendering submitted answers with 2+ questions ([#1](https://github.com/QuangThai/pi-ask/issues/1)). `renderResult()` joined every answer with `\n` into a single array entry and ignored the `width` argument, while the host renderer treats each entry as exactly one physical terminal line. It now emits one entry per physical line (splitting embedded newlines) and truncates each with `truncateToWidth()` after measuring with `visibleWidth()`.
- Thanks to [@jamesdube](https://github.com/jamesdube) for the detailed report and fix ([#2](https://github.com/QuangThai/pi-ask/pull/2)).

### Tests

- Added regression coverage: 4 answers (one with a 200-char Other text) rendered at width 40 assert one entry per answer, no embedded newlines, and `visibleWidth(line) <= width`.

## [0.1.14] - 2026-08-13

### Reverted

- Restored the `0.1.12` questionnaire UI and behavior, including the original non-overlay editor-container presentation (`overlay: false`).
- Reverted the Pi development dependencies, documentation, and tests introduced in `0.1.13` so the shipped package otherwise matches `0.1.12`.

## [0.1.12] - 2026-08-09

### Changed

- **Pick & continue for single-choice questions** — `Space` (like `Enter`) now selects a single-choice option, confirms the tab, and advances to the next one in one press. No more select-then-confirm two-step on radio questions.
- **Other answers continue in one Enter** — pressing `Enter` in the inline editor now saves, confirms, and advances to the next tab immediately. The intermediate "saved but unconfirmed" preview step is gone; the saved text still shows on the question tab (when navigating back) and in the Review tab.
- Inline-editor and footer hints updated to the new flow: "Enter to save & continue", "Space/Enter choose & continue" (single-choice) vs "Space toggle • Enter confirm" (multi-select).
- Tool prompt guidelines document the auto-advance behavior.

### Fixed
- The "saved Other text" preview state no longer leaves the user stranded mid-flow with an extra confirm press.

### Tests
- Updated Other-editing tests to the single-Enter flow and added coverage for Space pick-and-go on single-select and Other-with-multi-select (selections kept, auto-advance).

## [0.1.11] - 2026-08-07

### Fixed
- Root-caused and fixed recurring `Validation failed for tool "ask_user_question" ... must have required properties value` errors. Pi's framework validates tool-call arguments against the TypeBox schema *before* the extension runs, and hard-rejects LLM calls that omit required fields; the raw error was fed back as a tool error result. The fix follows pi's official `prepareArguments` pattern.
- Registered a `prepareArguments(args)` hook (runs before schema validation) that repairs anything the model omitted or mangled: derives option `value` (slug of the label, de-duplicated), option `label` (value or `Option N`), question `id` (`question-N`), `question` text (from the header) and `header` (truncated); wraps a single question/option object into an array; drops `null`/non-object entries; normalizes string booleans (`"false"`, `"no"`, `"yes"`, …).
- Public schema now keeps `value`, `label`, `id`, and `header` required (`minLength: 1`) so the model-facing contract stays strict — `prepareArguments` fills them before validation, so required fields never reject real calls. Item counts (2–4 options, 1–4 questions) and field lengths are intentionally not enforced by the schema: over/under-sized payloads reach `validateQuestions()` and return a clean, actionable error instead of a raw framework exception.
- `execute()` no longer re-normalizes input that already passed through `prepareArguments` (`isNormalizedQuestions`), so a blank `question` surfaces as a clean error instead of being silently filled from a derived header.
- Tool description and prompt guidelines state the option shape explicitly: every option needs a `value` (stable key) and a `label` (shown text).

### Added
- `prepareArguments` hook for framework-level repair before validation.
- `normalizeQuestionArgs()`, `questionsToArray()`, `isNormalizedQuestions()`, `toBoolean()`, `deriveSlug()`, `uniqueString()` utilities.
- Regression tests: framework path (prepareArguments + strict schema) on the exact reported payload, single-object wrapping, null-entry dropping, string booleans, blank-question clean error, container hygiene, idempotence.

### Verified
- Edge-case matrix (35 malformed payloads) run through pi 0.84.0's real `validateToolArguments`: 0 framework throws (old pipeline threw on the first case); every fixable mistake is repaired, every unfixable one returns a clean error.

## [0.1.10] - 2026-07-30

### Fixed
- Long headers no longer cause a validation error; gracefully truncated to 12 chars for TUI tabs.
- TypeBox schema now accepts headers up to 128 chars (was 12) to prevent framework-level rejection.

### Added
- `sanitizeHeaders()` pre-processes input to truncate headers before validation.
- `truncateHeader()` utility for consistent header truncation.
- `HEADER_DISPLAY_MAX` constant (12) for centralised control.
- Prompt guideline reminding LLM to keep headers under 12 characters.

## [0.1.9] - 2026-07-20

### Fixed
- `multiSelect` is now optional in the TypeBox schema (`Type.Optional`) with `default: false`.
- Tool description updated to clarify that `multiSelect` defaults to `false`.
- Runtime validation now accepts an omitted `multiSelect` flag.
- `normalizeQuestions` coerces `undefined` → `false` for consistent downstream behavior.

## [0.1.3] - 2026-07-16

### Added
- Conditional follow-up questions via `showWhen: { questionId, equals }`.
- Hidden questions are omitted from tabs, Review, and submitted `answers`.
- Editing a parent answer clears and hides dependent children until rematched.

## [0.1.4] - 2026-07-16

### Changed
- Removed `[ ]` brackets and `✓`/`*` icons from options; use text color (success = selected) instead.
- Removed `■`/`□` icons and `✓` from tab bar and Submit; use text color only.
- Multi-select `Enter` now toggles the current option and confirms (no need for Space + Enter).

## [0.1.5] - 2026-07-16

### Fixed
- Removed stray `✓` icon from submit result output (`index.ts`).

## [0.1.6] - 2026-07-16

### Fixed
- Updated `assets/pi-ask-preview.png` and README transcript example to match 0.1.5 UI (no icons).

## [0.1.7] - 2026-07-16

### Fixed
- Enforce `showWhen` parent must appear before child in questions array; prevents navigation skipping hidden required follow-ups.

## [0.1.8] - 2026-07-16

### Changed
- Options marked `recommended: true` are always shown first (stable partition); indices stay consistent with submitted values.

## [0.1.2] - 2026-07-16

### Added
- Optional questions via `required: false`; users explicitly confirm a skip and omitted answers are not serialized.
- Clear transcript/result text when every optional question is skipped.

## [0.1.1] - 2026-07-16

### Fixed
- Preserve Other text when multi-select options are toggled afterward.
- Preserve selected values and Other text in the rendered result transcript.
- Make submit and abort completion mutually exclusive.
- Render multiline Other text safely in terminal previews and transcripts.

## [0.1.0] - 2026-07-16

### Fixed
- Review now displays both selected options and an Other answer for multi-select questions.

### Security
- Validate malformed tool payloads before they reach the TUI.
- Reject terminal control characters in model-provided question text.
- Bound and sanitize Other text before storing it in the result.

### Added
- CI verification on Node 20 and 22, including audit and package-install smoke checks.
