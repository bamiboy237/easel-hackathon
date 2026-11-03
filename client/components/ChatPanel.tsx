import { FormEventHandler, useCallback, useEffect, useRef } from 'react'
import { useValue } from 'tldraw'
import { answerQuestion, getOpenQuestion } from '../agent/openQuestion'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { TodoList } from './TodoList'

export function ChatPanel() {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)

	// While the agent waits on a question, the number keys pick its choices,
	// unless the user is typing somewhere.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
			const index = Number(event.key) - 1
			if (!Number.isInteger(index) || index < 0 || index > 3) return
			const target = event.target as HTMLElement | null
			if (target?.closest('input, textarea, [contenteditable="true"]')) return
			if (agent.editor.getEditingShapeId() || agent.requests.isGenerating()) return
			const open = getOpenQuestion(agent.chat.getHistory())
			const choice = open?.choices[index]
			if (!open || !choice) return
			event.preventDefault()
			event.stopPropagation()
			void answerQuestion(agent, open.question, choice)
		}
		window.addEventListener('keydown', handleKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
	}, [agent])

	const handleSubmit = useCallback<FormEventHandler<HTMLFormElement>>(
		async (e) => {
			e.preventDefault()
			if (!inputRef.current) return
			const formData = new FormData(e.currentTarget)
			const value = formData.get('input') as string

			// If the user's message is empty, just cancel the current request (if there is one)
			if (value === '') {
				agent.cancel()
				return
			}

			// Clear the chat input (context is cleared after it's captured in requestAgentActions)
			inputRef.current.value = ''

			// Sending a new message to the agent should interrupt the current request
			agent.interrupt({
				input: {
					agentMessages: [value],
					bounds: agent.editor.getViewportPageBounds(),
					source: 'user',
					contextItems: agent.context.getItems(),
				},
			})
		},
		[agent]
	)

	const handleNewChat = useCallback(() => {
		agent.reset()
	}, [agent])

	const isEmpty = useValue('chat is empty', () => agent.chat.getHistory().length === 0, [agent])

	return (
		<div className="chat-panel tl-theme__light">
			<div className="chat-header">
				<span className="chat-wordmark">Easel</span>
				<button className="new-chat-button" onClick={handleNewChat}>
					+ New chat
				</button>
			</div>
			{isEmpty ? (
				<div className="chat-empty">
					<p className="chat-empty-hint">
						Ask a question, or select something on the board and ask about it.
					</p>
				</div>
			) : (
				<ChatHistory agent={agent} />
			)}
			<div className="chat-input-container">
				<TodoList agent={agent} />
				<ChatInput handleSubmit={handleSubmit} inputRef={inputRef} />
			</div>
		</div>
	)
}
