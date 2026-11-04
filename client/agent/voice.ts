/**
 * Listening for mark and speak. The server mints a short-lived key for one
 * OpenAI realtime transcription session; the browser streams the microphone to
 * it as 24 kHz PCM and gets the words back as they are spoken. The model has no
 * turn detection, so the end of speech is found here, from the audio level.
 */

const SAMPLE_RATE = 24000
/** Audio is sent in chunks of this many samples (100 ms). */
const CHUNK = 2400
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
			const response = await fetch('/voice/session', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ keywords }),
			})
			if (!response.ok) throw new Error(`voice session ${response.status}`)
			const { key } = (await response.json()) as { key: string }
			if (this.done) return false

			this.stream = await navigator.mediaDevices.getUserMedia({
				audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
			})
			if (this.done) return this.cleanup(), false

			this.ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
				'realtime',
				`openai-insecure-api-key.${key}`,
			])
			this.ws.onmessage = (event) => this.handleEvent(JSON.parse(event.data as string))
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
		this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
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
		const bytes = new Uint8Array(pcm.buffer)
		let binary = ''
		for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
		this.ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: btoa(binary) }))
	}

	private handleEvent(event: { type: string; delta?: string; transcript?: string; error?: { message?: string } }) {
		if (event.type === 'conversation.item.input_audio_transcription.delta' && event.delta) {
			this.text += event.delta
			this.handlers.onText(this.text)
		} else if (event.type === 'conversation.item.input_audio_transcription.completed') {
			this.text = event.transcript ?? this.text
			this.handlers.onText(this.text)
			if (this.finishing) this.end(this.text.trim() || null)
		} else if (event.type === 'error') {
			console.warn('Listening error:', event.error?.message)
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
