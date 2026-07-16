# Changelog

All notable changes to this package are documented here.

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

## [Unreleased]

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
