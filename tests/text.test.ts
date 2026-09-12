import { describe, expect, it } from "vitest";
import {
  formatInlineText,
  hasUnsafeControlCharacters,
  sanitizeText,
  toSingleLine,
  toWrappedText,
} from "../src/text.js";

const ESC = "\u001b";

describe("sanitizeText", () => {
  it("removes CSI sequences whole", () => {
    expect(sanitizeText(`${ESC}[31mred${ESC}[0m`, "space")).toBe("red");
    expect(sanitizeText(`${ESC}[1;2;38;5;200mstyled`, "space")).toBe("styled");
  });

  it("removes OSC sequences terminated by BEL or ST", () => {
    expect(sanitizeText(`${ESC}]0;window title\u0007after`, "space")).toBe(
      "after",
    );
    expect(
      sanitizeText(`${ESC}]8;;https://example.com${ESC}\\link`, "space"),
    ).toBe("link");
  });

  it("drops a lone escape and its next byte", () => {
    expect(sanitizeText(`${ESC}Xvisible`, "space")).toBe("visible");
  });

  it("renders line breaks according to the mode", () => {
    expect(sanitizeText("a\r\nb", "keep")).toBe("a\nb");
    expect(sanitizeText("a\r\nb", "space")).toBe("a b");
    expect(sanitizeText("a\r\nb", "marker")).toBe("a ↵ b");
    expect(sanitizeText("a\rb", "space")).toBe("a b");
  });

  it("expands tabs and drops other control characters", () => {
    expect(sanitizeText("a\tb", "space")).toBe("a  b");
    expect(sanitizeText("a\u0000\u009bb", "space")).toBe("ab");
  });

  it("keeps ordinary unicode intact", () => {
    expect(sanitizeText("日本語 🚀 café", "space")).toBe("日本語 🚀 café");
  });
});

describe("helpers", () => {
  it("formatInlineText marks line breaks", () => {
    expect(formatInlineText("one\ntwo")).toBe("one ↵ two");
  });

  it("toSingleLine and toWrappedText differ only in line handling", () => {
    expect(toSingleLine("one\ntwo")).toBe("one two");
    expect(toWrappedText("one\ntwo")).toBe("one\ntwo");
  });

  it("hasUnsafeControlCharacters respects the newline allowance", () => {
    expect(hasUnsafeControlCharacters("plain")).toBe(false);
    expect(hasUnsafeControlCharacters("a\nb")).toBe(true);
    expect(hasUnsafeControlCharacters("a\nb", { allowNewlines: true })).toBe(
      false,
    );
    expect(
      hasUnsafeControlCharacters(`a${ESC}b`, { allowNewlines: true }),
    ).toBe(true);
  });
});
