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

it("forwards every request to the controller", async () => {
	const sendSpy = vi
		.spyOn(env.CACHE_CONTROLLER, "fetch")
		.mockResolvedValue(new Response());

	await SELF.fetch("https://example.com");

	expect(sendSpy).toBeCalled();
});
