import { QueryResult, Stargazer } from "../cache";
import { fetchViaGraphQl } from "./via-graphql";

export async function fetchStargazers({
  repoOrg,
  repoName,
  starCount,
  abortSignal,
}: {
  repoOrg: string;
  repoName: string;
  starCount: number;
  abortSignal: AbortSignal;
}) {
  let allStargazers: Stargazer[] = [];

  console.log("Fetching stars...");
  let starsLeft = starCount;
  let cursor: string | null = null;
  let completedPages = 0;

  while (starsLeft > 0) {
    const count = Math.min(starsLeft, 100);

    let result: QueryResult;
    try {
      result = await fetchViaGraphQl({
        repoOrg,
        repoName,
        count,
        cursor,
        abortSignal,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const error = new Error(
        `Failed to fetch stargazers for ${repoOrg}/${repoName} after ${completedPages} completed page(s): ${message}`,
      );
      if (err instanceof Error && err.name === "AbortError") {
        error.name = "AbortError";
      }
      throw error;
    }

    const { cursor: newCursor, results } = result;
    allStargazers = [...allStargazers, ...results];
    completedPages += 1;
    console.log(`Fetched ${allStargazers.length} stars`);

    // Stop if the page is empty or shorter than requested: there is nothing
    // more to page through.
    if (results.length === 0 || results.length < count) {
      break;
    }

    // Stop if the cursor did not advance (including a missing next cursor).
    // Without this check, a stuck cursor would loop forever.
    if (newCursor === null || newCursor === cursor) {
      break;
    }

    cursor = newCursor;
    starsLeft -= results.length;
  }

  // Never return more stargazers than requested.
  return allStargazers.slice(0, starCount);
}
