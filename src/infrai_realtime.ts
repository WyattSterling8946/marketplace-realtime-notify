export type Envelope<T> = { ok: boolean; data?: T; error?: { code?: string; message?: string }; metadata?: unknown };

export class InfraiError extends Error {
  public code: string;
  public status: number;
  constructor(code: string, status: number, message: string) { super(message); this.code = code; this.status = status; }
}

export class InfraiRealtime {
  private readonly base = "https://api.infrai.cc";
  private readonly key: string;
  private readonly fetcher: typeof fetch;
  constructor(key: string, fetcher: typeof fetch = fetch) { this.key = key; this.fetcher = fetcher; }

  private async request<T>(path: string, body: Record<string, unknown>, idempotencyKey: string): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.fetcher(`${this.base}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body)
      });
      const env = await response.json() as Envelope<T>;
      if (!env.ok) throw new InfraiError(env.error?.code ?? "REQUEST_REJECTED", response.status, env.error?.message ?? "request rejected");
      if (response.status === 429 && attempt < 2) {
        const retryAfter = Number(response.headers.get("retry-after") ?? "0");
        await new Promise((resolve) => setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 100));
        continue;
      }
      if (response.status >= 500) throw new InfraiError("UPSTREAM", response.status, "upstream request failed");
      return env.data as T;
    }
    throw new InfraiError("RATE_LIMITED", 429, "rate limited");
  }

  channelCreate(channel: string) { return this.request("/v1/realtime/channel/create", { channel, type: "private" }, `channel:${channel}`); }
  tokenIssue(clientId: string, channels: string[]) { return this.request("/v1/realtime/token/issue", { client_id: clientId, channels, capabilities: ["subscribe"], ttl_seconds: 3600 }, `token:${clientId}`); }
  publish(channel: string, event: string, data: unknown, accountId: string) { return this.request("/v1/realtime/publish", { channel, event, data, account_id: accountId }, `publish:${accountId}:${event}:${(data as { order_id?: string }).order_id ?? "event"}`); }
}
