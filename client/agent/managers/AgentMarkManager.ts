import { atom, b64Vecs, Box, BoxModel, createShapeId, Editor, TLShapeId, VecModel } from 'tldraw'
import { convertTldrawShapeToFocusedShape } from '../../../shared/format/convertTldrawShapeToFocusedShape'
import { classifyStroke, findMarkTargets, MARK_INTENTS, MarkKind } from '../marks'
import { BaseAgentManager } from './BaseAgentManager'

/** The mark's stroke is drawn at this scale of the pen's smallest size. */
const MARK_SCALE = 0.7

/** How long the "Ask about this" chip stays after a pen circle. */
const CHIP_MS = 4000

/** What the board stores on a mark's stroke, so threads and bindings can find it later. */
export interface MarkMeta {
	id: string
	kind: MarkKind
	targetIds: TLShapeId[]
	question: string | null
}

/** A mark the user is composing: drawn, with an inferred target, not yet asked. */
export interface MarkDraft {
	id: string
	kind: MarkKind
	/** Page bounds of the stroke, or of the target for a tap. */
	bounds: BoxModel
	/** The stroke on the board, or null for a tap. */
	shapeId: TLShapeId | null
	targetIds: TLShapeId[]
	/** True when the stroke is the user's own pen drawing, which dropping the mark must keep. */
	adopted?: boolean
}

/** The mark the current request is about, sent to the model with a crop of its region. */
export interface ActiveMark extends MarkDraft {
	text: string
}

/**
 * Marks: the user circles, underlines, strikes through, scribbles on, or taps
 * something, and asks about it. The app infers the target and shows it; the
 * user can add or remove targets before asking. Every board change goes
 * through the command model as a user command.
 */
export class AgentMarkManager extends BaseAgentManager {
	private $draft = atom<MarkDraft | null>('mark draft', null)
	private $stroke = atom<VecModel[] | null>('mark stroke', null)
	private active: ActiveMark | null = null
	/** A mark asked about, waiting for its request to start. */
	private pending: ActiveMark | null = null
	/** A pen circle the user just drew, offered as a mark for a few seconds. */
	private $chip = atom<{ shapeId: TLShapeId; bounds: BoxModel } | null>('mark chip', null)
	private chipTimeout: ReturnType<typeof setTimeout> | null = null

