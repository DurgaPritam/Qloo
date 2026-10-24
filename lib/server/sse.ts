import "server-only";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/**
 * A text/event-stream body fed by `produce`. Each `send` writes one `data:` line of JSON.
 * Writes after the client disconnects are ignored.
 */
export function sseStream(produce: (send: (data: unknown) => void) => Promise<void>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          open = false;
        }
      };
      // Flush headers straight away so proxies start streaming.
      controller.enqueue(encoder.encode(": stream open\n\n"));
      try {
        await produce(send);
      } finally {
        if (open) controller.close();
      }
    },
  });
}
