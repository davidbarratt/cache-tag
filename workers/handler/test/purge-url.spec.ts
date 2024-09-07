import { randomBytes } from "node:crypto";
import { SELF } from "cloudflare:test";
import { it, expect, vi, afterEach } from "vitest";
import type Cloudflare from "cloudflare";

const zoneList = vi.fn<
  Parameters<typeof Cloudflare.prototype.zones.list>,
  Promise<{ result: { id: string }[] }>
>();

const cachePurge = vi.fn<
  Parameters<typeof Cloudflare.prototype.cache.purge>,
  Promise<void>
>();

interface CacheUrlPurge {
  url: string;
  zone: string;
}

vi.mock("cloudflare", () => ({
  default: vi.fn().mockImplementation(() => ({
    zones: {
      list: zoneList,
    },
    cache: {
      purge: cachePurge,
    },
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
});

it("purges a URL", async () => {
  const url = "https://example.com";
  const zone = "example.com";
  const id = "test";

  zoneList.mockResolvedValueOnce({
    result: [{ id }],
  });
  cachePurge.mockResolvedValueOnce();

  const messages: ServiceBindingQueueMessage<CacheUrlPurge>[] = [
    {
      id: randomBytes(16).toString("hex"),
      timestamp: new Date(1000),
      attempts: 1,
      body: { url, zone },
    },
  ];

  const { outcome } = await SELF.queue("cache-purge-url", messages);
  expect(outcome).toBe("ok");

  expect(zoneList).toBeCalledWith({ name: zone });
  expect(cachePurge).toBeCalledWith({ zone_id: id, files: [url] });
});
