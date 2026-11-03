import { AskAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const MAX_CHOICES = 4

export const AskActionUtil = registerActionUtil(
	class AskActionUtil extends AgentActionUtil<AskAction> {
		static override type = 'ask' as const

		override getInfo(action: Streaming<AskAction>) {
			return {
				description: action.question ?? '',
				canGroup: () => false,
			}
		}

		override sanitizeAction(action: Streaming<AskAction>, _helpers: AgentHelpers) {
			if (!action.complete) return action
			const choices = [...new Set((action.choices ?? []).map((choice) => choice.trim()).filter(Boolean))]
			return { ...action, choices: choices.slice(0, MAX_CHOICES) }
		}

		// The agent stops here and waits. The user's answer starts the next request.
		override applyAction(action: Streaming<AskAction>) {
			if (!action.complete) return
			this.agent.waitForAnswer()
		}
	}
)
