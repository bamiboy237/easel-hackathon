import { useCallback, useMemo, useState } from 'react'
import { reverseRecordsDiff, squashRecordDiffs } from 'tldraw'
import { AgentIcon, AgentIconType } from '../../../shared/icons/AgentIcon'
import { ChatHistoryActionItem } from '../../../shared/types/ChatHistoryItem'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup } from './ChatHistoryGroup'
import { getActionInfo } from './getActionInfo'
import { TldrawDiffViewer } from './TldrawDiffViewer'

export function ChatHistoryGroupWithDiff({ group }: { group: ChatHistoryGroup }) {
	const agent = useAgent()
	const { items } = group
	const { editor } = agent
	const diff = useMemo(() => squashRecordDiffs(items.map((item) => item.diff)), [items])

	// Accept all changes from this group
	const handleAccept = useCallback(() => {
		agent.chat.update((currentChatHistoryItems) => {
			const newItems = [...currentChatHistoryItems]
			for (const item of items) {
				const index = newItems.findIndex((v) => v === item)

				// Mark the item as accepted
				if (index !== -1) {
					newItems[index] = { ...item, acceptance: 'accepted' }
				}

				// Apply the diff if needed
				if (item.acceptance === 'rejected') {
					editor.store.applyDiff(item.diff)
				}
			}
			return newItems
		})
	}, [items, editor, agent.chat])

	// Reject all changes from this group
	const handleReject = useCallback(() => {
		agent.chat.update((currentChatHistoryItems) => {
			const newItems = [...currentChatHistoryItems]
			for (const item of items) {
				const index = newItems.findIndex((v) => v === item)

				// Mark the item as rejected
				if (index !== -1) {
					newItems[index] = { ...item, acceptance: 'rejected' }
				}

				// Reverse the diff if needed
				if (item.acceptance !== 'rejected') {
					const reverseDiff = reverseRecordsDiff(item.diff)
					editor.store.applyDiff(reverseDiff)
				}
			}
			return newItems
		})
	}, [items, editor, agent.chat])

	// Get the acceptance status of the group
	// If all items are accepted, the group is accepted
	// If all items are rejected, the group is rejected
	// Otherwise, the group is pending
	const acceptance = useMemo<ChatHistoryActionItem['acceptance']>(() => {
		if (items.length === 0) return 'pending'
		const acceptance = items[0].acceptance
		for (let i = 1; i < items.length; i++) {
			if (items[i].acceptance !== acceptance) {
				return 'pending'
			}
		}
		return acceptance
	}, [items])

	const steps = useMemo(
		() => items.map((item) => getActionInfo(item.action, agent)),
		[items, agent]
	)

	const [isOpen, setIsOpen] = useState(false)
	const descriptions = useMemo(() => getDistinctDescriptions(steps), [steps])
	const summary = `${descriptions.length} ${descriptions.length === 1 ? 'change' : 'changes'}`

	return (
		<div className={`chat-history-change ${isOpen ? 'chat-history-change--open' : ''}`}>
			<div className="chat-history-change-header">
				<button
					className="chat-history-change-toggle"
					onClick={() => setIsOpen((open) => !open)}
					aria-expanded={isOpen}
				>
					<span className="chat-history-change-chevron" aria-hidden>
						›
					</span>
					<span className="chat-history-change-summary">{summary}</span>
					{!isOpen && descriptions.length > 0 && (
						<span className="chat-history-change-latest">{descriptions.at(-1)}</span>
					)}
				</button>
				<div className="chat-history-change-acceptance">
					{acceptance === 'rejected' ? (
						<button onClick={handleAccept}>Restore</button>
					) : (
						<button onClick={handleReject}>Undo</button>
					)}
				</div>
			</div>
			{isOpen && (
				<>
					<DiffSteps steps={steps} />
					<TldrawDiffViewer diff={diff} />
				</>
			)}
		</div>
	)
}

function getDistinctDescriptions(steps: DiffStep[]) {
	const descriptions: string[] = []
	for (const step of steps) {
		if (step.description && step.description !== descriptions.at(-1)) {
			descriptions.push(step.description)
		}
	}
	return descriptions
}

interface DiffStep {
	icon: AgentIconType | null
	description: string | null
}

function DiffSteps({ steps }: { steps: DiffStep[] }) {
	let previousDescription = ''
	return (
		<div className="agent-changes">
			{steps.map((step, i) => {
				if (!step.description) return null

				if (step.description === previousDescription) return null
				previousDescription = step.description
				return (
					<div className="agent-change" key={'intent-' + i}>
						{step.icon && (
							<span className="agent-change-icon">
								<AgentIcon type={step.icon} />
							</span>
						)}
						{step.description}
					</div>
				)
			})}
		</div>
	)
}
