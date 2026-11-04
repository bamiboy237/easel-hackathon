import { useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import { useValue } from 'tldraw'
import { AgentIcon } from '../../../shared/icons/AgentIcon'
import { ChevronDownIcon } from '../../../shared/icons/ChevronDownIcon'
import { ChevronRightIcon } from '../../../shared/icons/ChevronRightIcon'
import { AgentAction } from '../../../shared/types/AgentAction'
import { ChatHistoryActionItem } from '../../../shared/types/ChatHistoryItem'
import { Streaming } from '../../../shared/types/Streaming'
import { answerQuestion, getOpenQuestion } from '../../agent/openQuestion'
import { useAgent } from '../../agent/TldrawAgentAppProvider'
import { ChatHistoryGroup } from './ChatHistoryGroup'
import { getActionInfo } from './getActionInfo'

export function ChatHistoryGroupWithoutDiff({ group }: { group: ChatHistoryGroup }) {
	const agent = useAgent()
	const { items } = group

	const nonEmptyItems = useMemo(() => {
		return items.filter((item) => {
			const { description } = getActionInfo(item.action, agent)
			return description !== null
		})
	}, [items, agent])

	if (nonEmptyItems.length === 0) {
		return null
	}

	return (
		<div className="chat-history-group">
			{nonEmptyItems.map((item, i) => {
				return <ChatHistoryItem item={item} key={'action-' + i} />
			})}
		</div>
	)
}

function ChatHistoryItem({ item }: { item: ChatHistoryActionItem }) {
	if (item.action._type === 'ask') return <AskCard item={item} />
	return <ChatHistoryActionRow item={item} />
}

/**
 * The agent's question, with its choices as buttons. A choice, or a typed
 * reply, starts the next request. Choices turn off once the user has answered.
 */
function AskCard({ item }: { item: ChatHistoryActionItem }) {
	const agent = useAgent()
	const history = useValue('chat history', () => agent.chat.getHistory(), [agent])
	const isGenerating = useValue('is generating', () => agent.requests.isGenerating(), [agent])
	const action = item.action as Streaming<Extract<AgentAction, { _type: 'ask' }>>
	const question = action.question ?? ''
	const choices = action.complete ? (action.choices ?? []) : []
	const isOpen = getOpenQuestion(history)?.item === item

	return (
		<div className="agent-ask">
			<div className="agent-ask-question">
				<Markdown>{question}</Markdown>
			</div>
			{choices.length > 0 && (
				<div className="agent-ask-choices">
					{choices.map((choice, i) => (
						<button
							key={choice}
							disabled={!isOpen || isGenerating}
							onClick={() => void answerQuestion(agent, question, choice)}
						>
							{isOpen && <span className="agent-ask-key">{i + 1}</span>}
							{choice}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

function ChatHistoryActionRow({ item }: { item: ChatHistoryActionItem }) {
	const agent = useAgent()
	const { action } = item
	const { description, summary } = getActionInfo(action, agent)
	const collapsible = summary !== null
	const [collapsed, setCollapsed] = useState(collapsible)

	if (!description) return null

	return (
		<div className="agent-actions-container">
			{action.complete && collapsible && (
				<button onClick={() => setCollapsed((v) => !v)}>
					<span>{collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}</span>
					{summary}
				</button>
			)}

			{(!collapsed || !action.complete) && <ChatHistoryItemExpanded action={action} />}
		</div>
	)
}

function ChatHistoryItemExpanded({ action }: { action: Streaming<AgentAction> }) {
	const agent = useAgent()
	const { icon, description } = getActionInfo(action, agent)

	return (
		<div className={`agent-action agent-action-type-${action._type}`}>
			{icon && (
				<span>
					<AgentIcon type={icon} />
				</span>
			)}
			<span className="agent-action-description">
				<Markdown>{description}</Markdown>
			</span>
		</div>
	)
}
