import { FormEventHandler, useState } from 'react'
import { useValue } from 'tldraw'
import { MarkIcon } from '../../shared/icons/MarkIcon'
import { BrainIcon } from '../../shared/icons/BrainIcon'
import { ChevronDownIcon } from '../../shared/icons/ChevronDownIcon'
import { AGENT_MODEL_DEFINITIONS, AgentModelName } from '../../shared/models'
import { getOpenQuestion } from '../agent/openQuestion'
import { useAgent } from '../agent/TldrawAgentAppProvider'
import { ContextItemTag } from './ContextItemTag'
import { SelectionTag } from './SelectionTag'

export function ChatInput({
	handleSubmit,
	inputRef,
}: {
	handleSubmit: FormEventHandler<HTMLFormElement>
	inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
	const agent = useAgent()
	const { editor } = agent
	const [inputValue, setInputValue] = useState('')
	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])

	const isContextToolActive = useValue(
		'isContextToolActive',
		() => {
			const tool = editor.getCurrentTool()
			return tool.id === 'mark'
		},
		[editor]
	)

	const selectedShapes = useValue('selectedShapes', () => editor.getSelectedShapes(), [editor])
	const contextItems = useValue('contextItems', () => agent.context.getItems(), [agent])
	const modelName = useValue('modelName', () => agent.modelName.getModelName(), [agent])
	const hasOpenQuestion = useValue('has open question', () => getOpenQuestion(agent.chat.getHistory()) !== null, [agent])

	return (
		<div className="chat-input">
			<form
				onSubmit={(e) => {
					e.preventDefault()
					setInputValue('')
					handleSubmit(e)
				}}
			>
				<div className="prompt-tags">
					<button
						type="button"
						className={'chat-context-select ' + (isContextToolActive ? 'active' : '')}
						title="Mark something on the board to ask about it (M)"
						onClick={() => {
							editor.setCurrentTool(isContextToolActive ? 'select' : 'mark')
							editor.focus()
						}}
					>
						<span className="chat-context-select-label">
							<MarkIcon /> Mark
						</span>
					</button>
					{selectedShapes.length > 0 && <SelectionTag onClick={() => editor.selectNone()} />}
					{contextItems.map((item, i) => (
						<ContextItemTag
							editor={editor}
							onClick={() => agent.context.remove(item)}
							key={'context-item-' + i}
							item={item}
						/>
					))}
				</div>

				<textarea
					ref={inputRef}
					name="input"
					autoComplete="off"
					placeholder={hasOpenQuestion ? 'Pick a choice above, or type your answer' : 'Ask, learn, brainstorm, draw'}
					value={inputValue}
					onInput={(e) => setInputValue(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault()
							//idk about this but it works oops -max
							const form = e.currentTarget.closest('form')
							if (form) {
								const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
								form.dispatchEvent(submitEvent)
							}
						}
					}}
				/>
				<span className="chat-actions">
					<div className="chat-actions-left">
						<div className="chat-model-select">
							<div className="chat-model-select-label">
								<BrainIcon /> {modelName}
							</div>
							<select
								value={modelName}
								onChange={(e) => agent.modelName.setModelName(e.target.value as AgentModelName)}
							>
								{Object.values(AGENT_MODEL_DEFINITIONS).map((model) => (
									<option key={model.name} value={model.name}>
										{model.name}
									</option>
								))}
							</select>
							<ChevronDownIcon />
						</div>
					</div>
					<button className="chat-input-submit" disabled={inputValue === '' && !isGenerating}>
						{isGenerating && inputValue === '' ? '◼' : '⬆'}
					</button>
				</span>
			</form>
		</div>
	)
}
