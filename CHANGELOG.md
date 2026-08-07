# Changelog

All notable changes to this package are documented here.

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
