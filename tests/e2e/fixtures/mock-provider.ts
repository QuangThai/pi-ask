/**
 * Test-only pi extension: points pi at the local mock model server so the CLI
 * end-to-end test can script what the "model" says without a network call or
 * an API key.
 *
 * It is loaded with `-e` alongside the real extension; it is not part of the
 * published package.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  const baseUrl = process.env.PI_ASK_E2E_BASE_URL;
  if (!baseUrl) throw new Error("PI_ASK_E2E_BASE_URL is not set");

  pi.registerProvider("mock", {
    name: "Mock",
    baseUrl,
    apiKey: "mock-key",
    api: "openai-completions",
    models: [
      {
        id: "mock-model",
        name: "Mock Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 4_096,
      },
    ],
  });

  // The extension under test removes itself outside a TUI. To exercise the
  // rest of the tool pipeline (prepareArguments -> framework validation ->
  // execute) inside the real CLI, the test can put it back.
  if (process.env.PI_ASK_E2E_FORCE_TOOL === "1") {
    pi.on("session_start", () => {
      const active = pi.getActiveTools();
      if (!active.includes("ask_user_question")) {
        pi.setActiveTools([...active, "ask_user_question"]);
      }
    });
  }
}
