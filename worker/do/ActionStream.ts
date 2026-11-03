import { parseAgentAction } from '../../shared/schema/parseAgentAction'
import { AgentAction } from '../../shared/types/AgentAction'
import { Streaming } from '../../shared/types/Streaming'
import { closeAndParseJson } from './closeAndParseJson'

export class ActionStream {
	private buffer = ''
	private offset = 0
	private stack: string[] = []
	private inString = false
	private escaped = false
	private actionStart: number | null = null
	private actionStartedAt = 0
	private previousActionEnd = 0
	private completedActions = 0
	private foundActions = false

	constructor(private mode: string) {}

	*push(text: string): Generator<Streaming<AgentAction>> {
		this.buffer += text
		for (; this.offset < this.buffer.length; this.offset++) {
			const char = this.buffer[this.offset]
			if (this.inString) {
				if (this.escaped) {
					this.escaped = false
				} else if (char === '\\') {
					this.escaped = true
				} else if (char === '"') {
					this.inString = false
				}
				continue
			}
			if (char === '"') {
				this.inString = true
				continue
			}
			if (char === '{' || char === '[') {
				if (char === '[' && this.stack.length === 1) {
					if (!/^\s*\{\s*"actions"\s*:\s*\[$/.test(this.buffer.slice(0, this.offset + 1))) {
						throw new Error('Expected an agent response containing an actions array.')
					}
					this.foundActions = true
					this.previousActionEnd = this.offset + 1
				} else if (char === '{' && this.foundActions && this.stack.length === 2) {
					const separator = this.buffer.slice(this.previousActionEnd, this.offset).trim()
					if (separator !== (this.completedActions === 0 ? '' : ',')) {
						throw new Error('Invalid separator between agent instructions.')
					}
					this.actionStart = this.offset
					this.actionStartedAt = Date.now()
				}
				this.stack.push(char)
			} else if (char === '}' || char === ']') {
				const expected = char === '}' ? '{' : '['
				if (this.stack.pop() !== expected) {
					throw new Error('Invalid JSON in the agent response.')
				}
				if (this.actionStart !== null && this.stack.length === 2) {
					const action = parseAgentAction(
						JSON.parse(this.buffer.slice(this.actionStart, this.offset + 1)),
						this.mode
					)
					this.actionStart = null
					this.previousActionEnd = this.offset + 1
					this.completedActions++
					yield { ...action, complete: true, time: Date.now() - this.actionStartedAt }
				} else if (char === ']' && this.stack.length === 1 && this.foundActions) {
					if (this.buffer.slice(this.previousActionEnd, this.offset).trim() !== '') {
						throw new Error('Agent instructions must be JSON objects.')
					}
				}
			}
		}

		if (this.actionStart !== null) {
			const partial = closeAndParseJson(this.buffer.slice(this.actionStart))
			if (partial && typeof partial === 'object' && !Array.isArray(partial)) {
				yield { ...partial, complete: false, time: Date.now() - this.actionStartedAt }
			}
		}
	}

	finish(reason: string) {
		if (reason !== 'stop') {
			throw new Error(`Agent response did not finish (${reason}). Completed instructions were kept.`)
		}
		let response: unknown
		try {
			response = JSON.parse(this.buffer)
		} catch {
			throw new Error('Agent response was cut off or contained invalid JSON.')
		}
		if (
			!response ||
			typeof response !== 'object' ||
			!('actions' in response) ||
			!Array.isArray(response.actions) ||
			response.actions.length !== this.completedActions ||
			Object.keys(response).length !== 1
		) {
			throw new Error('Expected an agent response containing an actions array.')
		}
	}
}
