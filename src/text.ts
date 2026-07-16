function isTerminalControlCharacter(code: number): boolean {
  return code <= 31 || (code >= 127 && code <= 159);
}

/** Converts untrusted text into one safe terminal display line. */
export function formatInlineText(value: string): string {
  let formatted = "";

  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code === 27) {
      const next = value.charCodeAt(index + 1);
      if (next === 91) {
        index++;
        while (++index < value.length) {
          const csiCode = value.charCodeAt(index);
          if (csiCode >= 64 && csiCode <= 126) break;
        }
      } else if (next === 93) {
        index += 2;
        while (index < value.length) {
          if (value.charCodeAt(index) === 7) break;
          if (value.charCodeAt(index) === 27 && value[index + 1] === "\\") {
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
    if (code === 13) {
      if (value.charCodeAt(index + 1) === 10) index++;
      formatted += " ↵ ";
      continue;
    }
    if (code === 10) {
      formatted += " ↵ ";
      continue;
    }
    if (code === 9) {
      formatted += "  ";
      continue;
    }
    if (!isTerminalControlCharacter(code)) formatted += value[index];
  }

  return formatted;
}
