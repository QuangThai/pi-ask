/**
 * Terminal-safe text handling.
 *
 * Every string that reaches the TUI — whether it came from the model or from
 * the user's own free-text answer — goes through one of the helpers here.
 * Keeping a single scanner avoids the two slightly different control-character
 * strippers this file and `state.ts` used to carry independently.
 *
 * Newline policy is explicit per call site because the renderer treats it as a
 * hard contract: strings handed to `wrapTextWithAnsi()` may contain `\n`
 * (it splits them into separate physical lines), strings pushed as a single
 * rendered line may not.
 */

const ESCAPE = 27;
const BELL = 7;
const TAB = 9;
const LINE_FEED = 10;
const CARRIAGE_RETURN = 13;
const CSI_INTRODUCER = 91; // "["
const OSC_INTRODUCER = 93; // "]"

/** How a line break inside untrusted text should be represented. */
export type NewlineMode =
  /** Keep `\n` so the renderer can wrap it into several physical lines. */
  | "keep"
  /** Replace with a space — for text rendered as exactly one line. */
  | "space"
  /** Replace with a visible marker — for one-line previews of multi-line text. */
  | "marker";

/**
 * Strip terminal control characters and ANSI escape sequences from untrusted
 * text, rendering line breaks according to `newlines`.
 *
 * CSI (`ESC [ … final`) and OSC (`ESC ] … BEL | ESC \`) sequences are consumed
 * whole so their payload cannot leak into the output as visible garbage.
 */
export function sanitizeText(value: string, newlines: NewlineMode): string {
  let out = "";

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);

    if (code === ESCAPE) {
      const next = value.charCodeAt(index + 1);
      if (next === CSI_INTRODUCER) {
        index++;
        while (++index < value.length) {
          const csiCode = value.charCodeAt(index);
          if (csiCode >= 64 && csiCode <= 126) break;
        }
      } else if (next === OSC_INTRODUCER) {
        index += 2;
        while (index < value.length) {
          if (value.charCodeAt(index) === BELL) break;
          if (value.charCodeAt(index) === ESCAPE && value[index + 1] === "\\") {
            index++;
            break;
          }
          index++;
        }
      } else {
        index++;
      }
      continue;
    }

    if (code === CARRIAGE_RETURN) {
      if (value.charCodeAt(index + 1) === LINE_FEED) index++;
      out += renderNewline(newlines);
      continue;
    }
    if (code === LINE_FEED) {
      out += renderNewline(newlines);
      continue;
    }
    if (code === TAB) {
      out += "  ";
      continue;
    }
    if (isControlCharacter(code)) continue;

    out += value[index];
  }

  return out;
}

function renderNewline(mode: NewlineMode): string {
  switch (mode) {
    case "keep":
      return "\n";
    case "space":
      return " ";
    case "marker":
      return " ↵ ";
  }
}

function isControlCharacter(code: number): boolean {
  return code <= 31 || (code >= 127 && code <= 159);
}

/**
 * True when the string still contains a character the renderer cannot place on
 * a line. `\n` is allowed only where the caller wraps the text.
 */
export function hasUnsafeControlCharacters(
  value: string,
  { allowNewlines = false }: { allowNewlines?: boolean } = {},
): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (allowNewlines && code === LINE_FEED) continue;
    if (isControlCharacter(code)) return true;
  }
  return false;
}

/** Convert untrusted text into exactly one safe terminal display line. */
export function formatInlineText(value: string): string {
  return sanitizeText(value, "marker");
}

/** Sanitize text that is rendered as a single line (tab labels, option labels). */
export function toSingleLine(value: string): string {
  return sanitizeText(value, "space");
}

/** Sanitize text that the renderer wraps (question text, context, descriptions). */
export function toWrappedText(value: string): string {
  return sanitizeText(value, "keep");
}
