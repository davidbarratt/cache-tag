import { randomBytes } from "node:crypto";
import { env, SELF } from "cloudflare:test";
import { it, expect, vi } from "vitest";

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
// const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

interface CacheTagPurge {
  tag: string;
  zone?: string;
}

it("requeues purged tags as urls", async () => {
  const sendBatch = vi
    .spyOn(env.CACHE_PURGE_URL, "sendBatch")
    .mockResolvedValue();
  const id = "test";
  const url = "https://example.com";
  const zone = "example.com";
  const tag = "example";

  await env.DB.batch([
    env.DB.prepare("DELETE FROM tag WHERE url = ?").bind(url),
    env.DB.prepare(
      "INSERT OR REPLACE INTO url(id, zone, value) VALUES(?, ?, ?)",
    ).bind(id, zone, url),
    env.DB.prepare("INSERT INTO tag(url, value) VALUES (?, ?)").bind(id, tag),
  ]);

  const { results: initResults } = await env.DB.prepare(
    "SELECT tag.value AS tag, url.zone AS zone FROM tag JOIN url ON tag.url = url.id WHERE url.value = ?",
  )
    .bind(url)
    .run();
  expect(initResults.length).toBe(1);

  const messages: ServiceBindingQueueMessage<CacheTagPurge>[] = [
    {
      id: randomBytes(16).toString("hex"),
      timestamp: new Date(1000),
      attempts: 1,
      body: { tag, zone },
    },
  ];

  const { outcome } = await SELF.queue("cache-purge-tag", messages);
  expect(outcome).toBe("ok");

  expect(sendBatch).toBeCalledWith([
    {
      body: {
        url,
        zone,
      },
      contentType: "json",
    },
  ]);

  const { results } = await env.DB.prepare(
    "SELECT tag.value AS tag, url.zone AS zone FROM tag JOIN url ON tag.url = url.id WHERE url.value = ?",
  )
    .bind(url)
    .run();
  expect(results.length).toBe(0);
});

it("passes when no URLs are found", async () => {
  const sendBatch = vi
    .spyOn(env.CACHE_PURGE_URL, "sendBatch")
    .mockResolvedValue();
  const url = "https://example.com";
  const zone = "example.com";
  const tag = "example";

  const { results: initResults } = await env.DB.prepare(
    "SELECT tag.value AS tag, url.zone AS zone FROM tag JOIN url ON tag.url = url.id WHERE url.value = ?",
  )
    .bind(url)
    .run();
  expect(initResults.length).toBe(0);

  const messages: ServiceBindingQueueMessage<CacheTagPurge>[] = [
    {
      id: randomBytes(16).toString("hex"),
      timestamp: new Date(1000),
      attempts: 1,
      body: { tag, zone },
    },
  ];

  const { outcome } = await SELF.queue("cache-purge-tag", messages);
  expect(outcome).toBe("ok");

  expect(sendBatch).not.toBeCalled();

  const { results } = await env.DB.prepare(
    "SELECT tag.value AS tag, url.zone AS zone FROM tag JOIN url ON tag.url = url.id WHERE url.value = ?",
  )
    .bind(url)
    .run();
  expect(results.length).toBe(0);
});
