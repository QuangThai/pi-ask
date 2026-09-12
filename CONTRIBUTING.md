# Contributing

Thanks for helping improve `pi-ask`.

## Getting set up

```bash
npm install
npm run check      # typecheck + lint + unit and integration tests
npm run e2e        # end-to-end through the real pi CLI (spawns a process)
npm run check:all  # both of the above
```

**Prerequisites:** Node.js `>=22.19.0` — the same floor Pi itself requires,
since the extension runs inside Pi's runtime.

## How the tests are layered

| Suite | What it proves |
|-------|----------------|
| `tests/state.test.ts` | reducer invariants: selection, confirm, conditional visibility, result shape |
| `tests/schema` coverage in `tests/tool.test.ts` | what the tool accepts, repairs, and rejects |
| `tests/component.test.ts` | keyboard flows and rendering of the questionnaire |
| `tests/regressions.test.ts` | behaviours that were wrong once and must not come back |
| `tests/e2e/ask.e2e.test.ts` | a whole tool call against a **real** `TUI`, a real `Theme`, real keybindings, and Pi's own `validateToolArguments` |
| `tests/e2e/cli.e2e.test.ts` | a **real `pi` process** loading the extension and running a scripted tool call against a local mock model server |

The end-to-end suites are the ones that catch integration breakage: they fail
if a rendered line exceeds the terminal width, if the registered schema stops
matching what the model sends, or if the extension stops loading in the CLI.
When you change rendering, key handling, or the schema, run them.

`tests/e2e/tui-harness.ts` mounts a component the same way Pi's interactive
mode does in `showExtensionCustom()`. If Pi changes that lifecycle, update the
harness to match rather than working around it.

## Before opening a pull request

- `npm run check:all` passes.
- New behaviour has a test; fixed behaviour has a regression test.
- Anything user-visible is reflected in `README.md` and `CHANGELOG.md`
  (under `Unreleased`).

## Releasing

1. Move the `Unreleased` section of `CHANGELOG.md` under the new version.
2. Bump `version` in `package.json`.
3. `npm run check:all`
4. `npm publish` (the package is published as `@nguyenquangthai/pi-ask`).
5. Tag `vX.Y.Z` and push the tag.
