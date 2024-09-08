# Cache Tag

[Cloudflare](https://www.cloudflare.com/) has the ability to index cached resources by _tag_ which allows those resources be
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

This worker watches requests to the Cloudflare [Cache](https://developers.cloudflare.com/cache/) / Origin, captures the
tags, and sends them to the [Controller](./workers/controller/) in order to be persisted.

> [!IMPORTANT]
> By the time a response from an origin reaches a [Worker](https://developers.cloudflare.com/workers/), Cloudflare
> has already swallowed the `Cache-Tag` header and it is no longer available. To get around this, the worker reads the
> custom `X-Cache-Tag` header instead.

The worker also exposes a `/.cloudflare/purge` endpoint that allows tags to be purged. This endpoint matches the
[interface of the Cloudflare endpoint](https://developers.cloudflare.com/api/operations/zone-purge#purge-cached-content-by-tag-host-or-prefix), but only allows `tags`. The tags that are purged will be scoped
to the [zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones) in which the request is
made too. For example, a purge request to `https://example.com/.cloudflare/purge` would only purge resources from the
`example.com` [zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones).

#### [Controller](./workers/controller/)

A [Worker](https://developers.cloudflare.com/workers/) is an
[account-level resource](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#accounts), but
[Cache](https://developers.cloudflare.com/cache/) is a
[zone-level resource](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones). Because of this,
there is no way to know what zone a resource is being cached in from a
[Worker](https://developers.cloudflare.com/workers/).

To mitigate this problem, we can leverage the
[CF-Worker](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/#cf-worker) header which gets
added to outbound requests from a [Worker](https://developers.cloudflare.com/workers/). Unfortunately, this header does
not exist when using
[Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/). The only way to
retrieve the header is by making a request to the [worker](https://developers.cloudflare.com/workers/) on the provided
[workers.dev subdomain](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/).

The [Controller](./workers/controller/) exists primarily as an intermediary between [Watcher](./workers/watcher/) and [Handler](./workers/handler/) to collect [zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones)
information. It is **not** included as a part of [Handler](./workers/handler/) in order to ensure that the
[worker](https://developers.cloudflare.com/workers/) is collocated in the
[same data center](https://developers.cloudflare.com/workers/configuration/smart-placement/) as
[Watcher](./workers/watcher/).

The [worker](https://developers.cloudflare.com/workers/) also exposes a `/purge` endpoint that allows tags to be purged. This endpoint matches the
[interface of the Cloudflare endpoint](https://developers.cloudflare.com/api/operations/zone-purge#purge-cached-content-by-tag-host-or-prefix), but only allows `tags`. If no
[zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones) information is provided
(via the [CF-Worker](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/#cf-worker) header),
matching resources from **all** zones will be purged.

#### [Handler](./workers/handler/)

_@todo_
