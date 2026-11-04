import { Box, Editor, TLShape, TLShapeId, VecModel } from 'tldraw'

/** What kind of gesture a mark is. Each one sets the default intent when the user gives no text. */
export type MarkKind = 'circle' | 'underline' | 'strike' | 'scribble' | 'tap'

/** The question each kind of mark asks when the user does not type or say one. */
export const MARK_INTENTS: Record<MarkKind, string> = {
	circle: 'Explain this.',
	scribble: 'Explain this.',
	tap: 'Explain this.',
	underline: 'Go deeper on this.',
	strike: 'I think this is wrong. Check it and say what is wrong, if anything.',
}

/** Below this length in screen pixels, a mark is a tap. */
const TAP_DISTANCE = 6

/**
 * Classify a stroke from its page points.
 * - A short stroke is a tap.
 * - A flat stroke is an underline or a strike-through, depending on where it
 *   crosses the shapes it lies on.
 * - A stroke that comes back near its start is a circle.
 * - A stroke that travels much more than its own outline is a scribble.
 */
export function classifyStroke(editor: Editor, points: VecModel[]): MarkKind {
	const zoom = editor.getZoomLevel()
	const box = Box.FromPoints(points)
	const length = pathLength(points)
	if (length * zoom < TAP_DISTANCE) return 'tap'

	const first = points[0]
	const last = points[points.length - 1]
	const gap = Math.hypot(last.x - first.x, last.y - first.y)
	const size = Math.max(box.w, box.h)
	const flat = box.h < box.w * 0.25 && gap > size * 0.6

	if (flat) {
		const midY = box.midY
		const crossed = getLineTargets(editor, box)
		const strikes = crossed.some((shape) => {
			const b = editor.getShapePageBounds(shape)
			return !!b && midY > b.minY + b.h * 0.3 && midY < b.maxY - b.h * 0.3
		})
		return strikes ? 'strike' : 'underline'
	}
	if (length > (box.w + box.h) * 2 * 2.2) return 'scribble'
	return 'circle'
}

/**
 * The shapes a mark points at, smallest first. A circle or scribble targets
 * what it encloses; an underline or strike targets what it runs along; a tap
 * targets the shape under the point. Marks and the agent's highlight strokes
 * are never targets.
 */
export function findMarkTargets(editor: Editor, points: VecModel[], kind: MarkKind): TLShapeId[] {
	const box = Box.FromPoints(points)
	if (kind === 'tap') {
		const shape = editor.getShapeAtPoint(points[0], { hitInside: true, hitFrameInside: true })
		return shape && isTargetable(shape) ? [shape.id] : []
	}
	if (kind === 'underline' || kind === 'strike') return getLineTargets(editor, box).map((s) => s.id)

	// A circle encloses a shape when most of the shape sits inside it.
	const enclosed = candidates(editor, box.clone().expandBy(box.w * 0.15)).filter((shape) => {
		const b = editor.getShapePageBounds(shape)
		if (!b || b.w * b.h === 0) return false
		const inter =
			Math.max(0, Math.min(b.maxX, box.maxX) - Math.max(b.minX, box.minX)) *
			Math.max(0, Math.min(b.maxY, box.maxY) - Math.max(b.minY, box.minY))
		return inter / (b.w * b.h) >= 0.6
	})
	if (enclosed.length > 0) return dropContainers(editor, enclosed).map((s) => s.id)

	// A small circle inside one big shape, such as part of an image, targets that shape.
	const container = editor.getShapeAtPoint(box.center, { hitInside: true, hitFrameInside: true })
	return container && isTargetable(container) ? [container.id] : []
}

/** Shapes a flat stroke runs along: they overlap it sideways and it sits on or just below them. */
function getLineTargets(editor: Editor, line: Box): TLShape[] {
	const zone = new Box(line.x, line.y - 60, line.w, line.h + 80)
	return dropContainers(
		editor,
		candidates(editor, zone).filter((shape) => {
			const b = editor.getShapePageBounds(shape)
			if (!b) return false
			const sideways = Math.min(b.maxX, line.maxX) - Math.max(b.minX, line.minX)
			return sideways > Math.min(b.w, line.w) * 0.5 && line.midY >= b.minY - 4 && line.midY <= b.maxY + 30
		})
	)
}

function candidates(editor: Editor, area: Box): TLShape[] {
	return editor
		.getCurrentPageShapesSorted()
		.filter(isTargetable)
		.filter((shape) => {
			const b = editor.getShapePageBounds(shape)
			return !!b && area.collides(b)
		})
}

/** Keep the most specific shapes: a frame or group that holds other matches is dropped. */
function dropContainers(editor: Editor, shapes: TLShape[]): TLShape[] {
	const ids = new Set(shapes.map((s) => s.id))
	return shapes.filter((shape) => {
		if (shape.type !== 'frame' && shape.type !== 'group') return true
		return !editor.getSortedChildIdsForParent(shape.id).some((id) => ids.has(id as TLShapeId))
	})
}

function isTargetable(shape: TLShape): boolean {
	return !shape.meta.mark && shape.type !== 'highlight'
}

function pathLength(points: VecModel[]): number {
	let total = 0
	for (let i = 1; i < points.length; i++) {
		total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
	}
	return total
}
