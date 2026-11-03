import { AsidePart } from '../../shared/schema/PromptPartDefinitions'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

/** The aside in progress, so the model works in its space and knows how to return. */
export const AsidePartUtil = registerPromptPartUtil(
	class AsidePartUtil extends PromptPartUtil<AsidePart> {
		static override type = 'aside' as const

		override getPart(_request: unknown, helpers: AgentHelpers): AsidePart {
			const aside = this.agent.aside.getActive()
			if (!aside) return { type: 'aside', aside: null }
			return {
				type: 'aside',
				aside: {
					topic: aside.topic,
					region: helpers.roundBox(helpers.applyOffsetToBox(aside.region)),
					from: aside.from ? helpers.roundBox(helpers.applyOffsetToBox(aside.from)) : null,
					hasPlan: !!aside.plan,
				},
			}
		}
	}
)
