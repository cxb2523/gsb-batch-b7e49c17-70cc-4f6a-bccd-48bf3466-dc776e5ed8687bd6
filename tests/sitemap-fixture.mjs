// Synthetic fetch double for the sitemap job lifecycle. It covers only /v1/sitemap* routes and
// never touches the network or real credentials: every response is constructed locally, including
// the 409 partial_state envelope and the inlined status URL list.
//
// Routing:
//   POST /v1/sitemap                       submit (quote)
//   POST /v1/sitemap/:id/approve           approve; job "partial" answers 409 partial_state,
//                                          job "broken" answers 500, anything else succeeds
//   GET  /v1/sitemap/:id                   status; job "warm" inlines a URL list, "detail"
//                                          reports pending/processed counts
//   GET  /v1/sitemap/:id/urls              paginated results; echoes limit/offset back
//   DELETE /v1/sitemap/:id                 cancel
//   GET  /v1/sitemap                       list; echoes limit/offset back
//
// Paging arguments are re-validated here as well: the production code must reject illegal
// limit/offset before fetch runs, so a request that reaches this double with an illegal page
// fails the test loudly instead of being silently answered.

const RESULTS_LIMIT_MAX = 5000;
const LIST_LIMIT_MAX = 100;

function jsonResponse(body, init = {}) {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { "content-type": "application/json", ...(init.headers ?? {}) },
	});
}

function assertLegalPaging(url, maxLimit) {
	for (const [name, raw] of url.searchParams) {
		if (name !== "limit" && name !== "offset") continue;
		const value = Number(raw);
		if (!Number.isFinite(value) || !Number.isInteger(value)) {
			throw new Error(`fixture received non-integer paging value ${name}=${raw}`);
		}
		if (name === "limit" && (value < 1 || value > maxLimit)) {
			throw new Error(`fixture received out-of-range limit=${value} (max ${maxLimit})`);
		}
		if (name === "offset" && value < 0) {
			throw new Error(`fixture received negative offset=${value}`);
		}
	}
}

globalThis.fetch = async (input, options = {}) => {
	const url = new URL(input);
	if (!url.pathname.startsWith("/v1/sitemap")) {
		throw new Error(`Unexpected request to ${url.pathname}`);
	}
	const method = options.method ?? "GET";

	// Collection routes: POST submit, GET list.
	if (url.pathname === "/v1/sitemap") {
		if (method === "POST") {
			const body = JSON.parse(options.body);
			return jsonResponse({
				jobId: "job-submit",
				status: "awaiting_approval",
				estimatedCostUsd: "0.0042",
				estimatedPages: body.maxPages ?? 10,
			});
		}
		assertLegalPaging(url, LIST_LIMIT_MAX);
		return jsonResponse({
			jobs: [
				{ jobId: "job-a", status: "completed" },
				{ jobId: "job-b", status: "running" },
			],
			echo: { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") },
		});
	}

	const match = url.pathname.match(/^\/v1\/sitemap\/([^/]+)(\/approve|\/urls)?$/);
	if (!match) throw new Error(`Unmatched sitemap route ${url.pathname}`);
	const jobId = decodeURIComponent(match[1]);
	const sub = match[2] ?? "";

	if (sub === "/approve") {
		if (jobId === "partial") {
			return jsonResponse(
				{ status: "partial_state", message: "previous approval was interrupted" },
				{ status: 409, statusText: "Conflict" },
			);
		}
		if (jobId === "broken") {
			return jsonResponse({ error: "approve failed upstream" }, { status: 500, statusText: "Internal Server Error" });
		}
		return jsonResponse({ jobId, status: "running" });
	}

	if (sub === "/urls") {
		assertLegalPaging(url, RESULTS_LIMIT_MAX);
		const limit = Number(url.searchParams.get("limit") ?? "1000");
		const offset = Number(url.searchParams.get("offset") ?? "0");
		const urls = Array.from({ length: Math.min(limit, 2) }, (_, index) => ({
			url: `https://example.com/page-${offset + index}`,
			statusCode: 200,
			depth: 1,
			isSitemap: false,
			parentUrl: "https://example.com/",
			sourceType: "link",
		}));
		return jsonResponse({
			jobId,
			total: 7,
			urls,
			echo: { limit: url.searchParams.get("limit"), offset: url.searchParams.get("offset") },
		});
	}

	if (method === "DELETE") {
		return jsonResponse({ jobId, status: "canceled" });
	}

	// Status route.
	if (jobId === "partial") {
		return jsonResponse(
			{ status: "partial_state", message: "previous approval was interrupted" },
			{ status: 409, statusText: "Conflict" },
		);
	}
	if (jobId === "warm") {
		return jsonResponse({
			jobId,
			status: "completed",
			estimatedCostUsd: "0.0090",
			urls: Array.from({ length: 3 }, (_, index) => ({
				url: `https://example.com/warm-${index}`,
				statusCode: 200,
				depth: 0,
				isSitemap: false,
				parentUrl: null,
				sourceType: "seed",
			})),
		});
	}
	return jsonResponse({
		jobId,
		status: "running",
		pending: 4,
		processed: 6,
	});
};
