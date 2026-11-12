export type QueryResult = {
  cursor: string | null;
  results: Stargazer[];
};

export type Stargazer = {
  avatarUrl: string;
  name: string;
  date: string;
  login: string;
};

const makeKey = ({
  count,
  cursor,
  repoName,
  repoOrg,
}: {
  repoOrg: string;
  repoName: string;
  count: number;
  cursor: string | null;
}) => {
  return ["__stargazer", repoOrg, repoName, count, cursor].join("-");
};

export const saveResult = ({
  count,
  cursor,
  repoName,
  repoOrg,
  result,
}: {
  repoOrg: string;
  repoName: string;
  count: number;
  cursor: string | null;
  result: QueryResult;
}) => {
  try {
    const key = makeKey({ count, cursor, repoName, repoOrg });
    window.localStorage.setItem(key, JSON.stringify(result));
  } catch (err) {
    // If quota is exceeded, don't cache
    if (!(err as Error).message.toLowerCase().includes("quota")) {
      throw err;
    }
  }
};

export const getFromCache = ({
  count,
  cursor,
  repoName,
  repoOrg,
}: {
  repoOrg: string;
  repoName: string;
  count: number;
  cursor: string | null;
}): QueryResult | null => {
  const key = makeKey({ count, cursor, repoName, repoOrg });
  let value: string | null;
  try {
    value = window.localStorage.getItem(key);
  } catch {
    // Accessing localStorage can throw (for example when storage is
    // disabled). Treat that the same as a cache miss so the caller refetches.
    return null;
  }
  if (!value) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    // Corrupted cache entries must not break rendering.
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("cursor" in parsed) ||
    !("results" in parsed) ||
    !Array.isArray((parsed as { results: unknown }).results)
  ) {
    return null;
  }

  const cursorValue = (parsed as { cursor: unknown }).cursor;
  if (cursorValue !== null && typeof cursorValue !== "string") {
    return null;
  }

  return parsed as QueryResult;
};
