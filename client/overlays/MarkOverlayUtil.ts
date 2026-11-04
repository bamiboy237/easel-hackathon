import { Box, OverlayUtil, TLOverlay, VecModel } from 'tldraw'
import { AgentAppAgentsManager } from '../agent/managers/AgentAppAgentsManager'

interface MarkOverlay extends TLOverlay {
	type: 'mark'
	props: { stroke: VecModel[] | null; targets: Box[] }
}

/** The board's red ink, the same as the mark the board keeps. */
const MARK_RED = '#AE3B2C'

/**
 * The live stroke while the user draws a mark, and a faint wash behind each
 * shape the app thinks the mark points at, so the user can see and fix it.
 */
export class MarkOverlayUtil extends OverlayUtil<MarkOverlay> {
	static override type = 'mark' as const
	override options = { zIndex: 710 }

	override isActive(): boolean {
		const marks = AgentAppAgentsManager.getAgents(this.editor)[0]?.marks
		return !!marks && (!!marks.getStroke() || !!marks.getDraft())
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
		return [{ id: 'mark', type: 'mark', props: { stroke: marks.getStroke(), targets } }]
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
