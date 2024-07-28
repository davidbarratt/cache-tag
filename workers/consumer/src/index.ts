import rawParams from "tracking-query-params-registry/_data/params.csv";

/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

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

		/**
		 * @todo Now that we have pushed to a queue, we should consume the values and save to D1.
		 */
		return response;
	},
} satisfies ExportedHandler<Env>;
