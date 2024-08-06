import rawParams from "tracking-query-params-registry/_data/params.csv";

const params = new Set<string>(
	rawParams.split("\n").map((line) => {
		const end = line.indexOf(",");
		return line.substring(0, end).trim();
	}),
);

interface Capture {
	url: string;
	tags: string[];
}

function handlePurgeRequest(request: Request, env: Env) {
	return env.CACHE_CONTROLLER.fetch(new URL("/purge", request.url), request);
}

export default {
	async fetch(request, env) {
		// Remove any tracking params to increase the cache hit rate.
		const url = new URL(request.url);

		if (request.method === "POST" && url.pathname === "/.cloudflare/purge") {
			return handlePurgeRequest(request, env);
		}

		if (url.searchParams.size > 0) {
			for (const key of url.searchParams.keys()) {
				if (params.has(key)) {
					url.searchParams.delete(key);
				}
			}
		}

		const response = await fetch(url, request);

		if (response.headers.get("CF-Cache-Status") !== "MISS") {
			return response;
		}

		if (!response.headers.has("X-Cache-Tag")) {
			return response;
		}

		const rawTags = response.headers.get("X-Cache-Tag");

		if (!rawTags) {
			return response;
		}

		// A set here removes any duplicates.
		const tags = new Set<string>(rawTags.split(",").map((tag) => tag.trim()));

		const capture: Capture = {
			url: response.url,
			tags: Array.from(tags),
		};

		await env.CACHE_CONTROLLER.fetch(new URL("/capture", url), {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.API_TOKEN}`,
			},
			body: JSON.stringify(capture),
		});

		return response;
	},
} satisfies ExportedHandler<Env>;
