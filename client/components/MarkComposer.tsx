import { useEffect, useRef, useState } from 'react'
import { Editor, renderPlaintextFromRichText, TLRichText, TLShapeId, useEditor, useValue } from 'tldraw'
import { MARK_INTENTS } from '../agent/marks'
import { useAgent } from '../agent/TldrawAgentAppProvider'

/** What the note is about, quoting the target's text when it has some: about "F = m a". */
function describeTargets(editor: Editor, ids: TLShapeId[]): string {
	if (ids.length === 0) return 'about this area'
	if (ids.length > 1) return `about ${ids.length} shapes`
	const shape = editor.getShape(ids[0])
	const richText = (shape?.props as { richText?: TLRichText } | undefined)?.richText
	const text = richText ? renderPlaintextFromRichText(editor, richText).trim().replace(/\s+/g, ' ') : ''
	if (!text) return shape?.type === 'image' ? 'about this image' : 'about this'
	return `about \u201c${text.length > 28 ? text.slice(0, 27) + '\u2026' : text}\u201d`
}

/**
 * The sticky note that opens beside a mark. Enter asks, Escape drops
 * the mark. With nothing typed, the kind of mark is the question.
 */
export function MarkComposer() {
	const editor = useEditor()
	const agent = useAgent()
	const draft = useValue('mark draft', () => agent.marks.getDraft(), [agent])
	const anchor = useValue(
		'mark composer anchor',
		() => {
			const d = agent.marks.getDraft()
			if (!d) return null
			// Beside the mark, so it never covers what is under or next to it.
			const p = editor.pageToViewport({ x: d.bounds.x + d.bounds.w, y: d.bounds.y })
			return { x: Math.round(p.x + 14), y: Math.round(p.y) }
		},
		[agent, editor]
	)
	const [text, setText] = useState('')
	const inputRef = useRef<HTMLInputElement>(null)
	const listening = useValue('mark listening', () => agent.marks.getListening(), [agent])
	const spoken = useValue('mark spoken', () => agent.marks.getSpoken(), [agent])

	useEffect(() => {
		setText('')
		if (draft) requestAnimationFrame(() => inputRef.current?.focus())
	}, [draft?.id])

	// The words fill the note as they are heard; the user can edit them before asking.
	useEffect(() => {
		if (spoken !== null) setText(spoken)
	}, [spoken])

	if (!draft || !anchor) return null
	const about = describeTargets(editor, draft.targetIds)

	return (
		<div
			className="mark-composer"
			style={{ left: anchor.x, top: anchor.y }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div className="mark-composer-label">
				<span>{about}</span>
				{(listening === 'listening' || listening === 'heard') && (
					// Only a small breathing dot shows the microphone is on; the words stay for screen readers.
					<span
						className={'mark-listening' + (listening === 'heard' ? ' mark-listening--heard' : '')}
						role="status"
						aria-label="Listening"
						title="Listening"
					>
						<span className="mark-listening-dot" aria-hidden />
					</span>
				)}
			</div>
			<form
				onSubmit={(e) => {
					e.preventDefault()
					agent.marks.ask(text)
				}}
			>
				<input
					ref={inputRef}
					value={text}
					placeholder={listening !== 'off' ? 'Say your question, or type it' : MARK_INTENTS[draft.kind]}
					onChange={(e) => {
						// Typing takes over from listening and keeps the words heard so far.
						if (listening !== 'off') agent.marks.stopListening()
						setText(e.target.value)
					}}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'Escape') {
							agent.marks.cancelDraft()
							editor.focus()
						}
					}}
				/>
			</form>
			<div className="mark-composer-hint">↵ ask · esc drop · click shapes to change</div>
		</div>
	)
}

/**
 * After the user circles something with the ordinary pen, a quiet chip offers
 * to ask about it for a few seconds. Ignoring it leaves the drawing as it is.
 */
export function MarkChip() {
	const editor = useEditor()
	const agent = useAgent()
	const anchor = useValue(
		'mark chip anchor',
		() => {
			const chip = agent.marks.getChip()
			if (!chip) return null
			const p = editor.pageToViewport({ x: chip.bounds.x + chip.bounds.w, y: chip.bounds.y })
			return { x: Math.round(p.x + 6), y: Math.round(p.y - 6) }
		},
		[agent, editor]
	)
	if (!anchor) return null
	return (
		<button
			type="button"
			className="mark-chip"
			style={{ left: anchor.x, top: anchor.y }}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={() => agent.marks.acceptChip()}
		>
			<span className="mark-chip-dot" aria-hidden />
			Ask about this
		</button>
	)
}
