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
