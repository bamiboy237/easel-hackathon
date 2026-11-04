import { Box, OverlayUtil, TLOverlay, TLShapeId, VecModel } from 'tldraw'
import { AgentAppAgentsManager } from '../agent/managers/AgentAppAgentsManager'
import { THREAD_TYPE, ThreadShape } from '../shapes/ThreadShapeUtil'

interface MarkOverlay extends TLOverlay {
	type: 'mark'
	props: { stroke: VecModel[] | null; targets: Box[]; connectors: Connector[] }
}

/** A line from a mark to its thread, drawn in full or as two short ticks. */
interface Connector {
	start: VecModel
	end: VecModel
	full: boolean
}

/** Longer connectors than this, in page units, show in full only on focus. */
const LONG_CONNECTOR = 160
/** The length of each end tick of a folded connector, in screen pixels. */
const TICK = 14

/** The board's red ink, the same as the mark the board keeps. */
const MARK_RED = '#AE3B2C'

/**
 * The live stroke while the user draws a mark, a faint wash behind each shape
 * the app thinks the mark points at, so the user can see and fix it, and a
 * dashed pencil line from each mark to its thread when they sit apart.
 */
export class MarkOverlayUtil extends OverlayUtil<MarkOverlay> {
	static override type = 'mark' as const
	override options = { zIndex: 710 }

	override isActive(): boolean {
		const marks = AgentAppAgentsManager.getAgents(this.editor)[0]?.marks
		if (!marks) return false
		return !!marks.getStroke() || !!marks.getDraft() || this.getThreads().length > 0
	}

	override getOverlays(): MarkOverlay[] {
		const marks = AgentAppAgentsManager.getAgents(this.editor)[0]?.marks
		if (!marks) return []
		const draft = marks.getDraft()
		// The mark itself shows what it encloses. Only shapes outside it, such as
		// ones the user clicked to add, get a wash so they read as included.
		const markBounds = draft ? Box.From(draft.bounds) : null
		const targets = (draft?.targetIds ?? [])
			.map((id) => this.editor.getShapePageBounds(id))
			.filter((b): b is Box => !!b && !(draft?.kind !== 'tap' && markBounds?.contains(b)))
		return [{ id: 'mark', type: 'mark', props: { stroke: marks.getStroke(), targets, connectors: this.getConnectors() } }]
	}

	private getThreads(): ThreadShape[] {
		return this.editor.getCurrentPageShapes().filter((s): s is ThreadShape => s.type === THREAD_TYPE)
	}

	/**
	 * For each thread, a line from the near edge of its mark (or of its targets,
	 * for a tap) to the first rule of the note. Close neighbors need no line.
	 */
	private getConnectors(): Connector[] {
		const { editor } = this
		const lines: Connector[] = []
		const selected = new Set<string>(editor.getSelectedShapeIds())
		const hovered = editor.getHoveredShapeId()
		for (const thread of this.getThreads()) {
			const note = editor.getShapePageBounds(thread)
			const markId = thread.props.markShapeId as TLShapeId
			const mark =
				(markId && editor.getShapePageBounds(markId)) ||
				Box.Common(
					thread.props.targetIds
						.map((id) => editor.getShapePageBounds(id as TLShapeId))
						.filter((b): b is Box => !!b)
				)
			if (!note || !mark || mark.w === 0) continue
			const end = { x: note.minX, y: note.minY + 26 }
			const leftOfNote = mark.maxX <= note.minX
			const above = note.maxY <= mark.minY
			const start = leftOfNote
				? { x: mark.maxX, y: Math.min(Math.max(end.y, mark.minY), mark.maxY) }
				: { x: mark.midX, y: above ? mark.minY : mark.maxY }
			const length = Math.hypot(end.x - start.x, end.y - start.y)
			if (length < 36) continue
			// A long line would cross other work, so it shows in full only while the
			// thread or its mark is selected or hovered. Otherwise a short tick at
			// each end says the two belong together.
			const focused = [thread.id, markId].some((id) => id && (selected.has(id) || hovered === id))
			lines.push({ start, end, full: length <= LONG_CONNECTOR || focused })
		}
		return lines
	}

	override render(ctx: CanvasRenderingContext2D, overlays: MarkOverlay[]): void {
		const zoom = this.editor.getZoomLevel()
		for (const { props } of overlays) {
			const stroke = props.stroke
			if (stroke && stroke.length > 1) {
				ctx.save()
				ctx.strokeStyle = MARK_RED
				ctx.lineWidth = 2.5 / zoom
				ctx.lineCap = 'round'
				ctx.lineJoin = 'round'
				ctx.setLineDash([7 / zoom, 6 / zoom])
				ctx.beginPath()
				ctx.moveTo(stroke[0].x, stroke[0].y)
				for (const p of stroke.slice(1)) ctx.lineTo(p.x, p.y)
				ctx.stroke()
				ctx.restore()
			}
			// A quiet dashed pencil line from each mark to its thread, gently curved.
			for (const { start: a, end: b, full } of props.connectors) {
				ctx.save()
				ctx.strokeStyle = MARK_RED
				ctx.globalAlpha = 0.5
				ctx.lineWidth = 1.25 / zoom
				ctx.lineCap = 'round'
				ctx.setLineDash([5 / zoom, 5 / zoom])
				ctx.beginPath()
				const mx = (a.x + b.x) / 2
				if (full) {
					ctx.moveTo(a.x, a.y)
					ctx.bezierCurveTo(mx, a.y, mx, b.y, b.x, b.y)
				} else {
					// The first and last stretch of the same curve, pointing at each other.
					const tick = TICK / zoom
					const ax = a.x + Math.sign(mx - a.x || 1) * tick
					ctx.moveTo(a.x, a.y)
					ctx.lineTo(ax, a.y)
					const bx = b.x - Math.sign(b.x - mx || 1) * tick
					ctx.moveTo(bx, b.y)
					ctx.lineTo(b.x, b.y)
				}
				ctx.stroke()
				ctx.restore()
			}
			// A faint red wash behind each added target.
			for (const target of props.targets) {
				const b = target.clone().expandBy(4 / zoom)
				ctx.save()
				ctx.fillStyle = MARK_RED
				ctx.globalAlpha = 0.07
				ctx.beginPath()
				ctx.roundRect(b.x, b.y, b.w, b.h, 4 / zoom)
				ctx.fill()
				ctx.restore()
			}
		}
	}
}
