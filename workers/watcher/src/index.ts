export default {
	async fetch(request, env) {
		return env.CACHE_CONTROLLER.fetch(request);
	},
} satisfies ExportedHandler<Env>;
