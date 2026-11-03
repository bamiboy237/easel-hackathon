import { Box, Editor } from 'tldraw'

/** Space kept between new work and the shapes around it. */
const MARGIN = 40
/** Distance between new work and the subject it relates to. */
const GAP = 80
/** How far a candidate slides along one side before that side is given up. */
const SLIDE_STEP = 80
const SLIDE_STEPS = 12

/** Top-level shapes on the page. A shape inside a frame is covered by its frame. */
function getObstacles(editor: Editor): Box[] {
	const pageId = editor.getCurrentPageId()
	return editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === pageId)
		.map((shape) => editor.getShapePageBounds(shape))
		.filter((bounds): bounds is Box => !!bounds)
}

function isClear(box: Box, obstacles: Box[]) {
	const padded = box.clone().expandBy(MARGIN)
	return obstacles.every((obstacle) => !padded.collides(obstacle))
}

/**
 * Clear space beside a subject: to its right, then below, left, and above,
 * sliding along each side until the space is free of other shapes.
 */
export function findClearSpaceBeside(editor: Editor, subject: Box, size: { w: number; h: number }): Box | null {
	const obstacles = getObstacles(editor).filter((obstacle) => !subject.contains(obstacle))
	const sides = [
		(i: number) => new Box(subject.maxX + GAP + i * SLIDE_STEP, subject.y, size.w, size.h),
		(i: number) => new Box(subject.x, subject.maxY + GAP + i * SLIDE_STEP, size.w, size.h),
		(i: number) => new Box(subject.x - GAP - size.w - i * SLIDE_STEP, subject.y, size.w, size.h),
		(i: number) => new Box(subject.x, subject.y - GAP - size.h - i * SLIDE_STEP, size.w, size.h),
	]
	for (let i = 0; i <= SLIDE_STEPS; i++) {
		for (const side of sides) {
			const candidate = side(i)
			if (isClear(candidate, obstacles)) return candidate
		}
	}
	return null
}

/** Clear space inside the user's view, scanning from the top left. */
export function findClearSpaceInView(editor: Editor, size: { w: number; h: number }): Box | null {
	const view = editor.getViewportPageBounds()
	const obstacles = getObstacles(editor)
	const step = Math.max(40, Math.min(size.w, size.h) / 4)
	for (let y = view.y + MARGIN; y + size.h <= view.maxY - MARGIN; y += step) {
		for (let x = view.x + MARGIN; x + size.w <= view.maxX - MARGIN; x += step) {
			const candidate = new Box(x, y, size.w, size.h)
			if (isClear(candidate, obstacles)) return candidate
		}
	}
	return null
}
