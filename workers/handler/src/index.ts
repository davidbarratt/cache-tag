import Cloudflare from "cloudflare";
import { z } from "zod";

const CaptureSchema = z.object({
	url: z.string().url(),
	tags: z.array(z.string()),
});

/**
 * Creates a base64url encoded hash from any string.
 */
async function createHash(message: string) {
	const digest = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(message),
	);
	return btoa(String.fromCharCode(...new Uint8Array(digest)))
		.replace(/\//g, "_")
		.replace(/\+/g, "-")
		.replace(/=+$/, "");
}

async function cacheCapture(batch: MessageBatch, env: Env) {
	const dalete = env.DB.prepare("DELETE FROM tag WHERE url = ?");
	const insertUrl = env.DB.prepare(
		"INSERT OR IGNORE INTO url(id, value) VALUES(?, ?)",
	);
	const insertTag = env.DB.prepare("INSERT INTO tag(url, value) VALUES (?, ?)");

	for (const msg of batch.messages) {
		const { url, tags } = CaptureSchema.parse(msg.body);
		const hash = await createHash(url);

		const stmts: D1PreparedStatement[] = [];

		stmts.push(dalete.bind(hash));
		stmts.push(insertUrl.bind(hash, url));
		for (const tag of tags) {
			stmts.push(insertTag.bind(hash, tag));
		}

		await env.DB.batch(stmts);
	}
}

async function cachePurgeTag(batch: MessageBatch, env: Env) {
	const tags = batch.messages.map((msg) => z.string().parse(msg.body));
	const results = await env.DB.prepare(
		`SELECT DISTINCT id, value FROM url LEFT JOIN tag ON url.id = tag.url WHERE tag.value IN (${tags.map(() => "?").join(", ")}) ORDER BY url.value`,
	)
		.bind(tags)
		.raw<[string, string]>();

	const data = new Map<string, string>(results);

	const urls = Array.from(data.values());

	// Re-queue all of the tags as URLs.
	await env.CACHE_PURGE_URL.sendBatch(
		urls.map((url) => ({
			body: url,
			contentType: "text",
		})),
	);

	const ids = Array.from(data.keys());

	await env.DB.prepare(
		`DELETE FROM tag WHERE url IN (${ids.map(() => "?").join(", ")})`,
	)
		.bind(ids)
		.run();
}

async function cachePurgeUrl(batch: MessageBatch, env: Env) {
	const client = new Cloudflare({
		apiToken: env.API_TOKEN,
	});

	// Group by hostname.
	const grouped = batch.messages.reduce((acc, { body }) => {
		if (typeof body !== "string") {
			return acc;
		}

		const url = new URL(body);

		const sub = acc.get(url.hostname);
		if (sub) {
			sub.add(body);
		} else {
			acc.set(url.hostname, new Set([body]));
		}

		return acc;
	}, new Map<string, Set<string>>());

	/**
	 * @todo loop through the domains and find the nearest zone id.
	 */
	client.zones.list({
		name: "",
	});
}

/**
 * @todo We shouldk probably implement some sort of incremental back off maybe?
 * @todo Consume the `cache-tag-purge` and re-queue a `cache-tag-url`
 */
export default {
	async queue(batch, env) {
		switch (batch.queue) {
			case "cache-capture":
				return cacheCapture(batch, env);
			case "cache-purge-tag":
				return cachePurgeTag(batch, env);
			case "cache-purge-url":
				return cachePurgeUrl(batch, env);
		}
	},
} satisfies ExportedHandler<Env>;
