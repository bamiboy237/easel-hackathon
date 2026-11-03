// Local process that signs in with ChatGPT and forwards model requests to OpenAI.
// The Cloudflare Worker cannot open a browser or store tokens, so this process owns both.
import { execFile } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const HELPER_PORT = 8788
const CALLBACK_PORT = 1455
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/auth/callback`
const ISSUER = 'https://auth.openai.com'
const AUTHORIZE_URL = `${ISSUER}/api/accounts/authorize`
const TOKEN_URL = `${ISSUER}/api/accounts/oauth/token`
const OPENAI_API = 'https://api.openai.com/v1'
const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${PLAN_USAGE_SCOPE}`
const REFRESH_MARGIN_MS = 60_000

const CONFIG_DIR = join(homedir(), '.config', 'easel')
const CREDENTIALS_PATH = join(CONFIG_DIR, 'chatgpt-credentials.json')

// OpenAI rejects these fields on plan-funded requests.
const UNSUPPORTED_FIELDS = [
	'background',
	'conversation',
	'max_output_tokens',
	'max_tool_calls',
	'metadata',
	'moderation',
	'multi_agent',
	'previous_response_id',
	'prompt',
	'prompt_cache_retention',
	'safety_identifier',
	'temperature',
	'top_logprobs',
	'top_p',
	'truncation',
	'user',
]

interface Credentials {
	ext_agent_host_id: string
	client_id?: string
	subject?: string
	id_token?: string
	access_token?: string
	refresh_token?: string
	scopes?: string[]
	expires_at?: number
}

interface TokenResponse {
	access_token: string
	refresh_token: string
	id_token?: string
	expires_in: number
	scope: string
}

async function loadCredentials(): Promise<Credentials> {
	try {
		return JSON.parse(await readFile(CREDENTIALS_PATH, 'utf8'))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
		const credentials = { ext_agent_host_id: `urn:uuid:${randomUUID()}` }
		await saveCredentials(credentials)
		return credentials
	}
}

async function saveCredentials(credentials: Credentials) {
	await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
	const temporaryPath = `${CREDENTIALS_PATH}.tmp`
	await writeFile(temporaryPath, JSON.stringify(credentials, null, 2), { mode: 0o600 })
	await chmod(temporaryPath, 0o600)
	await rename(temporaryPath, CREDENTIALS_PATH)
}

function base64Url(bytes: Buffer) {
	return bytes.toString('base64url')
}

async function requestTokens(params: Record<string, string>): Promise<TokenResponse> {
	const response = await fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ ...params, resource: OPENAI_API }),
	})
	if (!response.ok) {
		throw new Error(`Token request failed with status ${response.status}`)
	}
	return (await response.json()) as TokenResponse
}

function withTokens(credentials: Credentials, tokens: TokenResponse): Credentials {
	return {
		...credentials,
		access_token: tokens.access_token,
		refresh_token: tokens.refresh_token,
		id_token: tokens.id_token ?? credentials.id_token,
		scopes: tokens.scope.split(' '),
		expires_at: Date.now() + tokens.expires_in * 1000,
	}
}

