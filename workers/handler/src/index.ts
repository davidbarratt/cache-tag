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
		"INSERT OR REPLACE INTO url(id, zone, value) VALUES(?, ?, ?)",
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
	const zoneMsgs = batch.messages.reduce<Map<string | undefined, Message[]>>(
		(acc, msg) => {
			const { zone } = PurgeTagSchema.parse(msg.body);
			const existing = acc.get(zone);
			if (!existing) {
				return acc.set(zone, [msg]);
			}

			existing.push(msg);

			return acc;
		},
		new Map(),
	);

	for (const [zone, msgs] of zoneMsgs) {
		const tags = msgs.map<string>((msg) => PurgeTagSchema.parse(msg.body).tag);

		let query: D1PreparedStatement;
		if (zone) {
			query = env.DB.prepare(
				`SELECT DISTINCT url.id AS id, url.zone AS zone, url.value AS value FROM url LEFT JOIN tag ON url.id = tag.url WHERE tag.value IN (${tags.map(() => "?").join(", ")})`,
			).bind(...tags);
		} else {
			query = env.DB.prepare(
				`SELECT DISTINCT url.id AS id, url.zone AS zone, url.value AS value FROM url LEFT JOIN tag ON url.id = tag.url WHERE url.zone = ? tag.value IN (${tags.map(() => "?").join(", ")})`,
			).bind(zone, ...tags);
		}

		const { results } = await query.run<{
			id: string;
			zone: string;
			value: string;
		}>();

		// Re-queue all of the tags as URLs.
		// sendBatch only allows for a maximum of 100 messages.
		const promises: ReturnType<typeof env.CACHE_PURGE_URL.sendBatch>[] = [];
		for (const urlChunk of chunks(results, 100)) {
			promises.push(
				env.CACHE_PURGE_URL.sendBatch(
					urlChunk.map<MessageSendRequest<z.infer<typeof PurgeUrlSchema>>>(
						(data) => ({
							body: {
								url: data.value,
								zone: data.zone,
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
			.bind(...ids)
			.run();

		for (const msg of msgs) {
			msg.ack();
		}
	}
}

async function cachePurgeUrl(batch: MessageBatch, env: Env) {
	const client = new Cloudflare({
		apiToken: env.API_TOKEN,
	});

	// Group by Zone.
	const zoneMsgs = batch.messages.reduce<Map<string, Message[]>>((acc, msg) => {
		const { zone } = PurgeUrlSchema.parse(msg.body);

		const existing = acc.get(zone);
		if (!existing) {
			return acc.set(zone, [msg]);
		}

		existing.push(msg);

		return acc;
	}, new Map());

	for (const [name, msgs] of zoneMsgs) {
		let result: Awaited<ReturnType<typeof client.zones.list>>["result"];
		try {
			({ result } = await client.zones.list({ name }));
		} catch (cause) {
			console.error("[Cache Purge URL] Zone ID could not be retrieved", cause);
			for (const msg of msgs) {
				msg.retry({ delaySeconds: calculateExponentialBackoff(msg.attempts) });
			}
			continue;
		}

		const zone = result[0];
		if (typeof zone === "undefined") {
			const error = new Error(
				`[Cache Purge URL] Zone ID for ${name} was not found`,
			);
			console.error(error);
			for (const msg of msgs) {
				msg.retry({ delaySeconds: calculateExponentialBackoff(msg.attempts) });
			}
			continue;
		}

		const files = msgs.map<string>((msg) => PurgeUrlSchema.parse(msg.body).url);

		try {
			await client.cache.purge({
				zone_id: zone.id,
				files,
			});
		} catch (cause) {
			console.error("[Cache Purge URL] Zone ID could not be retrieved", cause);
			for (const msg of msgs) {
				msg.retry({ delaySeconds: calculateExponentialBackoff(msg.attempts) });
			}
			continue;
		}

		for (const msg of msgs) {
			msg.ack();
		}
	}
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
