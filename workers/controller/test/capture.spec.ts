import { SELF, env } from "cloudflare:test";
import { it, expect, vi } from "vitest";

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

it("returns a 401 when the wrong API Token is provided", async () => {
  const response = await SELF.fetch(
    "https://cache-tag.example.workers.dev/capture",
    {
      method: "POST",
      body: JSON.stringify({
        url: "https://example.com",
        tags: ["test"],
      }),
      headers: {
        Authorization: `Bearer wrong`,
        "CF-Worker": "example.com",
      },
    },
  );

  expect(response.status).toBe(401);
});

it("returns a 400 when the CF-Worker header is missing", async () => {
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
      },
    },
  );

  expect(response.status).toBe(400);
});
