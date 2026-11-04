import { FormEventHandler, useLayoutEffect } from 'react'
import { useValue } from 'tldraw'
import { AGENT_MODEL_DEFINITIONS, AgentModelName } from '../../shared/models'
import { getOpenQuestion } from '../agent/openQuestion'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'

/** Six lines of 24 px. */
const MAX_INPUT_HEIGHT = 144

/**
 * The composer: one sheet with room to write. The context it will send shows
 * only when there is some, the model is a quiet word, and send is an arrow in
 * an ink circle. Marking lives in the toolbar.
 */
export function ChatInput({
	handleSubmit,
	inputRef,
	value,
	onChange,
	onEscape,
}: {
	handleSubmit: FormEventHandler<HTMLFormElement>
	inputRef: React.RefObject<HTMLTextAreaElement | null>
	/** The draft lives in the panel, so it survives the panel changing state. */
	value: string
	onChange: (value: string) => void
	onEscape?: () => void
}) {
	const agent = useAgent()
	const { editor } = agent
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])
	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const hasOpenQuestion = useValue('has open question', () => getOpenQuestion(agent.chat.getHistory()) !== null, [agent])
	const hasContext = selectedShapes.length > 0 || contextItems.length > 0

	// The composer starts as one line and grows with what is written, up to six
	// lines; past that it scrolls.
	useLayoutEffect(() => {
		const textarea = inputRef.current
		if (!textarea) return
		textarea.style.height = 'auto'
		textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT)}px`
	}, [value, inputRef])
	const stops = isGenerating && value === ''

	return (
		<div className="chat-input">
			<form
				// A click anywhere on the sheet, not only on the text, puts the cursor in it.
				onMouseDown={(e) => {
					if (e.target === e.currentTarget) {
						e.preventDefault()
						inputRef.current?.focus()
					}
				}}
				onSubmit={(e) => {
					e.preventDefault()
					handleSubmit(e)
					onChange('')
				}}
			>
				{hasContext && (
					<div className="prompt-tags">
						{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
						{contextItems.map((item, i) => (
							<ContextItemTag editor={editor} onClick={() => agent.context.remove(item)} key={'context-item-' + i} item={item} />
						))}
					</div>
				)}

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					rows={1}
					placeholder={hasOpenQuestion ? 'Pick a choice above, or type your answer' : 'Ask, or mark something on the board'}
					value={value}
					onChange={(e) => onChange(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Escape' && onEscape) {
							e.preventDefault()
							onEscape()
						}
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							e.currentTarget.closest('form')?.requestSubmit()
						}
					}}
				/>
				<span className="chat-actions">
					<label className="chat-model-select" title="Model">
						<span>{formatModelName(modelName)}</span>
						<select value={modelName} onChange={(e) => agent.modelName.setModelName(e.target.value as AgentModelName)}>
							{Object.values(AGENT_MODEL_DEFINITIONS).map((model) => (
								<option key={model.name} value={model.name}>
									{formatModelName(model.name)}
								</option>
							))}
						</select>
					</label>
					<button
						className="chat-input-submit"
						disabled={value === '' && !isGenerating}
						aria-label={stops ? 'Stop' : 'Send'}
						title={stops ? 'Stop' : 'Send'}
					>
						{stops ? <StopGlyph /> : <SendGlyph />}
					</button>
				</span>
			</form>
		</div>
	)
}

/** An arrow up, drawn with the same round pen as the toolbar icons. */
function SendGlyph() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M12 19V5" />
			<path d="m6 11 6-6 6 6" />
		</svg>
	)
}

function StopGlyph() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
			<rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
		</svg>
	)
}

/**
 * A model's ID as words: "muse-wonder-1.0" reads "Muse Wonder 1.0", "gpt-6.1-sol"
 * reads "GPT 6.1 Sol", and "claude-haiku-4-5" reads "Claude Haiku 4.5".
 */
export function formatModelName(name: string): string {
	const words: string[] = []
	for (const part of name.split('-')) {
		const previous = words[words.length - 1]
		if (/^\d+$/.test(part) && previous && /^[\d.]+$/.test(previous)) words[words.length - 1] = `${previous}.${part}`
		else words.push(part === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1))
	}
	return words.join(' ')
}
