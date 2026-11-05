import { IRequest } from 'itty-router'
import { Environment } from '../environment'

const META_VOICE_URL = 'https://api.meta.ai/v1/asr/realtime'
const VOICE_MODEL = 'muse-voice-transcribe-1.0'

/** Proxy a real-time transcription session without exposing the Meta API key. */
export async function voiceSession(request: IRequest, env: Environment) {
	if (!env.MODEL_API_KEY) return new Response('Voice is not set up: MODEL_API_KEY is missing.', { status: 503 })

	const keywords = new URL(request.url).searchParams
		.getAll('keyword')
		.map((keyword) => keyword.replace(/[<>\r\n]/g, ' ').trim().slice(0, 60))
		.filter(Boolean)
		.slice(0, 20)

	let upstreamResponse: Response
	try {
		upstreamResponse = await fetch(META_VOICE_URL, { headers: { Upgrade: 'websocket' } })
	} catch {
		console.error('Could not connect to Meta voice transcription.')
		return new Response('Could not start listening.', { status: 502 })
	}

	const upstream = upstreamResponse.webSocket
	if (!upstream) {
		console.error('Meta voice websocket handshake failed', upstreamResponse.status)
		return new Response('Could not start listening.', { status: 502 })
	}

	upstream.accept({ allowHalfOpen: true })
	const pair = new WebSocketPair()
	const [client, server] = Object.values(pair) as [WebSocket, WebSocket]
	server.accept({ allowHalfOpen: true })

	const closePeer = (socket: WebSocket) => {
		if (socket.readyState === WebSocket.OPEN) socket.close()
	}
	server.addEventListener('message', (event) => {
		if (upstream.readyState === WebSocket.OPEN) upstream.send(event.data)
	})
	upstream.addEventListener('message', (event) => {
		if (server.readyState === WebSocket.OPEN) server.send(event.data)
	})
	server.addEventListener('close', () => closePeer(upstream))
	upstream.addEventListener('close', () => closePeer(server))
	server.addEventListener('error', () => closePeer(upstream))
	upstream.addEventListener('error', () => closePeer(server))

	upstream.send(
		JSON.stringify({
			authorization: { accessToken: `Bearer ${env.MODEL_API_KEY}` },
			audioEncoding: 'PCM_24KHZ',
			model: VOICE_MODEL,
			mode: 'PUSH_TO_TALK',
			partialMode: 'CUMULATIVE',
			emitAudioProgress: false,
			...(keywords.length > 0 ? { keywords } : {}),
		}),
	)

	return new Response(null, { status: 101, webSocket: client })
}
