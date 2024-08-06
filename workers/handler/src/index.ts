import Cloudflare from "cloudflare";
import { z } from "zod";

const CaptureSchema = z.object({
	url: z.string().url(),
	tags: z.array(z.string()),
	zone: z.string(),
});

const PurgeUrlSchema = z.object({
	url: z.string().url(),
	zone: z.string(),
});

const PurgeTagSchema = z.object({
	tag: z.string(),
	zone: z.optional(z.string()),
});

function* chunks<T>(arr: T[], n: number) {
	for (let i = 0; i < arr.length; i += n) {
		yield arr.slice(i, i + n);
	}
}

function calculateExponentialBackoff(attempts: number) {
	return 15 ** attempts;
}

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
	const deleteTags = env.DB.prepare("DELETE FROM tag WHERE url = ?");
	const insertUrl = env.DB.prepare(
		"INSERT OR REAPLACE INTO url(id, zone, value) VALUES(?, ?, ?)",
	);
	const insertTag = env.DB.prepare("INSERT INTO tag(url, value) VALUES (?, ?)");

	for (const msg of batch.messages) {
		const { url, zone, tags } = CaptureSchema.parse(msg.body);
		const hash = await createHash(url);

		const stmts: D1PreparedStatement[] = [];

		stmts.push(deleteTags.bind(hash));
		stmts.push(insertUrl.bind(hash, zone, url));

		for (const tag of tags) {
			stmts.push(insertTag.bind(hash, tag));
		}

		await env.DB.batch(stmts);

		msg.ack();
	}
}

async function cachePurgeTag(batch: MessageBatch, env: Env) {
	/**
	 * @todo We need to execute this on a per-zone level if there is a zone, if there is no zone then the query should
	 *       get all the URLs across zones.
	 */
	const tags = batch.messages.map((msg) => PurgeTagSchema.parse(msg.body).tag);
	const { results } = await env.DB.prepare(
		`SELECT DISTINCT url.id AS id, url.zone AS zone, url.value AS value FROM url LEFT JOIN tag ON url.id = tag.url WHERE tag.value IN (${tags.map(() => "?").join(", ")}) ORDER BY url.value`,
	)
		.bind(tags)
		.run<{ id: string; zone: string; value: string }>();

	// Re-queue all of the tags as URLs.
	// sendBatch only allows for a maximum of 100 messages.
	const promises: ReturnType<typeof env.CACHE_PURGE_URL.sendBatch>[] = [];
	for (const urlChunk of chunks(results, 100)) {
		promises.push(
			env.CACHE_PURGE_URL.sendBatch(
				urlChunk.map<MessageSendRequest<z.infer<typeof PurgeUrlSchema>>>(
					({ value: url, zone }) => ({
						body: {
							url,
							zone,
						},
						contentType: "json",
					}),
				),
			),
		);
	}

	await Promise.all(promises);

	const ids = results.map<string>(({ id }) => id);

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

	// Group by Zone.
	const groupedZoneName = batch.messages.reduce<Map<string, Message[]>>(
		(acc, msg) => {
			const { zone } = PurgeUrlSchema.parse(msg.body);

			const existing = acc.get(zone);
			if (!existing) {
				return acc.set(zone, [msg]);
			}

			existing.push(msg);

			return acc;
		},
		new Map(),
	);

	const zone_names = Array.from(groupedZoneName.keys());

	const zone_ids = await Promise.all(
		zone_names.map<Promise<string>>(async (name) => {
			const { result } = await client.zones.list({ name });
			const zone = result[0];
			if (typeof zone === "undefined") {
				throw new Error(`Zone ID for ${name} was not found`);
			}

			return zone.id;
		}),
	);

	// Re-index the messages by zone_id
	const grouped = zone_names.reduce<Map<string, Message[]>>((acc, name, i) => {
		const msgs = groupedZoneName.get(name);
		if (!msgs) {
			throw new Error("Messages no longer exist");
		}
		const zone_id = zone_ids[i];
		if (zone_id) {
			throw new Error("Zone ID no longer exists");
		}

		return acc.set(zone_id, msgs);
	}, new Map());
	/**
	 * @todo Now that we have them grouped by Zone ID, we can purge!
	 */
}

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
