/**
 * A minimal OpenAI-compatible chat-completions server.
 *
 * pi talks to `openai-completions` providers with the official OpenAI SDK and
 * `stream: true`, so the responses here are server-sent events in the same
 * shape a real provider returns. Every request body is recorded so the test
 * can assert on what pi actually sent — which tools were offered, and what the
 * tool result looked like on the next turn.
 */
import { createServer, type Server } from "node:http";

export interface ScriptedToolCall {
  name: string;
  /** Raw JSON string, so a deliberately malformed payload can be scripted. */
  argumentsJson: string;
}

export type ScriptedResponse =
  | { type: "tool_call"; call: ScriptedToolCall }
  | { type: "text"; text: string };

export interface MockModelServer {
  url: string;
  requests: Record<string, unknown>[];
  close(): Promise<void>;
}

function chunk(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify({
    id: "chatcmpl-mock",
    object: "chat.completion.chunk",
    created: 1,
    model: "mock-model",
    ...payload,
  })}\n\n`;
}

function streamFor(response: ScriptedResponse): string {
  const opening = chunk({
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  const body =
    response.type === "text"
      ? chunk({
          choices: [
            {
              index: 0,
              delta: { content: response.text },
              finish_reason: null,
            },
          ],
        })
      : chunk({
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_mock_1",
                    type: "function",
                    function: {
                      name: response.call.name,
                      arguments: response.call.argumentsJson,
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        });

  const closing = chunk({
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: response.type === "text" ? "stop" : "tool_calls",
      },
    ],
  });

  const usage = chunk({
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

  return `${opening}${body}${closing}${usage}data: [DONE]\n\n`;
}

export async function startMockModelServer(
  script: ScriptedResponse[],
): Promise<MockModelServer> {
  const requests: Record<string, unknown>[] = [];
  const queue = [...script];

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (part: Buffer) => chunks.push(part));
    request.on("end", () => {
      if (!request.url?.includes("/chat/completions")) {
        response.writeHead(404).end();
        return;
      }
      try {
        requests.push(
          JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
        );
      } catch {
        requests.push({ unparseable: true });
      }

      const next = queue.shift() ?? { type: "text" as const, text: "done" };
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      response.end(streamFor(next));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock model server did not bind a port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
