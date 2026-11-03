import { AgentAction, getActionSchemaForMode } from '../types/AgentAction'

export function parseAgentAction(value: unknown, mode: string): AgentAction {
	if (!value || typeof value !== 'object' || !('_type' in value) || typeof value._type !== 'string') {
		throw new Error('Agent instruction has no action type.')
	}
	const schema = getActionSchemaForMode(value._type, mode)
	if (!schema) throw new Error(`Unknown agent instruction: ${value._type}`)

	const result = schema.safeParse(value)
	if (!result.success) {
		const detail = result.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ')
		throw new Error(`Invalid ${value._type} instruction. ${detail}`)
	}
	return result.data as AgentAction
}
