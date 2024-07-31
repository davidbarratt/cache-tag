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

/**
 * @todo We shouldk probably implement some sort of incremental back off maybe?
 * @todo We should start working on the PURGE
 */
async function cacheCapture(batch: MessageBatch, env: Env) {
	const dalete = env.DB.prepare("DELETE FROM tag WHERE url = ?");
	const insertUrl = env.DB.prepare(
		"INSERT OR IGNORE INTO url(id, url) VALUES(?, ?)",
	);
	const insertTag = env.DB.prepare("INSERT INTO tag(url, tag) VALUES (?, ?)");

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

export default {
	async queue(batch, env) {
		switch (batch.queue) {
			case "cache-capture":
				return cacheCapture(batch, env);
		}
	},
} satisfies ExportedHandler<Env>;