	constructor(agent: ConstructorParameters<typeof BaseAgentManager>[0]) {
		super(agent)
		const { editor } = agent
		// When the user finishes a pen circle around something, offer to ask about
		// it. The offer never asks by itself: only a tap on the chip does.
		this.disposables.add(
			editor.store.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
				if (source !== 'user' || next.type !== 'draw' || this.agent.getIsActingOnEditor()) return
				const wasComplete = (prev.props as { isComplete?: boolean }).isComplete
				const isComplete = (next.props as { isComplete?: boolean }).isComplete
				if (wasComplete || !isComplete || next.meta.mark) return
				const points = getDrawPagePoints(editor, next.id)
				if (points.length < 8 || classifyStroke(editor, points) !== 'circle') return
				if (findMarkTargets(editor, points, 'circle').filter((id) => id !== next.id).length === 0) return
				const bounds = editor.getShapePageBounds(next.id)
				if (bounds) this.offerChip(next.id, bounds.toJson())
			})
		)
	}

	/** The pen circle offered as a mark right now, if any. */
	getChip() {
		return this.$chip.get()
	}

	private offerChip(shapeId: TLShapeId, bounds: BoxModel) {
		this.$chip.set({ shapeId, bounds })
		if (this.chipTimeout) clearTimeout(this.chipTimeout)
		this.chipTimeout = setTimeout(() => this.dismissChip(), CHIP_MS)
	}

	dismissChip() {
		this.$chip.set(null)
		if (this.chipTimeout) clearTimeout(this.chipTimeout)
		this.chipTimeout = null
	}

	/** Tap on the chip: the pen circle becomes a mark and the question box opens. */
	acceptChip() {
		const chip = this.$chip.get()
		this.dismissChip()
		if (!chip) return
		this.adoptStroke(chip.shapeId)
		// The Mark tool lets the user click shapes to fix the target.
		this.agent.editor.setCurrentTool('mark')
	}

	reset(): void {
		this.$draft.set(null)
		this.$stroke.set(null)
		this.active = null
		this.pending = null
		this.dismissChip()
	}

	getDraft(): MarkDraft | null {
		return this.$draft.get()
	}

	/** The stroke being drawn right now, in page points, for the live preview. */
	getStroke(): VecModel[] | null {
		return this.$stroke.get()
	}

	setStroke(points: VecModel[] | null) {
		this.$stroke.set(points)
	}

	/** The mark the current request asks about, if any. */
	getActive(): ActiveMark | null {
		return this.active
	}

	/**
	 * A user request takes the pending mark, or clears the last one. The agent's
	 * own follow-up passes keep the mark, so continuations still know what it is about.
	 */
	onRequestStart(source: string) {
		if (source === 'self') return
		this.active = this.pending
		this.pending = null
	}

	/** Finish a stroke: classify it, find its targets, keep it on the board, and open the composer. */
	finishStroke(points: VecModel[]) {
		const { editor } = this.agent
		this.$stroke.set(null)
		this.cancelDraft()
		const kind = classifyStroke(editor, points)
		const targetIds = findMarkTargets(editor, points, kind)
		const id = `mark-${Date.now().toString(36)}`

		let shapeId: TLShapeId | null = null
		let bounds: BoxModel = Box.FromPoints(points).toJson()
		if (kind === 'tap') {
			const target = targetIds[0] ? editor.getShapePageBounds(targetIds[0]) : null
			if (!target) return
			bounds = target.toJson()
		} else {
			shapeId = createShapeId(id)
			const origin = points[0]
			const meta: MarkMeta = { id, kind, targetIds, question: null }
			this.agent.commands.execute('user', 'mark', () => {
				editor.createShape({
					id: shapeId!,
					// A thin dashed red-pencil stroke: a teacher's circle, and clearly not part of the drawing.
					type: 'draw',
					x: origin.x,
					y: origin.y,
					props: {
						color: 'red',
						size: 's',
						dash: 'dashed',
						// Thinner than the pen's smallest size, to match the pencil preview.
						scale: MARK_SCALE,
						isComplete: true,
						segments: [
							{
								type: 'free',
								path: b64Vecs.encodePoints(
									points.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y, z: 0.5 }))
								),
							},
						],
					},
					meta: { mark: meta as unknown as Record<string, never> },
				})
			})
		}
		this.$draft.set({ id, kind, bounds, shapeId, targetIds })
	}

	/**
	 * Turn a circle the user drew with the ordinary pen into a mark, after they
	 * tap its "Ask about this" chip. The drawing stays theirs; dropping the mark
	 * keeps it.
	 */
	adoptStroke(shapeId: TLShapeId) {
		const { editor } = this.agent
		const shape = editor.getShape(shapeId)
		const bounds = editor.getShapePageBounds(shapeId)
		if (!shape || !bounds) return
		this.cancelDraft()
		const points = getDrawPagePoints(editor, shapeId)
		const kind = classifyStroke(editor, points)
		const targetIds = findMarkTargets(editor, points, kind).filter((id) => id !== shapeId)
		this.$draft.set({ id: `mark-${Date.now().toString(36)}`, kind, bounds: bounds.toJson(), shapeId, targetIds, adopted: true })
	}

	/** Add a shape to the draft's targets, or take it out. */
	toggleTarget(shapeId: TLShapeId) {
		const draft = this.$draft.get()
		if (!draft) return
		const shape = this.agent.editor.getShape(shapeId)
		if (!shape || shape.meta.mark || shape.id === draft.shapeId) return
		const targetIds = draft.targetIds.includes(shapeId)
			? draft.targetIds.filter((id) => id !== shapeId)
			: [...draft.targetIds, shapeId]
		this.$draft.set({ ...draft, targetIds })
	}

	/** Drop the draft and its stroke. */
	cancelDraft() {
		const draft = this.$draft.get()
		if (!draft) return
		this.$draft.set(null)
		const { editor } = this.agent
		if (draft.shapeId && !draft.adopted && editor.getShape(draft.shapeId)) {
			this.agent.commands.execute('user', 'mark-cancel', () => editor.deleteShapes([draft.shapeId!]))
		}
	}

	/** Ask about the draft. With no text, the kind of mark is the question. */
	ask(text: string) {
		const draft = this.$draft.get()
		if (!draft) return
		const { editor } = this.agent
		const question = text.trim() || MARK_INTENTS[draft.kind]
		this.$draft.set(null)

		const targetIds = draft.targetIds.filter((id) => editor.getShape(id))
		if (draft.shapeId && editor.getShape(draft.shapeId)) {
			this.agent.commands.execute('user', 'mark-ask', () => {
				const shape = editor.getShape(draft.shapeId!)!
				const meta: MarkMeta = { id: draft.id, kind: draft.kind, targetIds, question }
				editor.updateShape({ id: shape.id, type: shape.type, meta: { ...shape.meta, mark: meta as unknown as Record<string, never> } })
			})
		}

		const shapes = targetIds
			.map((id) => editor.getShape(id))
			.filter((s) => !!s)
			.map((s) => convertTldrawShapeToFocusedShape(editor, s))
		this.pending = { ...draft, targetIds, text: question }
		// The targets go with this request only, as user context, so the agent may
		// change them if the question asks it to. Like the chat input, a new
		// question interrupts any request still running.
		this.agent.interrupt({
			input: {
				agentMessages: [question],
				userMessages: [text.trim() || `(${draft.kind}) ${question}`],
				bounds: editor.getViewportPageBounds(),
				source: 'user',
				contextItems: shapes.length > 0 ? [{ type: 'shapes', shapes, source: 'user' }] : [],
			},
		})
	}
}

/** The page points of a draw shape's first stroke. */
export function getDrawPagePoints(editor: Editor, shapeId: TLShapeId): VecModel[] {
	const shape = editor.getShape(shapeId)
	if (!shape || shape.type !== 'draw') return []
	const transform = editor.getShapePageTransform(shapeId)
	const segments = (shape.props as { segments: { path: string; dim?: 2 | 3 }[] }).segments
	return segments.flatMap((segment) => b64Vecs.decodePoints(segment.path, segment.dim).map((p) => transform.applyToPoint(p)))
}
