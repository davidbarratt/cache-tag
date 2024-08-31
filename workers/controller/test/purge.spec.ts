import { SELF, env } from "cloudflare:test";
import { it, expect, vi, afterEach } from "vitest";
import type Cloudflare from "cloudflare";

const verify = vi.fn<
  Parameters<typeof Cloudflare.prototype.user.tokens.verify>,
  ReturnType<typeof Cloudflare.prototype.user.tokens.verify>
>();

vi.mock("cloudflare", () => ({
  default: vi.fn().mockImplementation(() => ({
    user: {
      tokens: {
        verify,
      },
    },
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

it("adds cache tags to the purge queue", async () => {
  verify.mockResolvedValueOnce({ status: "active", id: "foo" });

  const sendSpy = vi
    .spyOn(env.CACHE_PURGE_TAG, "sendBatch")
    .mockResolvedValue();

  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/purge",
    {
      method: "POST",
      body: JSON.stringify({
        tags: ["test"],
      }),
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
        "CF-Worker": "example.com",
      },
    },
  );

  expect(response.status).toBe(202);

  expect(verify).toBeCalled();

  expect(sendSpy).toBeCalledWith([
    {
      body: {
        zone: "example.com",
        tag: "test",
      },
      contentType: "json",
    },
  ]);
});

it("adds cache tags to the purge queue with no zone", async () => {
  verify.mockResolvedValueOnce({ status: "active", id: "foo" });
  const sendSpy = vi
    .spyOn(env.CACHE_PURGE_TAG, "sendBatch")
    .mockResolvedValue();

  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/purge",
    {
      method: "POST",
      body: JSON.stringify({
        tags: ["test"],
      }),
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
      },
    },
  );

  expect(response.status).toBe(202);

  expect(verify).toBeCalled();

  expect(sendSpy).toBeCalledWith([
    {
      body: {
        tag: "test",
      },
      contentType: "json",
    },
  ]);
});

it("returns a 401 when the wrong API Token is provided", async () => {
  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/purge",
    {
      method: "POST",
      body: JSON.stringify({
        tags: ["test"],
      }),
      headers: {
        Authorization: `Bearer wrong`,
        "CF-Worker": "example.com",
      },
    },
  );

  expect(response.status).toBe(401);

  expect(verify).not.toBeCalled();
});

it("returns a 401 when the wrong API Token is expired", async () => {
  verify.mockResolvedValueOnce({ status: "expired", id: "foo" });

  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/purge",
    {
      method: "POST",
      body: JSON.stringify({
        tags: ["test"],
      }),
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
      },
    },
  );

  expect(response.status).toBe(401);

  expect(verify).toBeCalled();
});

it("returns a 400 when request is malformed", async () => {
  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/purge",
    {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com",
      }),
      headers: {
        Authorization: `Bearer ${env.API_TOKEN}`,
        "CF-Worker": "example.com",
      },
    },
  );

  expect(response.status).toBe(400);

  expect(verify).not.toBeCalled();
});
