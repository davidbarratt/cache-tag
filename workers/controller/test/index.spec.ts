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

  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/capture",
    {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        tags: ["test"],
      }),
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
        "CF-Worker": "example.com",
      },
    },
  );

  expect(response.status).toBe(202);

  expect(sendSpy).toBeCalledWith(
    {
      url: "https://example.com",
      zone: "example.com",
      tags: ["test"],
    },
    { contentType: "json" },
  );
});

it("passes when CF-Cache-Status is something other than MISS", async () => {
  const sendSpy = vi.spyOn(env.CACHE_CAPTURE, "send").mockResolvedValue();

  fetchMock
    .get("https://example.com")
    .intercept({ path: "/" })
    .reply(200, "", {
      headers: {
        "CF-Cache-Status": "DYNAMIC",
        "X-Cache-Tag": "test",
      },
    });

  await SELF.fetch("https://example.com");

  expect(sendSpy).not.toBeCalled();
});

it("passes when X-Cache-Tag is not set", async () => {
  const sendSpy = vi.spyOn(env.CACHE_CAPTURE, "send").mockResolvedValue();

  fetchMock
    .get("https://example.com")
    .intercept({ path: "/" })
    .reply(200, "", {
      headers: {
        "CF-Cache-Status": "DYNAMIC",
      },
    });

  await SELF.fetch("https://example.com");

  expect(sendSpy).not.toBeCalled();
});

it("passes when X-Cache-Tag is empty", async () => {
  const sendSpy = vi.spyOn(env.CACHE_CAPTURE, "send").mockResolvedValue();

  fetchMock
    .get("https://example.com")
    .intercept({ path: "/" })
    .reply(200, "", {
      headers: {
        "CF-Cache-Status": "DYNAMIC",
        "X-Cache-Tag": "",
      },
    });

  await SELF.fetch("https://example.com");

  expect(sendSpy).not.toBeCalled();
});
