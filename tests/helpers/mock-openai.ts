import http from 'node:http';

export type MockAction =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; args: unknown };
export type MockScript = (req: { messages: Array<Record<string, unknown>>; tools?: unknown }) => MockAction[];

/** 本地 OpenAI 兼容 mock 端点（127.0.0.1，e2e 专用；不依赖真实 API key——既定模式）。 */
export class MockOpenai {
  readonly requests: { messages: Array<Record<string, unknown>>; tools?: unknown[] }[] = [];
  private readonly server: http.Server;
  private port = 0;
  constructor(private readonly script: MockScript) {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: string) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body) as { messages: Array<Record<string, unknown>>; tools?: unknown[] };
        this.requests.push({ messages: parsed.messages, tools: parsed.tools });
        const actions = this.script({ messages: parsed.messages, tools: parsed.tools });
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const sse = (obj: unknown) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
        for (const a of actions) {
          if (a.type === 'text') {
            const half = Math.ceil(a.text.length / 2);
            for (const piece of [a.text.slice(0, half), a.text.slice(half)]) {
              if (piece) sse({ id: 'cmpl', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: piece } }] });
            }
          } else {
            sse({ id: 'cmpl', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: a.name, arguments: JSON.stringify(a.args) } }] } }] });
          }
        }
        sse({ id: 'cmpl', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: actions.some((a) => a.type === 'tool') ? 'tool_calls' : 'stop' }] });
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
  }
  get url(): string { return `http://127.0.0.1:${this.port}/v1`; }
  lastRequest() { return this.requests[this.requests.length - 1]; }
  async start(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    this.port = (this.server.address() as { port: number }).port;
    return this.url;
  }
  async close(): Promise<void> { await new Promise<void>((r) => this.server.close(() => r())); }
}
