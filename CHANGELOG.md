# Changelog

All notable changes to this package are documented here.

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
