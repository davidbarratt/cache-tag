import Cloudflare from "cloudflare";
import { WorkerEntrypoint } from "cloudflare:workers";
import { z } from "zod";

interface CaptureBody {
	url: string;
	tags: string[];
	zone: string;
}

const Purge = z.object({
	tags: z.array(z.string()),
});

const Capture = z.object({
	url: z.string().url(),
	tags: z.array(z.string()),
});

function* chunks<T>(arr: T[], n: number) {
	for (let i = 0; i < arr.length; i += n) {
		yield arr.slice(i, i + n);
	}
}

interface PurgeBody {
	tag: string;
	zone?: string | undefined;
}

async function handlePurgeRequest(request: Request, env: Env) {
	const auth = request.headers.get("Authorization");
	if (!auth) {
		return Response.json(
			{
				error: "Missing Authorization header",
			},
			{ status: 401 },
		);
	}
	const [scheme, token] = auth.split(" ");
	if (scheme !== "Bearer") {
		return Response.json(
			{
				error: "Authorization scheme is not Bearer",
			},
			{ status: 401 },
		);
	}

	// Needs at least `Cache Purge:Purge, Zone:Read" permissions.
	if (token !== env.API_TOKEN) {
		return Response.json(
			{
				error: "Provided token does not match the `API_TOKEN` secret.",
			},
			{ status: 401 },
		);
	}

	const client = new Cloudflare({
		apiToken: env.API_TOKEN,
	});

	const { status } = await client.user.tokens.verify();

	if (status !== "active") {
		return Response.json(
			{
				error: "Authentication token is not active.",
			},
			{ status: 401 },
		);
	}

	const { tags } = Purge.parse(await request.json());

	const zone = request.headers.get("CF-Worker") ?? undefined;

	const messages = tags.map<MessageSendRequest<PurgeBody>>((tag) => ({
		body: {
			tag,
			zone,
		},
		contentType: "json",
	}));

	// sendBatch only allows for a maximum of 100 messages.
	const promises: ReturnType<typeof env.CACHE_PURGE_TAG.sendBatch>[] = [];
	for (const messageChunks of chunks(messages, 100)) {
		promises.push(env.CACHE_PURGE_TAG.sendBatch(messageChunks));
	}

	await Promise.all(promises);

	return new Response("", { status: 202 });
}

async function handleCaptureRequest(request: Request, env: Env) {
	const zone = request.headers.get("CF-Worker");
	if (!zone) {
		return Response.json(
			{
				error: "Missing CF-Worker header",
			},
			{ status: 400 },
		);
	}

	const auth = request.headers.get("Authorization");
	if (!auth) {
		return Response.json(
			{
				error: "Missing Authorization header",
			},
			{ status: 401 },
		);
	}
	const [scheme, token] = auth.split(" ");
	if (scheme !== "Bearer") {
		return Response.json(
			{
				error: "Authorization scheme is not Bearer",
			},
			{ status: 401 },
		);
	}

	// Needs at least `Cache Purge:Purge, Zone:Read" permissions.
	if (token !== env.API_TOKEN) {
		return Response.json(
			{
				error: "Provided token does not match the `API_TOKEN` secret.",
			},
			{ status: 401 },
		);
	}

	const { url, tags } = Capture.parse(await request.json());

	const capture: CaptureBody = {
		url,
		tags,
		zone,
	};

	await env.CACHE_CAPTURE.send(capture, { contentType: "json" });

	return new Response("", { status: 202 });
}

export default {
	async fetch(request, env) {
		if (request.method !== "POST") {
			return new Response("", { status: 400 });
		}

		// Remove any tracking params to increase the cache hit rate.
		const url = new URL(request.url);

		if (url.pathname === "/purge") {
			return handlePurgeRequest(request, env);
		}

		if (url.pathname === "/capture") {
			return handleCaptureRequest(request, env);
		}

		return new Response("", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
