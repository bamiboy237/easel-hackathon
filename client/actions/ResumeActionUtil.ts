import { BoxModel } from 'tldraw'
import { ResumeAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

export const ResumeActionUtil = registerActionUtil(
	class ResumeActionUtil extends AgentActionUtil<ResumeAction> {
		static override type = 'resume' as const

		override getInfo(action: Streaming<ResumeAction>) {
			return {
				icon: 'pencil' as const,
				description: action.complete ? '**Back to the main work**' : null,
				canGroup: () => false,
			}
		}

		// Back on the main work, the next pass runs without the aside's space. It
		// continues the waiting plan, or does what the user asked on returning.
		override applyAction(action: Streaming<ResumeAction>) {
			if (!action.complete) return
			const aside = this.agent.aside.end()
			if (!aside) return
			this.agent.endResponseEarly()
			const where = aside.from ? ` The main work is at ${JSON.stringify(toModel(new AgentHelpers(this.agent), aside.from))}.` : ''
			const next = aside.plan
				? 'Continue the plan where you left off, using what the aside settled.'
				: "Do what the user's latest message asks on the main work, using what the aside settled. If it asks for nothing more, stop."
			this.agent.schedule({
				agentMessages: [`The aside about "${aside.topic}" is over. ${action.summary ?? ''}${where} ${next}`],
				source: 'self',
			})
		}
	}
)

function toModel(helpers: AgentHelpers, box: BoxModel) {
	return helpers.roundBox(helpers.applyOffsetToBox(box))
}
