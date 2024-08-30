import { SELF, fetchMock } from "cloudflare:test";
import { beforeAll, afterEach, it, expect } from "vitest";

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
  // Mock the first request to `https://example.com`
  fetchMock
    .get("https://example.com")
    .intercept({ path: "/" })
    .reply(200, "body");

  const response = await SELF.fetch("https://example.com");

  expect(await response.text()).toBe("body");
});
