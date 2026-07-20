# Changelog

All notable changes to this package are documented here.

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
