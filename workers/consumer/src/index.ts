import { z } from "zod";

const CaptureSchema = z.object({
	url: z.string().url(),
	tags: z.array(z.string()),
});

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
 * @todo Now that we have the values and the schema, the next step is to follow
 * {@link https://github.com/cloudflare/workers-sdk/tree/main/fixtures/vitest-pool-workers-examples/d1 the example}
 * and write a test that test that this actually works.
 */
async function cacheCapture(batch: MessageBatch, env: Env) {
	for (const msg of batch.messages) {
		const { url, tags } = CaptureSchema.parse(msg.body);
		console.log("HASH", await createHash(url));
		console.log("URL", url);
		console.log("TAGS", tags);
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
