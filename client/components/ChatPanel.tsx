import { FormEventHandler, useCallback, useEffect, useRef, useState } from 'react'
import { useValue } from 'tldraw'
import { NibIcon } from '../../shared/icons/NibIcon'
import { answerQuestion, getOpenQuestion } from '../agent/openQuestion'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ChatHistory } from './chat-history/ChatHistory'
import { ChatInput } from './ChatInput'
import { TodoList } from './TodoList'

/**
 * The agent pane has four states, so the board stays the main workspace:
 * - ball: a small pencil-nib ball in the corner while you work on the board
 * - quiet: only the composer, floating over the board
 * - responding: the composer with the latest answer above it, after you send
 * - expanded: the docked panel with the whole conversation
 * Sending reveals the answer; it never opens the full panel. The answer stays
 * until you close it, and the draft and conversation carry across states.
 */
type PaneState = 'ball' | 'quiet' | 'responding' | 'expanded'

const PANE_KEY = 'easel.pane'

/**
 * The expanded panel is remembered. Otherwise the pane starts as a ball, except
 * the very first time, when it starts as the composer so it is easy to find.
 */
function loadPane(): PaneState {
	try {
		const saved = localStorage.getItem(PANE_KEY)
		if (saved === 'expanded') return 'expanded'
		return saved === null ? 'quiet' : 'ball'
	} catch {
		return 'quiet'
	}
}

function savePane(state: PaneState) {
	try {
		localStorage.setItem(PANE_KEY, state === 'expanded' ? 'expanded' : 'ball')
	} catch {
		// Storage can be unavailable; the pane still works, it just won't remember.
	}
}

export function ChatPanel() {
	const agent = useAgent()
	const inputRef = useRef<HTMLTextAreaElement>(null)
	const [pane, setPaneState] = useState<PaneState>(loadPane)
	const [draft, setDraft] = useState('')
	const [unread, setUnread] = useState(false)
	const paneRef = useRef(pane)
	paneRef.current = pane
	const setPane = useCallback((state: PaneState) => {
		setPaneState(state)
		savePane(state)
		if (state !== 'ball') setUnread(false)
	}, [])
	const isGenerating = useValue('pane generating', () => agent.requests.isGenerating(), [agent])

	// Open the composer and put the cursor in it.
	const openComposer = useCallback(() => {
		setPane('quiet')
		requestAnimationFrame(() => inputRef.current?.focus())
	}, [setPane])

	// The composer folds back into the ball when the user goes back to the board,
	// but never with a draft in it and never while an answer is open.
	useEffect(() => {
		if (pane !== 'quiet' || draft !== '') return
		const handlePointerDown = (event: PointerEvent) => {
			const target = event.target as HTMLElement | null
			if (target?.closest('.chat-panel')) return
			setPane('ball')
		}
		window.addEventListener('pointerdown', handlePointerDown, { capture: true })
		return () => window.removeEventListener('pointerdown', handlePointerDown, { capture: true })
	}, [pane, draft, setPane])

	// A question from the agent must be seen to be answered, whatever started the
	// request, so an open question brings up the answer view.
	const hasOpenQuestion = useValue('pane open question', () => getOpenQuestion(agent.chat.getHistory()) !== null, [agent])
	useEffect(() => {
		if (hasOpenQuestion && (pane === 'ball' || pane === 'quiet')) setPaneState('responding')
	}, [hasOpenQuestion, pane])

	// When a chat answer finishes while the pane is a ball, the ball shows a dot.
	// Answers to marks land on the board beside the mark, so they need no dot.
	const wasGenerating = useRef(false)
	useEffect(() => {
		if (wasGenerating.current && !isGenerating && pane === 'ball' && !agent.marks.getActive()) setUnread(true)
		wasGenerating.current = isGenerating
	}, [isGenerating, pane, agent])

	// "/" puts the cursor in the composer from anywhere on the board.
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
			const target = event.target as HTMLElement | null
			if (target?.closest('input, textarea, [contenteditable="true"]')) return
			if (agent.editor.getEditingShapeId()) return
			event.preventDefault()
			// From the ball, open the composer. Otherwise keep the pane as it is.
			if (paneRef.current === 'ball') openComposer()
			else inputRef.current?.focus()
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [agent, openComposer])

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
			// Only a question the user can see is answered by a number key.
			if (paneRef.current === 'ball' || paneRef.current === 'quiet') return
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

			// Sending reveals the answer above the composer, unless the full panel is open.
			setPaneState((state) => (state === 'expanded' ? state : 'responding'))

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

	const composer = (
		<div className="chat-input-container">
			<TodoList agent={agent} />
			<ChatInput
				handleSubmit={handleSubmit}
				inputRef={inputRef}
				value={draft}
				onChange={setDraft}
				onEscape={pane === 'responding' ? () => setPane('quiet') : undefined}
			/>
		</div>
	)

	if (pane === 'ball') {
		return (
			<div className="chat-panel chat-panel--floating chat-panel--ball tl-theme__light">
				<button
					className={'chat-ball' + (isGenerating ? ' chat-ball--working' : '')}
					aria-label={unread ? 'Ask Easel (an answer is waiting)' : 'Ask Easel'}
					title="Ask Easel (/)"
					onClick={() => (unread ? setPane('responding') : openComposer())}
				>
					<NibIcon size={20} />
					{unread && <span className="chat-ball-dot" aria-hidden />}
				</button>
			</div>
		)
	}

	if (pane !== 'expanded') {
		return (
			<div className="chat-panel chat-panel--floating tl-theme__light">
				{pane === 'responding' && !isEmpty && (
					<div className="chat-answer">
						<div className="chat-answer-controls">
							<button className="chat-icon-button" title="Open the conversation" aria-label="Open the conversation" onClick={() => setPane('expanded')}>
								<ExpandGlyph />
							</button>
							<button className="chat-icon-button" title="Close" aria-label="Close" onClick={() => setPane('quiet')}>
								<CloseGlyph />
							</button>
						</div>
						<ChatHistory agent={agent} latestOnly />
					</div>
				)}
				{composer}
				{pane === 'quiet' && !isEmpty && (
					<button className="chat-quiet-open" onClick={() => setPane('expanded')}>
						Conversation
					</button>
				)}
			</div>
		)
	}

	return (
		<div className="chat-panel tl-theme__light">
			<div className="chat-header">
				<span className="chat-wordmark">Easel</span>
				<span className="chat-header-actions">
					<button className="new-chat-button" onClick={handleNewChat}>
						New chat
					</button>
					<button className="chat-icon-button" title="Close the conversation" aria-label="Close the conversation" onClick={() => setPane('quiet')}>
						<CollapseGlyph />
					</button>
				</span>
			</div>
			{isEmpty ? (
				<div className="chat-empty">
					<p className="chat-empty-hint">Ask a question, or mark something on the board and ask about it.</p>
				</div>
			) : (
				<ChatHistory agent={agent} />
			)}
			{composer}
		</div>
	)
}

/** Fine-stroke glyphs that match the toolbar: 1.5 px on a 24 px grid. */
function Glyph({ children }: { children: React.ReactNode }) {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			{children}
		</svg>
	)
}

function ExpandGlyph() {
	return (
		<Glyph>
			<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
		</Glyph>
	)
}

function CollapseGlyph() {
	return (
		<Glyph>
			<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
		</Glyph>
	)
}

function CloseGlyph() {
	return (
		<Glyph>
			<path d="M18 6 6 18M6 6l12 12" />
		</Glyph>
	)
}

