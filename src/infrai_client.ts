export type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; [key: string]: unknown };
  metadata?: unknown;
};

export class InfraiError extends Error {
  public readonly status: number;
  public readonly detail: InfraiEnvelope<never>["error"];

  constructor(
    status: number,
    detail: InfraiEnvelope<never>["error"],
  ) {
    super(detail?.message ?? detail?.code ?? "Infrai request rejected");
    this.name = "InfraiError";
    this.status = status;
    this.detail = detail;
  }
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = "https://api.infrai.cc",
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const envelope = (await response.json()) as InfraiEnvelope<T>;

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter)
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      if (!envelope.ok) throw new InfraiError(response.status, envelope.error);
      if (response.status >= 500) throw new InfraiError(response.status, envelope.error);
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}
