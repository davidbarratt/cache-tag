# Cache Tag

[Cloudflare](https://www.cloudflare.com/) has the ability to index cached resources by _tag_ which allows those resources
be [purged by tag](https://developers.cloudflare.com/cache/how-to/purge-cache/purge-by-tags/). However, this feature is
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

### [Watcher](./workers/watcher/)

This worker watches requests to the Cloudflare [Cache](https://developers.cloudflare.com/cache/) / Origin, captures the
tags, and sends them to the [Controller](./workers/controller/) in order to be persisted.

> [!IMPORTANT]
> By the time a response from an origin reaches a [Worker](https://developers.cloudflare.com/workers/), Cloudflare
> has already swallowed the `Cache-Tag` header and it is no longer available. To get around this, the worker reads the
> custom `X-Cache-Tag` header instead.

The worker also exposes a `/.cloudflare/purge` endpoint that allows tags to be purged. This endpoint matches the
[interface of the Cloudflare endpoint](https://developers.cloudflare.com/api/operations/zone-purge#purge-cached-content-by-tag-host-or-prefix),
but only allows `tags`. The tags that are purged will be scoped
to the [zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones) in which the request is
made too. For example, a purge request to `https://example.com/.cloudflare/purge` would only purge resources from the
`example.com` [zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones).

### [Controller](./workers/controller/)

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

The [Controller](./workers/controller/) exists primarily as an intermediary between [Watcher](./workers/watcher/) and
[Handler](./workers/handler/) to collect
[zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones) information. It is **not**
included as a part of [Handler](./workers/handler/) in order to ensure that the
[worker](https://developers.cloudflare.com/workers/) is collocated in the
[same data center](https://developers.cloudflare.com/workers/configuration/smart-placement/) as
[Watcher](./workers/watcher/).

The [worker](https://developers.cloudflare.com/workers/) also exposes a `/purge` endpoint that allows tags to be purged.
This endpoint matches the
[interface of the Cloudflare endpoint](https://developers.cloudflare.com/api/operations/zone-purge#purge-cached-content-by-tag-host-or-prefix), but only allows `tags`. If no
[zone](https://developers.cloudflare.com/fundamentals/setup/accounts-and-zones/#zones) information is provided (via the
[CF-Worker](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/#cf-worker) header), matching
resources from **all** zones will be purged.

After receiving and validating requests to either the `/capture` or `/purge` endpoints, the
[worker](https://developers.cloudflare.com/workers/) adds the requests to the `cache-capture` and `cache-purge-tag`
queues respectively.

### [Handler](./workers/handler/)

This [worker](https://developers.cloudflare.com/workers/) listens to all three queues and handles them.

When a message is received from [Controller](./workers/controller/) in the `cache-capture` queue; the URL, zone, and
tags are stored in the [D1](https://developers.cloudflare.com/d1/) database.

A message received from [Controller](./workers/controller/) in the `cache-purge-tag` queue results in the URLs being
looked up in the [D1](https://developers.cloudflare.com/d1/) database from the provided tag, and re-queing those URLs by
adding each one to the `cache-purge-url` queue. Since this will result in the resource being eventually removed from the
cache, the URL and all tags associated with it are removed from the [D1](https://developers.cloudflare.com/d1/)
database.

Finally, when a message is received from the `cache-purge-url` queue, the URLs are
[purged with Cloudflare's API](https://developers.cloudflare.com/api/operations/zone-purge#purge-cached-content-by-url).

## Usage

I am not aware of a good way to distribute this application for use on your own other than forking it and modifying it.
It is [licensed under the AGPL-3.0 license](./LICENSE.md) so you are free to modify it under the terms of that license.
I thought about using [Terraform](https://www.terraform.io/) in order to make it easier for others to deploy on their
own, but it seemed like overkill for my purposes. I'm happy to accept PRs that make life easier.

## Authentication

I chose to use the `API_TOKEN` [secret](https://developers.cloudflare.com/workers/configuration/secrets/) for
authentication/authorization to the [Controller](./workers/controller/) and to use the same token to make requests to
the [Cloudflare API](https://developers.cloudflare.com/api/). This simplified the approach by only having to have a
single secret in the worker and sharing that secret with the Origin server. This allows the origin to make requests to
the [Cloudflare API](https://developers.cloudflare.com/api/) or the
[Worker](https://developers.cloudflare.com/workers/) seamlessly.

The minimum [API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) permissions needed
are:

- [Zone Read](https://developers.cloudflare.com/fundamentals/api/reference/permissions/#:~:text=zone%20level%20settings.-,Zone%20Read,-Grants%20read%20access)
- [Cache Purge](https://developers.cloudflare.com/fundamentals/api/reference/permissions/#:~:text=Management%20feedback.-,Cache%20Purge,-Grants%20access%20to)
