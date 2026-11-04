import { useState } from 'react'
import {
	Editor,
	Geometry2d,
	HTMLContainer,
	Rectangle2d,
	RecordProps,
	ShapeUtil,
	T,
	TLShape,
	useEditor,
	useValue,
} from 'tldraw'
import { AgentAppAgentsManager } from '../agent/managers/AgentAppAgentsManager'
import { isDetached } from './AnnotationBindingUtil'

export const THREAD_TYPE = 'thread'

/** One message in a thread: the user's question or the agent's answer. */
export interface ThreadEntry {
	author: 'user' | 'agent'
	text: string
}

export interface ThreadShapeProps {
	w: number
	h: number
	/** The mark the thread answers: its kind, stroke, and targets. */
	kind: string
	markShapeId: string
	targetIds: string[]
	entries: ThreadEntry[]
	/** Unused: whether a thread is detached is worked out from its bindings. Kept so saved boards still load. */
	detached: boolean
}

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[THREAD_TYPE]: ThreadShapeProps
	}
}

export type ThreadShape = TLShape<typeof THREAD_TYPE>

/** The note's ruled layout: every line of text sits on a 24 px rule. */
export const THREAD_WIDTH = 280
const RULE = 24
const PAD_TOP = 14
const PAD_BOTTOM = 14
const PAD_LEFT = 30
const PAD_RIGHT = 14
const TEXT_WIDTH = THREAD_WIDTH - PAD_LEFT - PAD_RIGHT

/** How tall a thread must be to hold its entries, each rounded up to whole rules. */
export function measureThreadHeight(editor: Editor, entries: ThreadEntry[]): number {
	let lines = 0
	for (const entry of entries) {
		const { h } = editor.textMeasure.measureText(entry.text || ' ', {
			fontFamily: "'Source Serif 4 Variable', Georgia, serif",
			fontSize: entry.author === 'user' ? 14 : 15,
			fontStyle: entry.author === 'user' ? 'italic' : 'normal',
			fontWeight: '400',
			lineHeight: RULE / (entry.author === 'user' ? 14 : 15),
			maxWidth: TEXT_WIDTH,
			padding: '0px',
		})
		lines += Math.max(1, Math.round(h / RULE))
	}
	// One spare rule at the bottom, like a notepad, holds the thinking dots, a
	// follow-up, or the detached note, so the note never jumps in size.
	return PAD_TOP + (Math.max(1, lines) + 1) * RULE + PAD_BOTTOM
}

/**
 * A thread: a mark's question and its answers, on a ruled sticky note beside
 * the mark. Selecting it opens a line for a follow-up question.
 */
export class ThreadShapeUtil extends ShapeUtil<ThreadShape> {
	static override type = THREAD_TYPE
	static override props: RecordProps<ThreadShape> = {
		w: T.number,
		h: T.number,
		kind: T.string,
		markShapeId: T.string,
		targetIds: T.arrayOf(T.string),
		entries: T.arrayOf(T.object({ author: T.literalEnum('user', 'agent'), text: T.string })),
		detached: T.boolean,
	}

	override getDefaultProps(): ThreadShapeProps {
		return { w: THREAD_WIDTH, h: PAD_TOP + 2 * RULE + PAD_BOTTOM, kind: 'circle', markShapeId: '', targetIds: [], entries: [], detached: false }
	}

	override canResize() {
		return false
	}

	override canEdit() {
		return false
	}

	override getGeometry(shape: ThreadShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override component(shape: ThreadShape) {
		return <ThreadNote shape={shape} />
	}

	override getIndicatorPath(shape: ThreadShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 3)
		return path
	}
}

function ThreadNote({ shape }: { shape: ThreadShape }) {
	const editor = useEditor()
	const isSelected = useValue('thread selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
	// The thread is busy while the agent answers in it. A follow-up then would be
	// lost when the answer's preview is rolled back, so it waits.
	const busy = useValue(
		'thread busy',
		() => {
			const agent = AgentAppAgentsManager.getAgents(editor)[0]
			if (!agent || !agent.requests.isGenerating()) return false
			return shape.props.entries.at(-1)?.author === 'user' || agent.marks.getActive()?.threadId === shape.id
		},
		[editor, shape.id, shape.props.entries]
	)
	const isThinking = busy && shape.props.entries.at(-1)?.author === 'user'
	const [text, setText] = useState('')
	const { w, h, entries } = shape.props
	// A thread is detached once none of the shapes it answered exist.
	const detached = useValue('thread detached', () => isDetached(editor, shape.id, shape.props.targetIds), [editor, shape.id, shape.props.targetIds])

	// One sheet of paper: the thinking line, a follow-up, or the detached note is
	// the last ruled line on the note itself, never a separate slip.
	const extra = isThinking ? 'thinking' : isSelected && !busy ? 'follow-up' : detached ? 'detached' : null

	return (
		<HTMLContainer className="thread-note-container">
			<div
				className={'thread-note' + (detached ? ' thread-note--detached' : '')}
				style={{ width: w, height: h }}
			>
				{entries.map((entry, i) => (
					<p key={i} className={`thread-entry thread-entry--${entry.author}`}>
						{entry.text}
					</p>
				))}
				{extra === 'thinking' && (
					<p className="thread-entry thread-entry--quiet" aria-label="Thinking">
						<span className="thread-thinking" aria-hidden>
							<span />
							<span />
							<span />
						</span>
					</p>
				)}
				{extra === 'detached' && <p className="thread-entry thread-entry--quiet">What this answered was deleted.</p>}
				{extra === 'follow-up' && (
					<form
						className="thread-follow-up"
						onPointerDown={(e) => e.stopPropagation()}
						onSubmit={(e) => {
							e.preventDefault()
							const agent = AgentAppAgentsManager.getAgents(editor)[0]
							if (!agent || !text.trim()) return
							agent.marks.followUp(shape.id, text)
							setText('')
						}}
					>
						<input
							value={text}
							placeholder="Ask a follow-up"
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
						/>
					</form>
				)}
			</div>
		</HTMLContainer>
	)
}
