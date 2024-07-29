async function cacheCapture(batch: MessageBatch, env: Env) {
	for (const msg of batch.messages) {
		console.log(msg.body);
	}
}

export default {
	/**
	 * @todo Now that we have pushed to a queue, we should consume the values and save to D1.
	 */
	async queue(batch, env) {
		switch (batch.queue) {
			case "cache-capture":
				return cacheCapture(batch, env);
		}
	},
} satisfies ExportedHandler<Env>;
