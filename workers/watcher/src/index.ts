import rawParams from "tracking-query-params-registry/_data/params.csv";

const params = new Set<string>(
  rawParams.split("\n").map((line) => {
    const end = line.indexOf(",");
    return line.substring(0, end).trim();
  }),
);

interface CaptureBody {
  url: string;
  tags: string[];
}

export default {
  async fetch(request, env) {
    // Remove any tracking params to increase the cache hit rate.
    const url = new URL(request.url);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { cf, ...init } = request;

    if (request.method === "POST" && url.pathname === "/.cloudflare/purge") {
      return fetch(new URL("/purge", env.CACHE_CONTROLLER), init);
    }

    if (url.searchParams.size > 0) {
      for (const key of url.searchParams.keys()) {
        if (params.has(key)) {
          url.searchParams.delete(key);
        }
      }
    }

    const response = await fetch(url, init);

    // Only a `CF-Cache-STatus` of `MISS` or `EXPIRED` indicates that the resource was served by the Origin and
    // is was cached.
    // @see https://developers.cloudflare.com/cache/concepts/cache-responses/
    const cacheStatus = response.headers.get("CF-Cache-Status");
    if (cacheStatus !== "MISS" && cacheStatus !== "EXPIRED") {
      return response;
    }

    if (!response.headers.has("X-Cache-Tag")) {
      return response;
    }

    const rawTags = response.headers.get("X-Cache-Tag");

    if (!rawTags) {
      return response;
    }

    // A set here removes any duplicates.
    const tags = new Set<string>(rawTags.split(",").map((tag) => tag.trim()));

    const capture: CaptureBody = {
      url: response.url,
      tags: Array.from(tags),
    };

    const captureResponse = await fetch(
      new URL("/capture", env.CACHE_CONTROLLER),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.API_TOKEN}`,
        },
        body: JSON.stringify(capture),
      },
    );

    if (captureResponse.status !== 202) {
      console.error(
        "Capture Request was not accepted.",
        await captureResponse.text(),
      );
    }

    return response;
  },
} satisfies ExportedHandler<Env>;
