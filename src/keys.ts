import {
  getKeybindings,
  type Keybinding,
  type KeybindingsManager,
  type KeyId,
} from "@earendil-works/pi-tui";

/**
 * Keyboard hints are rendered from the user's configured keybindings rather
 * than hardcoded, so a remapped `tui.select.confirm` or `app.tools.expand`
 * shows the key that actually works.
 */
const KEY_LABELS: Record<string, string> = {
  enter: "Enter",
  return: "Enter",
  escape: "Esc",
  esc: "Esc",
  space: "Space",
  tab: "Tab",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  pageup: "PgUp",
  pagedown: "PgDn",
};

export function formatKeyLabel(key: KeyId): string {
  return key
    .split("+")
    .map(
      (part) =>
        KEY_LABELS[part.toLowerCase()] ??
        part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("+");
}

/**
 * Label for a binding using the manager the host injected into the component
 * factory, falling back to the documented default when there is none (direct
 * construction in tests).
 */
export function keyLabelFor(
  manager: KeybindingsManager | undefined,
  binding: Keybinding,
  fallback: KeyId,
): string {
  return formatKeyLabel(manager?.getKeys(binding)?.[0] ?? fallback);
}

/**
 * Label for an app-level binding outside a component factory (tool result
 * rendering). Pi installs its own manager as the pi-tui global during
 * interactive startup; elsewhere the default manager has no app bindings and
 * the fallback is used.
 */
export function globalKeyLabel(binding: Keybinding, fallback: KeyId): string {
  return formatKeyLabel(getKeybindings().getKeys(binding)?.[0] ?? fallback);
}
