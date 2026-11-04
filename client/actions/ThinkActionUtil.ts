import { ThinkAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const ThinkActionUtil = registerActionUtil(
	class ThinkActionUtil extends AgentActionUtil<ThinkAction> {
		static override type = 'think' as const

		/**
		 * The agent's thinking is for the agent. The user sees the breathing dots
		 * while it works, never its notes or a "thought for" timer.
		 */
		override getInfo(_action: Streaming<ThinkAction>) {
			return { icon: 'brain' as const, description: null }
		}
	}
)
