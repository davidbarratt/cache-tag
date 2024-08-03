import Cloudflare from "cloudflare";
import { z } from "zod";

const CaptureSchema = z.object({
	url: z.string().url(),
	tags: z.array(z.string()),
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
		"INSERT OR IGNORE INTO url(id, value) VALUES(?, ?)",
	);
	const insertTag = env.DB.prepare("INSERT INTO tag(url, value) VALUES (?, ?)");

	// Within the batch window, we may have recieved multiple URLs (from different locals) with different tags
	// Here we will attempt to merge the tags based on URL.
	const deduped = batch.messages.reduce<Map<string, Message[]>>((acc, msg) => {
		const { url } = CaptureSchema.parse(msg.body);
		const existing = acc.get(url);
		if (!existing) {
			return acc.set(url, [msg]);
		}

		existing.push(msg);

		return acc;
	}, new Map<string, Message[]>());

	for (const [url, msgs] of deduped) {
		const hash = await createHash(url);

		const stmts: D1PreparedStatement[] = [];

		stmts.push(deleteTags.bind(hash));
		stmts.push(insertUrl.bind(hash, url));

		const tags = msgs.reduce<Set<string>>((acc, msg) => {
			return CaptureSchema.parse(msg.body).tags.reduce<Set<string>>(
				(a, t) => a.add(t),
				acc,
			);
		}, new Set());

		for (const tag of tags) {
			stmts.push(insertTag.bind(hash, tag));
		}

		await env.DB.batch(stmts);

		for (const msg of msgs) {
			msg.ack();
		}
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
	// sendBatch only allows for a maximum of 100 messages.
	const promises: ReturnType<typeof env.CACHE_PURGE_URL.sendBatch>[] = [];
	for (const urlChunk of chunks(urls, 100)) {
		promises.push(
			env.CACHE_PURGE_URL.sendBatch(
				urlChunk.map((url) => ({
					body: url,
					contentType: "text",
				})),
			),
		);
	}

	await Promise.all(promises);

	const ids = Array.from(data.keys());

	await env.DB.prepare(
		`DELETE FROM tag WHERE url IN (${ids.map(() => "?").join(", ")})`,
	)
		.bind(ids)
		.run();
}

async function findZoneId(
	client: InstanceType<typeof Cloudflare>,
	hostname: string,
): Promise<string> {
	let zone_id: string | undefined;
	let name = hostname;
	while (!zone_id) {
		const { result } = await client.zones.list({
			name,
		});

		if (result.length < 1) {
			const parts = name.split(".").slice(1);
			if (parts.length < 2) {
				break;
			} else {
				name = parts.join(".");
				continue;
			}
		}

		zone_id = result[0].id;
	}

	if (!zone_id) {
		throw new Error(`Zone could not be found for ${hostname}`);
	}

	return zone_id;
}

async function cachePurgeUrl(batch: MessageBatch, env: Env) {
	const client = new Cloudflare({
		apiToken: env.API_TOKEN,
	});

	// Group by hostname which gets mapped to a zone.
	const hostnames = batch.messages.reduce<Set<string>>((acc, msg) => {
		if (typeof msg.body !== "string") {
			return acc;
		}

		const url = new URL(msg.body);

		return acc.add(url.hostname);
	}, new Set());

	const names = Array.from(hostnames);

	let promises: ReturnType<typeof findZoneId>[] = [];
	for (const name of names) {
		promises.push(findZoneId(client, name));
	}

	const zone_ids = await Promise.all(promises);

	const hostnameZone = new Map<string, string>();
	for (let i = 0; i < names.length; i++) {
		hostnameZone.set(names[i], zone_ids[i]);
	}

	const grouped = batch.messages.reduce<Map<string, Message[]>>((acc, msg) => {
		if (typeof msg.body !== "string") {
			return acc;
		}

		const url = new URL(msg.body);

		const zone_id = hostnameZone.get(url.hostname);

		if (!zone_id) {
			throw new Error(`Zone id for ${url.hostname} does not exist`);
		}

		const existing = acc.get(zone_id);
		if (!existing) {
			return acc.set(zone_id, [msg]);
		}

		existing.push(msg);

		return acc;
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
