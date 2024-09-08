# Cache Tag

Cloudflare has the ability to index cached resources by _tag_ which allows those resources be
[purged by tag](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/). However, this feature is
[only available for Enterprise customers](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/#:~:text=Note%20that%20Tag%2C%20Hostname%20and%20Prefix%20purges%20are%20only%20available%20for%20Enterprise%20customers.).

Despite this limitation, an index can be built using [Workers](https://developers.cloudflare.com/workers/),
[D1](https://developers.cloudflare.com/d1/), and [Queues](https://developers.cloudflare.com/queues/).

## Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./cache-tag-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./cache-tag-light.svg">
  <img alt="Architecture Diagram" src="./cache-tag-light.svg">
</picture>

This application is broken up into three [Workers](https://developers.cloudflare.com/workers/), three
[Queues](https://developers.cloudflare.com/queues/), and one [D1](https://developers.cloudflare.com/d1/) database.

### Workers

#### [Watcher](./workers/watcher/)

This worker watches requests to the Cloudflare Cache / Origin, captures the tags, and sends them to the
[Controller](./workers/controller/) in order to be persisted.

> [!IMPORTANT]
> By the time a response from an origin reaches a [Worker](https://developers.cloudflare.com/workers/), Cloudflare
> has already swallowed the `Cache-Tag` header and it is not longer available. To get around this, the worker reads the
> custom `X-Cache-Tag` header instead.

The worker also exposes a `/.cloudflare/purge` endpoint that allows tags to be purged. This endpoint matches the
[interface of the Cloudflare endpoint](https://developers.cloudflare.com/api/operations/zone-purge#purge-cached-content-by-tag-host-or-prefix), but only allows `tags`. The tags that are purged will be scoped
to the zone in which the request is made too. For example, a purge request to `https://example.com/.cloudflare/purge`
would only purge resources from the `example.com` zone.

- [Watcher](./workers/watcher/)
- [Controller](./workers/controller/)
- [Handler](./workers/handler/)
