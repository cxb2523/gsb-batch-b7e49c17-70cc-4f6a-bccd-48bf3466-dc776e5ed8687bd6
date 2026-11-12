// Changes only the query string. Next syncs useSearchParams with history.pushState, so the feed
// refetches /api/jobs without a navigation: router.push would also send the server a page request
// on every filter change and page turn, which the client-side feed never needs.
export const pushQuery = (query: string) => {
  window.history.pushState(null, "", query);
  // router.push scrolled to the top on a new page of results; pushState doesn't.
  window.scrollTo(0, 0);
};
