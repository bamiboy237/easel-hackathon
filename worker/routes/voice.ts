import { IRequest } from 'itty-router'
import { Environment } from '../environment'

/** How long a listening session's key lasts. A mark's question is short. */
const SESSION_SECONDS = 120

/**
 * Start a listening session for mark and speak. The server asks OpenAI for a
 * short-lived client key for one realtime transcription session, so the browser
 * can stream the microphone straight to OpenAI without ever seeing the API key.
 */
export async function createVoiceSession(request: IRequest, env: Environment) {
	if (!env.OPENAI_API_KEY) return new Response('Voice is not set up: OPENAI_API_KEY is missing.', { status: 503 })
	const { keywords } = ((await request.json().catch(() => ({}))) ?? {}) as { keywords?: unknown }
	// Words from the marked shapes help the model spell what the user is asking about.
	const hints = Array.isArray(keywords)
		? keywords
				.filter((k): k is string => typeof k === 'string')
				.map((k) => k.replace(/[<>\r\n]/g, ' ').trim().slice(0, 60))
				.filter(Boolean)
				.slice(0, 20)
		: []
	const base = env.OPENAI_API_BASE_URL || 'https://api.openai.com'
	const upstream = await fetch(`${base}/v1/realtime/client_secrets`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			expires_after: { anchor: 'created_at', seconds: SESSION_SECONDS },
			session: {
				type: 'transcription',
				audio: {
					input: {
						format: { type: 'audio/pcm', rate: 24000 },
						transcription: {
							model: 'gpt-live-transcribe',
							delay: 'low',
							prompt: 'Someone asking a short question about part of a whiteboard drawing.',
							...(hints.length > 0 ? { keywords: hints } : {}),
						},
						turn_detection: null,
					},
				},
			},
		}),
	})
	if (!upstream.ok) {
		console.error('voice session failed', upstream.status, await upstream.text())
		return new Response('Could not start listening.', { status: 502 })
	}
	const secret = (await upstream.json()) as { value?: string; expires_at?: number; client_secret?: { value: string; expires_at: number } }
	const value = secret.value ?? secret.client_secret?.value
	const expiresAt = secret.expires_at ?? secret.client_secret?.expires_at
	if (!value) return new Response('Could not start listening.', { status: 502 })
	return Response.json({ key: value, expiresAt })
}
