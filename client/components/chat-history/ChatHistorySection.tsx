import {
	ChatHistoryActionItem,
	ChatHistoryContinuationItem,
	ChatHistoryItem,
	ChatHistoryPromptItem,
} from '../../../shared/types/ChatHistoryItem'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup, getActionHistoryGroups } from './ChatHistoryGroup'
import { ChatHistoryPrompt } from './ChatHistoryPrompt'

export interface ChatHistorySection {
	prompt: ChatHistoryPromptItem
	items: (ChatHistoryActionItem | ChatHistoryContinuationItem)[]
}

export function ChatHistorySection({
	section,
	loading,
}: {
	section: ChatHistorySection
	loading: boolean
}) {
	const agent = useAgent()
	const actions = section.items.filter((item) => item.type === 'action')
	const groups = getActionHistoryGroups(actions, agent)
	return (
		<div className="chat-history-section">
			<ChatHistoryPrompt item={section.prompt} editor={agent.editor} />
			{groups.map((group, i) => {
				return <ChatHistoryGroup key={'chat-history-group-' + i} group={group} />
			})}
			{loading && (
				// The same breathing dots the agent shows on the board while it works.
				<p className="chat-history-thinking" role="status" aria-label="Working">
					<span className="chat-working-dots" aria-hidden>
						<span />
						<span />
						<span />
					</span>
				</p>
			)}
		</div>
	)
}

export function getAgentHistorySections(items: ChatHistoryItem[]): ChatHistorySection[] {
	const sections: ChatHistorySection[] = []

	for (const item of items) {
		if (item.type === 'prompt') {
			// Filter out 'self' prompts from the UI
			if (item.promptSource === 'self') continue
			sections.push({ prompt: item, items: [] })
			continue
		}

		// Only add to the last section if one exists
		if (sections.length > 0) {
			sections[sections.length - 1].items.push(item)
		}
	}

	return sections
}
