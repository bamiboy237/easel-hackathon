import { useCallback, useMemo, useState } from 'react'
import { squashRecordDiffs } from 'tldraw'
import { AgentIcon, AgentIconType } from '../../../shared/icons/AgentIcon'
import { ChatHistoryActionItem } from '../../../shared/types/ChatHistoryItem'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup } from './ChatHistoryGroup'
import { getActionInfo } from './getActionInfo'
import { TldrawDiffViewer } from './TldrawDiffViewer'

export function ChatHistoryGroupWithDiff({ group }: { group: ChatHistoryGroup }) {
	const agent = useAgent()
	const { items } = group
	const diff = useMemo(() => squashRecordDiffs(items.map((item) => item.diff)), [items])

	// Undo and Restore go through the command log, so they keep newer human work.
	const markItems = useCallback(
		(change: (item: ChatHistoryActionItem) => ChatHistoryActionItem) => {
			agent.chat.update((currentChatHistoryItems) =>
				currentChatHistoryItems.map((historyItem) =>
					historyItem.type === 'action' && items.includes(historyItem) ? change(historyItem) : historyItem
				)
			)
		},
		[items, agent.chat]
	)

	// Revert every pass in this group.
	const handleReject = useCallback(() => {
		const passIds = [...new Set(items.map((item) => item.passId).filter((id) => id !== undefined))]
		const commandIds = passIds.flatMap((passId) => agent.commands.getAgentCommandIds({ passId }))
		const { commandId, kept } = agent.commands.revert(commandIds)
		if (!commandId) return
		markItems((item) => ({
			...item,
			acceptance: 'rejected',
			revertCommandId: commandId,
			keptRecordIds: kept.map((record) => record.id),
		}))
	}, [items, agent.commands, markItems])

	// Restore what the last revert undid.
	const handleAccept = useCallback(() => {
		const revertCommandId = items.find((item) => item.revertCommandId)?.revertCommandId
		if (!revertCommandId) return
		const { kept } = agent.commands.revert([revertCommandId], 'restore')
		markItems((item) => ({
			...item,
			acceptance: 'accepted',
			revertCommandId: undefined,
			keptRecordIds: kept.map((record) => record.id),
		}))
	}, [items, agent.commands, markItems])

	const keptCount = useMemo(
		() => new Set(items.flatMap((item) => item.keptRecordIds ?? [])).size,
		[items]
	)

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
			{keptCount > 0 && (
				<div className="chat-history-change-kept">
					{acceptance === 'rejected'
						? `Kept ${keptCount === 1 ? 'one shape' : `${keptCount} shapes`} you changed after the agent.`
						: `Left ${keptCount === 1 ? 'one shape' : `${keptCount} shapes`} as you changed them.`}
				</div>
			)}
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
