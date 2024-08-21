import Cloudflare from "cloudflare";
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

function apiToken(request: Request, env: Env): string {
	const auth = request.headers.get("Authorization");
	if (!auth) {
		throw new Error("Missing Authorization header");
	}
	const [scheme, token] = auth.split(" ");
	if (scheme !== "Bearer") {
		throw new Error("Authorization scheme is not Bearer");
	}

	// Needs at least `Cache Purge:Purge, Zone:Read" permissions.
	if (token !== env.API_TOKEN) {
		throw new Error("Provided token does not match the `API_TOKEN` secret.");
	}

	return token;
}

async function handlePurgeRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	let token: string;
	try {
		token = apiToken(request, env);
	} catch (e) {
		return Response.json(
			{
				error: String(e),
			},
			{ status: 401 },
		);
	}

	const client = new Cloudflare({
		apiToken: token,
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
	console.debug("[Cache Purge Request] Purge Tags", tags);

	// If no zone is present, then all zones will be purged.
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
		console.debug(
			"[Cache Purge Request] Send Batch",
			messageChunks.map(({ body }) => body),
		);
		promises.push(env.CACHE_PURGE_TAG.sendBatch(messageChunks));
	}

	await Promise.all(promises);

	return new Response("", { status: 202 });
}

async function handleCaptureRequest(
	request: Request,
	env: Env,
): Promise<Response> {
	// Since this worker can be called over the internet, we must at least verify that the token matches the secret,
	// but we don't need to verify that it's usable right now.
	try {
		apiToken(request, env);
	} catch (e) {
		return Response.json(
			{
				error: String(e),
			},
			{ status: 401 },
		);
	}

	// If there is no zone on the request,
	// then we wont know how to purge the response later.
	const zone = request.headers.get("CF-Worker");
	if (!zone) {
		return Response.json(
			{
				error: "Missing CF-Worker Header",
			},
			{ status: 400 },
		);
	}

	const { url, tags } = Capture.parse(await request.json());

	const capture: CaptureBody = {
		url,
		zone,
		tags,
	};

	await env.CACHE_CAPTURE.send(capture, { contentType: "json" });

	return new Response("", { status: 202 });
}

export default {
	async fetch(request, env) {
		// Remove any tracking params to increase the cache hit rate.
		const url = new URL(request.url);

		if (request.method !== "POST") {
			return new Response("", { status: 404 });
		}

		switch (url.pathname) {
			case "/purge":
				return handlePurgeRequest(request, env);
			case "/capture":
				return handleCaptureRequest(request, env);
			default:
				return new Response("", { status: 404 });
		}
	},
} satisfies ExportedHandler<Env>;
