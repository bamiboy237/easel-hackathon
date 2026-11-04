import { FormEventHandler } from 'react'
import { useValue } from 'tldraw'
import { NibIcon } from '../../shared/icons/NibIcon'
import { AGENT_MODEL_DEFINITIONS, AgentModelName } from '../../shared/models'
import { getOpenQuestion } from '../agent/openQuestion'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'

/**
 * The composer: one sheet with room to write. The context it will send shows
 * only when there is some, the model is a quiet word, and the one strong color
 * is the pencil-nib send button. Marking lives in the toolbar.
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
	const stops = isGenerating && value === ''

	return (
		<div className="chat-input">
			<form
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
					rows={2}
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
						<span>{modelName}</span>
						<select value={modelName} onChange={(e) => agent.modelName.setModelName(e.target.value as AgentModelName)}>
							{Object.values(AGENT_MODEL_DEFINITIONS).map((model) => (
								<option key={model.name} value={model.name}>
									{model.name}
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
						{stops ? <StopGlyph /> : <NibIcon />}
					</button>
				</span>
			</form>
		</div>
	)
}

function StopGlyph() {
	return (
		<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
			<rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
		</svg>
	)
}
