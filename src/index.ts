/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export default {
	async fetch(request) {
		const response = await fetch(request);

		/**
		 * @todo When there is a cache MISS *and* the response has tags, push an insert into the queue.
		 */
		console.log("URL", response.url);
		console.log("CACHE", response.headers.get("CF-Cache-Status"));

		return response;
	},
} satisfies ExportedHandler<Env>;
