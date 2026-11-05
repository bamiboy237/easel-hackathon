/**
 * Listening for mark and speak. The Worker proxies 24 kHz PCM audio to Meta's
 * realtime transcription API, keeping the API key out of the browser. Speech
 * ends when the audio level stays quiet for a short time.
 */

const SAMPLE_RATE = 24000
/** Audio is sent in chunks of this many samples (80 ms). */
const CHUNK = 1920
/** A chunk louder than this counts as speech. */
const SPEECH_LEVEL = 0.012
/** After speech, this much quiet ends the question. */
const END_SILENCE_MS = 1100
/** With no speech at all for this long, listening gives up. */
const NO_SPEECH_MS = 7000
/** A question never runs longer than this. */
const MAX_MS = 45000
/** How long to wait for the final words after the question ends. */
const FINAL_WAIT_MS = 4000

export interface ListenHandlers {
	/** The words so far, replaced as more arrive. */
	onText: (text: string) => void
	/** Listening ended: the final words, or null when nothing was said or it failed. */
	onEnd: (text: string | null) => void
	/** Speech was heard, so the UI can show the user is being heard. */
	onSpeech?: () => void
}

/** The worklet copies microphone frames to the main thread. */
const WORKLET = `
class Capture extends AudioWorkletProcessor {
	process(inputs) {
		const channel = inputs[0] && inputs[0][0]
		if (channel) this.port.postMessage(channel.slice(0))
		return true
	}
}
registerProcessor('easel-capture', Capture)
`

export class VoiceListener {
	private ws: WebSocket | null = null
	private stream: MediaStream | null = null
	private context: AudioContext | null = null
	private timers: ReturnType<typeof setTimeout>[] = []
	private pending = new Float32Array(0)
	private text = ''
	private heardSpeech = false
	private lastSpeechAt = 0
	private startedAt = 0
	private finishing = false
	private done = false

	constructor(private handlers: ListenHandlers) {}

	/** Start listening. Resolves false when the microphone or the session is unavailable. */
	async start(keywords: string[] = []): Promise<boolean> {
		try {
			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			})
			if (this.done) return this.cleanup(), false

			const socketUrl = new URL('/voice/session', window.location.href)
			socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
			for (const keyword of keywords) socketUrl.searchParams.append('keyword', keyword)
			this.ws = new WebSocket(socketUrl.toString())
			this.ws.onmessage = (event) => {
				if (typeof event.data === 'string') this.handleEvent(JSON.parse(event.data))
			}
			this.ws.onerror = () => this.end(null)
			this.ws.onclose = () => {
				if (!this.done) this.end(this.text.trim() || null)
			}
			await new Promise<void>((resolve, reject) => {
				this.ws!.onopen = () => resolve()
				this.timers.push(setTimeout(() => reject(new Error('voice connection timed out')), 8000))
			})

			this.context = new AudioContext({ sampleRate: SAMPLE_RATE })
			const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
			await this.context.audioWorklet.addModule(url)
			URL.revokeObjectURL(url)
			const source = this.context.createMediaStreamSource(this.stream)
			const node = new AudioWorkletNode(this.context, 'easel-capture')
			node.port.onmessage = (event) => this.handleAudio(event.data as Float32Array)
			source.connect(node)

			this.startedAt = performance.now()
			this.timers.push(setTimeout(() => this.finish(), MAX_MS))
			return true
		} catch (error) {
			console.warn('Listening is unavailable:', error)
			this.end(null)
			return false
		}
	}

	/** Stop listening now and keep what was heard. */
	finish() {
		if (this.finishing || this.done) return
		this.finishing = true
		this.stopMicrophone()
		if (!this.heardSpeech || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			this.end(this.text.trim() || null)
			return
		}
		this.flush()
		this.ws.send(JSON.stringify({ type: 'endStream' }))
		this.timers.push(setTimeout(() => this.end(this.text.trim() || null), FINAL_WAIT_MS))
	}

	/** Stop listening and drop what was heard. */
	cancel() {
		if (this.done) return
		this.done = true
		this.cleanup()
	}

	private handleAudio(frame: Float32Array) {
		if (this.finishing || this.done) return
		const merged = new Float32Array(this.pending.length + frame.length)
		merged.set(this.pending)
		merged.set(frame, this.pending.length)
		this.pending = merged
		while (this.pending.length >= CHUNK) {
			const chunk = this.pending.subarray(0, CHUNK)
			this.pending = this.pending.slice(CHUNK)
			this.send(chunk)
			this.detectSpeech(chunk)
		}
	}

	private detectSpeech(chunk: Float32Array) {
		let sum = 0
		for (const sample of chunk) sum += sample * sample
		const level = Math.sqrt(sum / chunk.length)
		const now = performance.now()
		if (level > SPEECH_LEVEL) {
			if (!this.heardSpeech) this.handlers.onSpeech?.()
			this.heardSpeech = true
			this.lastSpeechAt = now
			return
		}
		if (this.heardSpeech && now - this.lastSpeechAt > END_SILENCE_MS) this.finish()
		else if (!this.heardSpeech && now - this.startedAt > NO_SPEECH_MS) this.finish()
	}

	private flush() {
		if (this.pending.length > 0) this.send(this.pending)
		this.pending = new Float32Array(0)
	}

	private send(samples: Float32Array) {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
		const pcm = new Int16Array(samples.length)
		for (let i = 0; i < samples.length; i++) {
			const s = Math.max(-1, Math.min(1, samples[i]))
			pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
		}
		this.ws.send(pcm.buffer)
	}

	private handleEvent(event: { type: string; transcript?: string; message?: string; error?: { message?: string } }) {
		if (event.type === 'transcript' && event.transcript !== undefined) {
			this.text = event.transcript
			this.handlers.onText(this.text)
		} else if (event.type === 'error') {
			console.warn('Listening error:', event.error?.message ?? event.message ?? 'Meta transcription failed.')
			this.end(this.text.trim() || null)
		}
	}

	private end(text: string | null) {
		if (this.done) return
		this.done = true
		this.cleanup()
		this.handlers.onEnd(text)
	}

	private stopMicrophone() {
		this.stream?.getTracks().forEach((track) => track.stop())
		this.stream = null
		void this.context?.close().catch(() => {})
		this.context = null
	}

	private cleanup() {
		this.stopMicrophone()
		this.timers.forEach(clearTimeout)
		this.timers = []
		if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close()
		this.ws = null
	}
}
