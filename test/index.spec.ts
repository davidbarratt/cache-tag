import { SELF, env, fetchMock } from "cloudflare:test";
import { beforeAll, afterEach, it, expect, vi } from "vitest";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
// const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

beforeAll(() => {
	fetchMock.activate();
});
afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

it("adds cache tags to the capture queue", async () => {
	const sendSpy = vi.spyOn(env.CACHE_CAPTURE, "send").mockResolvedValue();

	fetchMock
		.get("https://example.com")
		.intercept({ path: "/" })
		.reply(200, "", {
			headers: {
				"CF-Cache-Status": "MISS",
				"X-Cache-Tag": "test",
			},
		});

	await SELF.fetch("https://example.com");

	expect(sendSpy).toBeCalledWith(
		{
			url: "", // I hate that this is empty, but I don't see a good way to mock it.
			tags: ["test"],
		},
		{ contentType: "json" },
	);
});
