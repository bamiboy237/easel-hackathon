import { AsideAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const AsideActionUtil = registerActionUtil(
	class AsideActionUtil extends AgentActionUtil<AsideAction> {
		static override type = 'aside' as const

		override getInfo(action: Streaming<AsideAction>) {
			return {
				icon: 'pencil' as const,
				description: action.topic ? `**Aside:** ${action.topic}` : null,
				canGroup: () => false,
			}
		}

		// The aside gets its own space first, so the rest of this response is dropped
		// and the next pass draws there.
		override applyAction(action: Streaming<AsideAction>) {
			if (!action.complete) return
			if (this.agent.aside.getActive()) this.agent.aside.end()
			this.agent.aside.start(action.topic)
			this.agent.endResponseEarly()
			this.agent.schedule({
				agentMessages: [`You started an aside about "${action.topic}". Work it out in the aside space, then stop.`],
				source: 'self',
			})
		}
	}
)
