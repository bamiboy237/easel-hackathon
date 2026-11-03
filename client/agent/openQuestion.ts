import { AskAction } from '../../shared/schema/AgentActionSchemas'
import { ChatHistoryActionItem, ChatHistoryItem } from '../../shared/types/ChatHistoryItem'
import type { TldrawAgent } from './TldrawAgent'

export interface OpenQuestion {
	item: ChatHistoryActionItem
	question: string
	choices: string[]
}

/**
 * The agent's latest question, while the user has not answered it yet.
 * Any user prompt after the question answers it.
 */
export function getOpenQuestion(history: readonly ChatHistoryItem[]): OpenQuestion | null {
	for (let i = history.length - 1; i >= 0; i--) {
		const item = history[i]
		if (item.type === 'prompt' && item.promptSource !== 'self') return null
		if (item.type !== 'action' || item.action._type !== 'ask' || !item.action.complete) continue
		const action = item.action as AskAction
		return { item, question: action.question, choices: action.choices }
	}
	return null
}

/** Answer the agent's question with one of its choices. */
export function answerQuestion(agent: TldrawAgent, question: string, choice: string) {
	return agent.prompt({
		agentMessages: [`You asked: "${question}" The user chose: "${choice}". Continue the work that way.`],
		userMessages: [choice],
	})
}
