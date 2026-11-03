import { FormEventHandler, useCallback, useRef } from 'react'
import { useValue } from 'tldraw'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { TodoList } from './TodoList'

export function ChatPanel() {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)

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
