import { useLayoutEffect, useRef } from 'react'
import { useValue } from 'tldraw'
import { TldrawAgent } from '../../agent/TldrawAgent'
import { ChatHistorySection, getAgentHistorySections } from './ChatHistorySection'

/*
Chat history is stored as a list of history items.

Within the UI, we split this list of items into sections.
Each section contains a user prompt item, and all the agent's actions that follow it.

Each section is rendered as a separate component.
The model's actions are grouped together into collapsible groups if appropriate.


Here's an example of how the UI might look:

- Chat history
	- Section
		- Prompt
		- Action group
			- Action
			- Action
		- Action group
			- Action
	- Section
		- Prompt
		- Action group
			- Action

*/

/** With `latestOnly`, only the newest exchange shows: the compact answer above the composer. */
export function ChatHistory({ agent, latestOnly = false }: { agent: TldrawAgent; latestOnly?: boolean }) {
	const historyItems = useValue('chatHistory', () => agent.chat.getHistory(), [agent])
	const allSections = getAgentHistorySections(historyItems)
	const sections = latestOnly ? allSections.slice(-1) : allSections
	const historyRef = useRef<HTMLDivElement>(null)
	const lastPromptCount = useRef(-1)
	const promptCount = sections.length

	// When a new question is asked, scroll once so it sits at the top, with the
	// answer filling in below it. The view never follows the answer after that,
	// so reading is never pulled away while text streams in.
	useLayoutEffect(() => {
		const history = historyRef.current
		if (!history) return
		const first = lastPromptCount.current === -1
		const asked = promptCount > lastPromptCount.current
		lastPromptCount.current = promptCount
		if (!asked) return
		const sectionsEls = history.querySelectorAll<HTMLElement>('.chat-history-section')
		const last = sectionsEls[sectionsEls.length - 1]
		if (!last) return
		const top = last.offsetTop - parseFloat(getComputedStyle(history).paddingTop || '0')
		history.scrollTo({ top: Math.max(0, top), behavior: first ? 'instant' : 'smooth' })
	}, [promptCount])

	const isGenerating = useValue('isGenerating', () => agent.requests.isGenerating(), [agent])

	return (
		<div className="chat-history" ref={historyRef}>
			{sections.map((section, i) => {
				return (
					<ChatHistorySection
						key={'history-section-' + (allSections.length - sections.length + i)}
						section={section}
						loading={i === sections.length - 1 && isGenerating}
					/>
				)
			})}
		</div>
	)
}
