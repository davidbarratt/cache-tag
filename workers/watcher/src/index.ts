import rawParams from "tracking-query-params-registry/_data/params.csv";
import { z } from "zod";

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

const Verify = z.object({
	result: z.object({
		status: z.enum(["active", "disabled", "expired"]),
	}),
});

export default {
	/**
	 * @todo We need to accept the `/.cloudflare/purge` route and handle that.
	 */
	async fetch(request, env) {
		// Remove any tracking params to increase the cache hit rate.
		const url = new URL(request.url);

		// Handle Purge Requests.
		if (request.method === "POST" && url.pathname === "/.cloudflare/purge") {
			const auth = request.headers.get("Authorization");
			if (!auth) {
				return Response.json(
					{
						error: "Missing Authorization header",
					},
					{ status: 401 },
				);
			}
			const [scheme, token] = auth.split(" ");
			if (scheme !== "Bearer") {
				return Response.json(
					{
						error: "Authorization scheme is not Bearer",
					},
					{ status: 401 },
				);
			}

			// Needs at least `Cache Purge:Purge, Zone:Read" permissions.
			if (token !== env.API_TOKEN) {
				return Response.json(
					{
						error: "Provided token does not match the `API_TOKEN` secret.",
					},
					{ status: 401 },
				);
			}

			const response = await fetch(
				"https://api.cloudflare.com/client/v4/user/tokens/verify",
				{
					headers: {
						Authoriztion: `Bearer ${env.API_TOKEN}`,
					},
				},
			);

			const { result } = Verify.parse(await response.json());

			if (result.status !== "active") {
				return Response.json(
					{
						error: "Authentication token is not active.",
					},
					{ status: 401 },
				);
			}
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

		await env.CACHE_CAPTURE.send(capture, { contentType: "json" });

		return response;
	},
} satisfies ExportedHandler<Env>;