async function validateIdToken(idToken: string, clientId: string, nonce: string) {
	const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`)
	const { jwks_uri: jwksUri } = (await discovery.json()) as { jwks_uri: string }
	const { payload } = await jwtVerify(idToken, createRemoteJWKSet(new URL(jwksUri)), {
		issuer: ISSUER,
		audience: clientId,
	})
	if (payload.nonce !== nonce) throw new Error('ID token nonce does not match this sign-in')
	if (!payload.sub) throw new Error('ID token has no subject')
	return payload.sub
}

interface AuthorizationResult {
	code: string
	clientId: string
}

function waitForCallback(state: string, knownClientId: string | undefined) {
	let callbackServer: Server
	const result = new Promise<AuthorizationResult>((resolve, reject) => {
		callbackServer = createServer((request, response) => {
			const url = new URL(request.url ?? '/', REDIRECT_URI)
			if (url.pathname !== '/auth/callback') {
				response.writeHead(404).end()
				return
			}
			response.writeHead(200, { 'Content-Type': 'text/plain' })
			response.end('You can close this tab and return to Easel.')

			if (url.searchParams.get('state') !== state) {
				reject(new Error('Sign-in state does not match'))
				return
			}
			const oauthError = url.searchParams.get('error')
			if (oauthError) {
				reject(new Error(`Sign-in failed: ${oauthError}`))
				return
			}
			const code = url.searchParams.get('code')
			const returnedClientId = url.searchParams.get('client_id')
			if (knownClientId && returnedClientId && returnedClientId !== knownClientId) {
				reject(new Error('Sign-in returned a different client ID'))
				return
			}
			const clientId = knownClientId ?? returnedClientId
			if (!code || !clientId) {
				reject(new Error('Sign-in did not return a code and client ID'))
				return
			}
			resolve({ code, clientId })
		})
	})
	// Wrapped in an object so that awaiting the listener does not also await the callback.
	return new Promise<{ result: Promise<AuthorizationResult> }>((resolve, reject) => {
		callbackServer.once('error', reject)
		callbackServer.listen(CALLBACK_PORT, '127.0.0.1', () => {
			resolve({ result: result.finally(() => callbackServer.close()) })
		})
	})
}

async function signIn(credentials: Credentials): Promise<Credentials> {
	const state = base64Url(randomBytes(32))
	const nonce = base64Url(randomBytes(32))
	const verifier = base64Url(randomBytes(32))
	const challenge = base64Url(createHash('sha256').update(verifier).digest())
	const knownClientId = credentials.client_id

	const callback = await waitForCallback(state, knownClientId)

	const url = new URL(AUTHORIZE_URL)
	url.search = new URLSearchParams({
		client_id: knownClientId ?? 'dynamic_agent_client',
		...(knownClientId ? {} : { agent_name_hint: 'Easel' }),
		ext_agent_host_id: credentials.ext_agent_host_id,
		response_type: 'code',
		redirect_uri: REDIRECT_URI,
		scope: SCOPES,
		resource: OPENAI_API,
		state,
		nonce,
		code_challenge_method: 'S256',
		code_challenge: challenge,
	}).toString()

	console.log('Opening your browser to sign in with ChatGPT.')
	execFile('open', [url.toString()])

	const { code, clientId } = await callback.result
	const tokens = await requestTokens({
		grant_type: 'authorization_code',
		client_id: clientId,
		code,
		code_verifier: verifier,
		redirect_uri: REDIRECT_URI,
	})
	if (!tokens.id_token) throw new Error('Sign-in did not return an ID token')

	const subject = await validateIdToken(tokens.id_token, clientId, nonce)
	if (credentials.subject && credentials.subject !== subject) {
		throw new Error('Sign-in returned a different ChatGPT account')
	}
	if (!tokens.scope.split(' ').includes(PLAN_USAGE_SCOPE)) {
		throw new Error('ChatGPT plan usage was not granted')
	}

	const signedIn = withTokens({ ...credentials, client_id: clientId, subject }, tokens)
	await saveCredentials(signedIn)
	return signedIn
}

let credentials = await loadCredentials()
let pendingRefresh: Promise<void> | undefined

async function refreshTokens() {
	const { client_id: clientId, refresh_token: refreshToken } = credentials
	if (!clientId || !refreshToken) throw new Error('No saved ChatGPT session')
	const tokens = await requestTokens({
		grant_type: 'refresh_token',
		client_id: clientId,
		refresh_token: refreshToken,
	})
	credentials = withTokens(credentials, tokens)
	await saveCredentials(credentials)
}

async function getAccessToken() {
	if (Date.now() >= (credentials.expires_at ?? 0) - REFRESH_MARGIN_MS) {
		// Refresh tokens rotate, so concurrent requests share one refresh.
		pendingRefresh ??= refreshTokens().finally(() => {
			pendingRefresh = undefined
		})
		await pendingRefresh
	}
	return credentials.access_token
}

async function readJson(request: IncomingMessage) {
	const chunks: Buffer[] = []
	for await (const chunk of request) chunks.push(chunk)
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

// Adapts a Responses API request to the rules for plan-funded requests.
function toPlanRequest(body: Record<string, unknown>) {
	const planRequest = { ...body, store: false, stream: true }
	for (const field of UNSUPPORTED_FIELDS) delete planRequest[field as keyof typeof planRequest]

	const input = (body.input ?? []) as { role?: string; content?: unknown }[]
	const systemItems = input.filter((item) => item.role === 'system')
	const instructions = systemItems.map((item) => item.content as string).join('\n\n')
	return {
		...planRequest,
		input: input.filter((item) => item.role !== 'system'),
		...(instructions ? { instructions } : {}),
	}
}

async function forward(request: IncomingMessage, response: ServerResponse) {
	const accessToken = await getAccessToken()
	const isResponses = request.method === 'POST' && request.url === '/v1/responses'
	const isModels = request.method === 'GET' && request.url === '/v1/models'
	if (!isResponses && !isModels) {
		response.writeHead(404).end()
		return
	}

	const abort = new AbortController()
	response.once('close', () => abort.abort())
	const upstream = await fetch(`${OPENAI_API}${isModels ? '/models' : '/responses'}`, {
		method: request.method,
		signal: abort.signal,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		},
		...(isResponses ? { body: JSON.stringify(toPlanRequest(await readJson(request))) } : {}),
	})

	response.writeHead(upstream.status, {
		'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
	})
	if (upstream.body) {
		// The cast covers a clash between the Cloudflare and Node stream types.
		await pipeline(Readable.fromWeb(upstream.body as never), response)
	} else {
		response.end()
	}
}

function startProxy() {
	createServer((request, response) => {
		// Browsers attach Origin to cross-site requests. The Worker does not.
		if (request.headers.origin) {
			response.writeHead(403).end()
			return
		}
		forward(request, response).catch((error) => {
			if (error.name === 'AbortError') return
			console.error(`Request failed: ${error.message}`)
			if (response.headersSent) {
				response.destroy()
				return
			}
			response.writeHead(502, { 'Content-Type': 'application/json' })
			response.end(JSON.stringify({ error: { message: error.message } }))
		})
	}).listen(HELPER_PORT, '127.0.0.1', () => {
		console.log(`ChatGPT helper is running on http://127.0.0.1:${HELPER_PORT}`)
	})
}

async function ensureSession() {
	if (credentials.refresh_token) {
		try {
			await getAccessToken()
			return
		} catch {
			console.log('The saved ChatGPT session expired.')
		}
	}
	credentials = await signIn(credentials)
}

await ensureSession()
startProxy()
