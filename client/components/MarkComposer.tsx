import { useEffect, useRef, useState } from 'react'
import { Box, Editor, renderPlaintextFromRichText, TLRichText, TLShapeId, useEditor, useValue } from 'tldraw'
import { findNoteSpot } from '../agent/findClearSpace'
import { MARK_LABELS } from '../agent/marks'
import { useAgent } from '../agent/TldrawAgentAppProvider'

/** A shape's words, for naming it: its text, cut short, or null when it has none. */
function shapeName(editor: Editor, id: TLShapeId, max: number): string | null {
	const shape = editor.getShape(id)
	const richText = (shape?.props as { richText?: TLRichText } | undefined)?.richText
	const text = richText ? renderPlaintextFromRichText(editor, richText).trim().replace(/\s+/g, ' ') : ''
	if (!text) return null
	return `\u201c${text.length > max ? text.slice(0, max - 1) + '\u2026' : text}\u201d`
}

/** What the mark is about, by name: one or two shapes are named, more are counted. */
function describeTargets(editor: Editor, ids: TLShapeId[]): string {
	if (ids.length === 0) return 'about this area'
	if (ids.length === 1) {
		const name = shapeName(editor, ids[0], 28)
		if (name) return `about ${name}`
		return editor.getShape(ids[0])?.type === 'image' ? 'about this image' : 'about this'
	}
	if (ids.length === 2) {
		const names = ids.map((id) => shapeName(editor, id, 14))
		if (names.every(Boolean)) return `about ${names[0]} and ${names[1]}`
	}
	return `about ${ids.length} things`
}

/**
 * The sticky note that opens beside a mark. Enter asks, Escape drops
 * the mark. With nothing typed, the kind of mark is the question.
 */
/** The note's size on screen: as wide as a thread, so the question keeps its width when it becomes one. */
const NOTE_WIDTH = 280
const NOTE_HEIGHT = 120

export function MarkComposer() {
	const editor = useEditor()
	const agent = useAgent()
	const draft = useValue('mark draft', () => agent.marks.getDraft(), [agent])
	const anchor = useValue(
		'mark composer anchor',
		() => {
			const d = agent.marks.getDraft()
			if (!d) return null
			// Where the user dragged it, if they did.
			if (d.noteAt) {
				const p = editor.pageToViewport(d.noteAt)
				return { x: Math.round(p.x), y: Math.round(p.y) }
			}
			// In the nearest clear space beside the mark, the same search a thread
			// uses, so the question never covers what it asks about or what is next
			// to it. The note keeps its size on screen, so it is measured in page
			// units at the current zoom.
			const zoom = editor.getZoomLevel()
			const mark = Box.From(d.bounds)
			const ignore = d.shapeId ? [d.shapeId] : []
			const spot = findNoteSpot(editor, mark, { w: NOTE_WIDTH / zoom, h: NOTE_HEIGHT / zoom }, ignore)
			const p = editor.pageToViewport(spot ? { x: spot.x, y: spot.y } : { x: mark.maxX + 14 / zoom, y: mark.y })
			return { x: Math.round(p.x), y: Math.round(p.y) }
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

	// Escape drops the note wherever the keyboard is, not only in its text line:
	// the microphone prompt, or a click on the board to add a shape, can take
	// focus away from the note.
	useEffect(() => {
		if (!draft) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			agent.marks.cancelDraft()
			editor.focus()
		}
		window.addEventListener('keydown', handleKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
	}, [draft?.id, agent, editor])

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
			// The note moves like paper: drag it by anywhere but the line you write on.
			onPointerDown={(e) => {
				e.stopPropagation()
				if ((e.target as HTMLElement).closest('input, button')) return
				e.preventDefault()
				const start = { x: e.clientX, y: e.clientY }
				const screen = editor.getViewportScreenBounds()
				const from = editor.screenToPage({ x: anchor.x + screen.x, y: anchor.y + screen.y })
				const zoom = editor.getZoomLevel()
				const target = e.currentTarget
				target.setPointerCapture(e.pointerId)
				const move = (ev: PointerEvent) =>
					agent.marks.moveDraftNote({ x: from.x + (ev.clientX - start.x) / zoom, y: from.y + (ev.clientY - start.y) / zoom })
				const up = () => {
					target.removeEventListener('pointermove', move)
					target.removeEventListener('pointerup', up)
					inputRef.current?.focus()
				}
				target.addEventListener('pointermove', move)
				target.addEventListener('pointerup', up)
			}}
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
					placeholder={listening !== 'off' ? 'Say it, or type' : MARK_LABELS[draft.kind]}
					onChange={(e) => {
						// Typing takes over from listening and keeps the words heard so far.
						if (listening !== 'off') agent.marks.stopListening()
						setText(e.target.value)
					}}
					// Keys typed here are the user's words, not board shortcuts. Escape is handled above.
					onKeyDown={(e) => e.stopPropagation()}
				/>
			</form>
			<div className="mark-composer-hint">Enter to ask · Esc to cancel · Click to add</div>
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
