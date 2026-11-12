export type GraphQlEdge = {
  starredAt: string;
  node: {
    avatarUrl: string;
    login: string;
    name?: string;
  };
  cursor: string;
};

export const makeEdges = ({
  count,
  startIndex = 0,
  lastCursor,
}: {
  count: number;
  startIndex?: number;
  lastCursor?: string;
}): GraphQlEdge[] => {
  return Array.from({ length: count }, (_, offset) => {
    const index = startIndex + offset;
    const cursor =
      offset === count - 1 && lastCursor !== undefined
        ? lastCursor
        : `cursor-${index}`;
    return {
      starredAt: `2024-01-01T00:00:${String(index % 60).padStart(2, "0")}Z`,
      node: {
        avatarUrl: `https://example.com/avatar-${index}.png`,
        login: `user-${index}`,
        name: `User ${index}`,
      },
      cursor,
    };
  });
};

export const graphQlResponse = (edges: GraphQlEdge[]): Response =>
  new Response(
    JSON.stringify({ data: { repository: { stargazers: { edges } } } }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

export const rateLimitedResponse = (): Response =>
  new Response(
    JSON.stringify({
      errors: [{ type: "RATE_LIMITED", message: "rate limit exceeded" }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );

export const httpErrorResponse = (status: number, body: string): Response =>
  new Response(body, {
    status,
    statusText: status === 500 ? "Internal Server Error" : "Error",
    headers: { "Content-Type": "text/plain" },
  });

export const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => {
      values.clear();
    },
    getItem: (key) => (values.has(key) ? (values.get(key) as string) : null),
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
};

export const installLocalStorage = (
  storage: Storage = createMemoryStorage(),
): Storage => {
  (globalThis as { window?: { localStorage: Storage } }).window = {
    localStorage: storage,
  };
  return storage;
};

export type FetchCall = {
  body: string;
  init: RequestInit;
  url: string;
};

export type FetchHandler = (
  call: FetchCall,
  callIndex: number,
) => Promise<Response> | Response;

export const installFetch = (handler: FetchHandler): FetchCall[] => {
  const calls: FetchCall[] = [];

  const mockFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const requestInit = init ?? {};
    const call: FetchCall = {
      url,
      init: requestInit,
      body: typeof requestInit.body === "string" ? requestInit.body : "",
    };
    calls.push(call);
    return handler(call, calls.length - 1);
  };

  globalThis.fetch = mockFetch as typeof fetch;
  return calls;
};

export const parseQuery = (body: string): string => {
  const parsed = JSON.parse(body) as { query?: string };
  return parsed.query ?? "";
};

export const setGitHubToken = (token = "test-token"): void => {
  process.env.REMOTION_GITHUB_TOKEN = token;
};
