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

export default {
	/**
	 * @todo We need to accept the `/.cloudflare/purge` route and handle that.
	 */
	async fetch(request, env) {
		// Remove any tracking params to increase the cache hit rate.
		const url = new URL(request.url);
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

		await env.CACHE_CAPTURE.send(capture, { contentType: "json" });

		return response;
	},
} satisfies ExportedHandler<Env>;
