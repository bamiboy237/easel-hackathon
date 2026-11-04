import { useEffect, useState } from 'react'
import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
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
	/** Folded to a small pin at its mark, out of the way. */
	folded: boolean
	/** The user marked the question answered. A resolved thread is a pin with a check. */
	resolved: boolean
}

declare module 'tldraw' {
	export interface TLGlobalShapePropsMap {
		[THREAD_TYPE]: ThreadShapeProps
	}
}

export type ThreadShape = TLShape<typeof THREAD_TYPE>

const versions = createShapePropsMigrationIds(THREAD_TYPE, { AddFold: 1 })

/** Threads saved before pins existed open, unresolved. */
const threadMigrations = createShapePropsMigrationSequence({
	sequence: [
		{
			id: versions.AddFold,
			up(props) {
				props.folded = false
				props.resolved = false
			},
			down(props) {
				delete props.folded
				delete props.resolved
			},
		},
	],
})

/**
 * Threads that just landed, folded, or opened, so they settle in once. The
 * canvas hides a shape that scrolls out of view with display: none, which
 * restarts a CSS animation when it shows again, so the class that animates
 * comes off once the view has settled.
 */
const freshViews = new Map<string, ReturnType<typeof setTimeout>>()
/** A little longer than the settle animations. */
const SETTLE_MS = 400

/** Let a thread's next view settle in: a new note, a pin, or a note opened from its pin. */
export function markThreadFresh(id: string) {
	const previous = freshViews.get(id)
	if (previous) clearTimeout(previous)
	freshViews.set(id, setTimeout(() => freshViews.delete(id), 1000))
}

/** Whether a view is settling in: true from its mount, if it is fresh, until it has settled. */
function useFresh(id: string) {
	const [fresh, setFresh] = useState(() => freshViews.has(id))
	useEffect(() => {
		if (!fresh) return
		const timer = setTimeout(() => setFresh(false), SETTLE_MS)
		return () => clearTimeout(timer)
	}, [fresh])
	return fresh
}

/** A folded thread's pin, in page units. */
export const PIN_SIZE = 26

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
		folded: T.boolean,
		resolved: T.boolean,
	}
	static override migrations = threadMigrations

	override getDefaultProps(): ThreadShapeProps {
		return { w: THREAD_WIDTH, h: PAD_TOP + 2 * RULE + PAD_BOTTOM, kind: 'circle', markShapeId: '', targetIds: [], entries: [], detached: false, folded: false, resolved: false }
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
		if (shape.props.folded) path.arc(shape.props.w / 2, shape.props.h / 2, shape.props.w / 2, 0, Math.PI * 2)
		else path.roundRect(0, 0, shape.props.w, shape.props.h, 3)
		return path
	}
}

/**
 * A folded thread: a small red-pencil pin at its mark. It shows how many
 * questions the thread holds, or a check once resolved. Clicking it opens the
 * note again.
 */
function ThreadPin({ shape }: { shape: ThreadShape }) {
	const editor = useEditor()
	const questions = shape.props.entries.filter((entry) => entry.author === 'user').length
	const first = shape.props.entries.find((entry) => entry.author === 'user')?.text ?? ''
	const fresh = useFresh(shape.id)
	return (
		<HTMLContainer className="thread-note-container">
			<button
				className={'thread-pin' + (shape.props.resolved ? ' thread-pin--resolved' : '') + (fresh ? ' thread-pin--fresh' : '')}
				style={{ width: shape.props.w, height: shape.props.h }}
				title={first}
				aria-label={(shape.props.resolved ? 'Resolved: ' : 'Folded question: ') + first}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => agentOf(editor)?.marks.openThread(shape.id)}
			>
				{shape.props.resolved ? <CheckGlyph /> : questions}
			</button>
		</HTMLContainer>
	)
}

function ThreadNote({ shape }: { shape: ThreadShape }) {
	if (shape.props.folded) return <ThreadPin shape={shape} />
	return <OpenThreadNote shape={shape} />
}

function OpenThreadNote({ shape }: { shape: ThreadShape }) {
	const editor = useEditor()
	const fresh = useFresh(shape.id)
	const isSelected = useValue('thread selected', () => editor.getOnlySelectedShapeId() === shape.id, [editor, shape.id])
	// The thread is busy while the agent answers in it. A follow-up then would be
	// lost when the answer's preview is rolled back, so it waits.
	const busy = useValue(
		'thread busy',
		() => {
			const agent = agentOf(editor)
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
				className={'thread-note' + (detached ? ' thread-note--detached' : '') + (fresh ? ' thread-note--fresh' : '')}
				style={{ width: w, height: h }}
			>
				{!busy && (
					<div className="thread-note-controls" onPointerDown={(e) => e.stopPropagation()}>
						<button title="Fold" aria-label="Fold" onClick={() => agentOf(editor)?.marks.foldThread(shape.id)}>
							<FoldGlyph />
						</button>
						<button title="Resolve" aria-label="Resolve" onClick={() => agentOf(editor)?.marks.resolveThread(shape.id)}>
							<CheckGlyph />
						</button>
					</div>
				)}
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
				{extra === 'detached' && <p className="thread-entry thread-entry--quiet">Its shape was deleted</p>}
				{extra === 'follow-up' && (
					<form
						className="thread-follow-up"
						onPointerDown={(e) => e.stopPropagation()}
						onSubmit={(e) => {
							e.preventDefault()
							const agent = agentOf(editor)
							if (!agent || !text.trim()) return
							agent.marks.followUp(shape.id, text)
							setText('')
						}}
					>
						<input
							value={text}
							placeholder="Reply"
							onChange={(e) => setText(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
						/>
					</form>
				)}
			</div>
		</HTMLContainer>
	)
}

function agentOf(editor: Editor) {
	return AgentAppAgentsManager.getAgents(editor)[0]
}

/** Fine pencil glyphs for the note's controls and the resolved pin. */
function CheckGlyph() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M5 12.5 10 17.5 19 7" />
		</svg>
	)
}

function FoldGlyph() {
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
			<path d="M6 12h12" />
		</svg>
	)
}
