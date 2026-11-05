import { ExecutionContext } from '@cloudflare/workers-types'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { AutoRouter, error, IRequest, RequestHandler } from 'itty-router'
import { Environment } from './environment'
import { appendCommands, loadBoard, saveSnapshot } from './routes/board'
import { stream } from './routes/stream'
import { voiceSession } from './routes/voice'

const requireLocalPage: RequestHandler<IRequest, [Environment, ExecutionContext]> = (request) => {
	const url = new URL(request.url)
	const forbidden = () => new Response('Requests must come from the local Easel page.', { status: 403 })

	if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return forbidden()
	if (request.method === 'GET') {
		// Browsers leave Origin off same-origin GET requests, so check the fetch site instead.
		return request.headers.get('Sec-Fetch-Site') === 'same-origin' ? undefined : forbidden()
	}
	if (
		request.headers.get('Origin') !== url.origin ||
		request.headers.get('Sec-Fetch-Site') === 'cross-site'
	) {
		return forbidden()
	}
	if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
		return new Response('Expected application/json.', { status: 415 })
	}
	return
}

const requireLocalWebSocket: RequestHandler<IRequest, [Environment, ExecutionContext]> = (request) => {
	const url = new URL(request.url)
	if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return new Response('Requests must come from the local Easel page.', { status: 403 })
	if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
		return new Response('Expected Upgrade: websocket.', { status: 426 })
	}
	if (request.headers.get('Origin') !== url.origin || request.headers.get('Sec-Fetch-Site') !== 'same-origin') {
		return new Response('Requests must come from the local Easel page.', { status: 403 })
	}
	return
}

const router = AutoRouter<IRequest, [env: Environment, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	.post('/stream', requireLocalPage, stream)
	.get('/voice/session', requireLocalWebSocket, voiceSession)
	.get('/board/:boardId', requireLocalPage, loadBoard)
	.post('/board/:boardId/commands', requireLocalPage, appendCommands)
	.post('/board/:boardId/snapshots', requireLocalPage, saveSnapshot)

export default class extends WorkerEntrypoint<Environment> {
	override fetch(request: Request): Promise<Response> {
		return router.fetch(request, this.env, this.ctx)
	}
}

// Make the durable object available to the cloudflare worker
export { AgentDurableObject } from './do/AgentDurableObject'
export { BoardDurableObject } from './do/BoardDurableObject'
