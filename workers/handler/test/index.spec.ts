import { randomBytes } from "node:crypto";
import { env, SELF } from "cloudflare:test";
import { it, expect } from "vitest";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
// const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

interface CacheCapture {
	url: string;
	tags: string[];
}

it("adds cache tags to database", async () => {
	const messages: ServiceBindingQueueMessage<CacheCapture>[] = [
		{
			id: randomBytes(16).toString("hex"),
			timestamp: new Date(1000),
			attempts: 1,
			body: { url: "https://example.com", tags: ["example"] },
		},
	];

	const { outcome } = await SELF.queue("cache-capture", messages);
	expect(outcome).toBe("ok");

	const { results: tags } = await env.DB.prepare(
		"SELECT tag.value AS tag FROM tag JOIN url ON tag.url = url.id WHERE url.value = ?",
	)
		.bind("https://example.com")
		.run();
	expect(tags[0].tag).toBe("example");
});
