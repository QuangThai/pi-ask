/**
 * End-to-end through the real pi CLI.
 *
 * A child `pi` process loads the extension from source the way a user's
 * install does (jiti, `pi.extensions`), talks to a local mock model server,
 * and runs a scripted tool call. Nothing here is stubbed inside pi: the system
 * prompt, the tool list sent to the provider, `prepareArguments`, the
 * framework's schema validation and the tool result all come from the real
 * binary.
 *
 * Run with `npm run e2e`; it is excluded from the default unit-test run
 * because it spawns a process per case.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ScriptedResponse,
  startMockModelServer,
} from "./mock-model-server.js";

/**
 * The pinned devDependency by default. Set `PI_ASK_E2E_CLI` to the `cli.js` of
 * another pi installation to run the same checks against the version you
 * actually use.
 */
const CLI =
  process.env.PI_ASK_E2E_CLI ??
  join(
    process.cwd(),
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "cli.js",
  );

/** A payload shaped like a real (sloppy) model call: no option values, a
 * string boolean, multi-line context, five options, an over-long header. */
const SLOPPY_TOOL_ARGUMENTS = JSON.stringify({
  questions: [
    {
      id: "persistence",
      header: "Persistence strategy for answers",
      question: "How should session state be persisted?",
      context: "Constraints:\n- survives /tree and /fork\n- no extra files",
      multiSelect: "false",
      options: [
        { label: "Tool result details", recommended: "yes" },
        { label: "Local file", description: "On disk\nnext to the session" },
        { label: "Environment variable" },
        { label: "SQLite" },
        { label: "Redis" },
      ],
    },
  ],
});

interface CliRun {
  stdout: string;
  stderr: string;
  code: number | null;
}

function runPi(args: string[], env: NodeJS.ProcessEnv): Promise<CliRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      // Print mode drains stdin when it is not a TTY, so give it EOF at once.
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env, PI_OFFLINE: "1", NO_COLOR: "1" },
      cwd: process.cwd(),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (part: Buffer) => {
      stdout += part.toString("utf8");
    });
    child.stderr.on("data", (part: Buffer) => {
      stderr += part.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

const BASE_ARGS = [
  "--print",
  "--provider",
  "mock",
  "--model",
  "mock-model",
  "--api-key",
  "mock-key",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-context-files",
  "--no-approve",
  "--no-builtin-tools",
  "-e",
  "./src/index.ts",
  "-e",
  "./tests/e2e/fixtures/mock-provider.ts",
];

function toolNames(request: Record<string, unknown>): string[] {
  const tools = request.tools;
  if (!Array.isArray(tools)) return [];
  return tools.map((tool) => {
    const fn = (tool as { function?: { name?: unknown } }).function;
    return typeof fn?.name === "string" ? fn.name : "";
  });
}

describe("e2e: the real pi CLI", () => {
  it("has a built CLI to run", () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it("loads the extension and hides the tool in print mode", {
    timeout: 120_000,
  }, async () => {
    const script: ScriptedResponse[] = [{ type: "text", text: "understood" }];
    const server = await startMockModelServer(script);
    try {
      const run = await runPi([...BASE_ARGS, "say hi"], {
        PI_ASK_E2E_BASE_URL: server.url,
      });

      expect(run.stderr).not.toMatch(/extension .* error/i);
      expect(run.code).toBe(0);
      expect(run.stdout).toContain("understood");

      // The extension dropped itself on session_start, so the model is never
      // offered a tool it cannot run.
      expect(server.requests).toHaveLength(1);
      expect(toolNames(server.requests[0] ?? {})).not.toContain(
        "ask_user_question",
      );
    } finally {
      await server.close();
    }
  });

  it("runs a sloppy tool call through prepareArguments and schema validation", {
    timeout: 120_000,
  }, async () => {
    const script: ScriptedResponse[] = [
      {
        type: "tool_call",
        call: {
          name: "ask_user_question",
          argumentsJson: SLOPPY_TOOL_ARGUMENTS,
        },
      },
      { type: "text", text: "noted" },
    ];
    const server = await startMockModelServer(script);
    try {
      const run = await runPi([...BASE_ARGS, "ask me something"], {
        PI_ASK_E2E_BASE_URL: server.url,
        PI_ASK_E2E_FORCE_TOOL: "1",
      });

      expect(run.code).toBe(0);
      expect(server.requests.length).toBeGreaterThanOrEqual(2);

      // The tool was offered with the schema the extension registered.
      expect(toolNames(server.requests[0] ?? {})).toContain(
        "ask_user_question",
      );

      // The payload the model sent is missing option values, uses a string
      // boolean and five options. prepareArguments must repair it before the
      // framework validates, so this must never appear:
      const transcript = JSON.stringify(server.requests);
      expect(transcript).not.toContain("Validation failed for tool");
      expect(run.stderr).not.toContain("Validation failed for tool");

      // The tool result that came back is the extension's own explanation,
      // not a framework error — and the tool is disabled from here on.
      expect(transcript).toContain("requires interactive UI");
      expect(run.stdout).toContain("noted");
    } finally {
      await server.close();
    }
  });
});
