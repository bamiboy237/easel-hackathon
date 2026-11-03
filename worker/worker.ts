import { ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AutoRouter, error, IRequest, RequestHandler } from 'itty-router'
import { Environment } from './environment'
import { stream } from './routes/stream'

const requireLocalPage: RequestHandler<IRequest, [Environment, ExecutionContext]> = (request) => {
	const url = new URL(request.url)

	if (
		!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
		request.headers.get('Origin') !== url.origin ||
		request.headers.get('Sec-Fetch-Site') === 'cross-site'
	) {
		return new Response('AI requests must come from the local Easel page.', { status: 403 })
	}
	if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
		return new Response('Expected application/json.', { status: 415 })
	}
	return
}

const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(e)
	},
}).post('/stream', requireLocalPage, stream)

export default class extends WorkerEntrypoint<Environment> {
	override fetch(request: Request): Promise<Response> {
		return router.fetch(request, this.env, this.ctx)
	}
}

// Make the durable object available to the cloudflare worker
export { AgentDurableObject } from './do/AgentDurableObject'
