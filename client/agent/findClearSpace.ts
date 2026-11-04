import { Box, Editor, TLShape, TLShapeId } from 'tldraw'

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

/**
 * A spot for a small note tied to a subject, such as a thread beside its mark.
 * It tries every side, sliding along each a line at a time. Any clear spot in
 * view beats one outside it; among those, the nearest wins, with a small
 * preference for the right side, then below, left, and above. Only when no side has
 * room near the subject does the note step further right. Notes sit closer
 * than new work, so this uses a small margin.
 */
export function findNoteSpot(
	editor: Editor,
	subject: Box,
	size: { w: number; h: number },
	ignore: TLShapeId[] = []
): Box | null {
	const ignored = new Set(ignore)
	const bounds = (id: TLShapeId) => editor.getShapePageBounds(id)
	const topLevel = editor.getCurrentPageShapes().filter((shape) => shape.parentId === editor.getCurrentPageId())
	// A frame or group that holds the subject, or a shape the caller ignores,
	// is the user's own work about the same thing, so the note may sit over its
	// empty space. Only what is drawn inside it blocks the note. Any other shape
	// that holds the subject, such as an image the mark circles part of, still
	// blocks the note.
	const holds = (shape: TLShape) => (shape.type === 'frame' || shape.type === 'group') && !!bounds(shape.id)?.contains(subject)
	const containers = topLevel.filter((shape) => ignored.has(shape.id) || holds(shape))
	const inside: TLShapeId[] = []
	for (const container of containers) {
		editor.visitDescendants(container.id, (id) => {
			if (id !== container.id && !ignored.has(id)) inside.push(id)
		})
	}
	const obstacles = [...topLevel.filter((shape) => !containers.includes(shape)).map((shape) => shape.id), ...inside]
		.map((id) => bounds(id))
		.filter((box): box is Box => !!box && !subject.contains(box))
	const view = getUsableViewBounds(editor)
	const margin = 8
	const gap = 24
	const isClear = (box: Box) => {
		const padded = box.clone().expandBy(margin)
		return obstacles.every((obstacle) => !padded.collides(obstacle))
	}

	// Distance the eye travels from the subject to a note, plus a small
	// preference for sliding less and for the right side.
	const score = (box: Box, side: number) => {
		const dx = Math.max(subject.x - box.maxX, box.x - subject.maxX, 0)
		const dy = Math.max(subject.y - box.maxY, box.y - subject.maxY, 0)
		const slide = side === 0 || side === 2 ? Math.abs(box.y - subject.y) : Math.abs(box.x - subject.x)
		return Math.hypot(dx, dy) + slide * 0.5 + side * 12
	}
	// The sides of each shape that holds the subject, such as its frame or the
	// image it circles part of, are tried too, still scored by distance to the
	// subject itself.
	const anchors = [
		subject,
		...topLevel.map((shape) => bounds(shape.id)).filter((box): box is Box => !!box && box.contains(subject)),
	]
	const candidates: { box: Box; inView: boolean; score: number }[] = []
	for (const anchor of anchors) {
		for (let step = 0; step <= 8; step++) {
			for (const k of step === 0 ? [0] : [step, -step]) {
				const y = subject.y + k * 24
				const x = subject.x + k * 40
				const sides: [number, number, number][] = [
					[anchor.maxX + gap, y, 0],
					[x, anchor.maxY + gap, 1],
					[anchor.x - gap - size.w, y, 2],
					[x, anchor.y - gap - size.h, 3],
				]
				for (const [bx, by, side] of sides) {
					const box = new Box(bx, by, size.w, size.h)
					if (isClear(box)) candidates.push({ box, inView: view.contains(box), score: score(box, side) })
				}
			}
		}
	}
	// Any spot in view comes first; among those, the nearest.
	candidates.sort((a, b) => Number(b.inView) - Number(a.inView) || a.score - b.score)
	if (candidates.length > 0) return candidates[0].box
	for (let right = 1; right <= 4; right++) {
		for (let down = 0; down <= 6; down++) {
			const candidate = new Box(subject.maxX + gap + right * 160, subject.y + down * 24, size.w, size.h)
			if (isClear(candidate)) return candidate
		}
	}
	return null
}

/**
 * True when a box overlaps a top-level shape other than the ones ignored. An
 * ignored frame or group still has its contents checked, so a note may sit over
 * a frame's empty space but not over what is drawn in it.
 */
export function overlapsShapes(editor: Editor, box: Box, ignore: TLShapeId[] = []): boolean {
	const ignored = new Set(ignore)
	const ids: TLShapeId[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.parentId !== editor.getCurrentPageId()) continue
		if (!ignored.has(shape.id)) {
			ids.push(shape.id)
			continue
		}
		editor.visitDescendants(shape.id, (id) => {
			if (id !== shape.id && !ignored.has(id)) ids.push(id)
		})
	}
	return ids.some((id) => {
		const bounds = editor.getShapePageBounds(id)
		return !!bounds && box.collides(bounds)
	})
}

/**
 * Screen strips the board's chrome covers, measured from tldraw's menu zone
 * (top left) and main toolbar (bottom center), plus a little air. The numbers
 * are only a fallback for when the UI is not mounted, such as in tests: they
 * are those two elements' sizes at the default layout.
 */
const FALLBACK_TOP_CHROME = 56
const FALLBACK_BOTTOM_CHROME = 76
const CHROME_AIR = 8

function measureChrome(editor: Editor): { top: number; bottom: number } {
	const container = editor.getContainer()
	const frame = container.getBoundingClientRect()
	const menu = container.querySelector('.tlui-menu-zone')?.getBoundingClientRect()
	const toolbar = container.querySelector('.tlui-main-toolbar')?.getBoundingClientRect()
	return {
		top: menu ? menu.bottom - frame.top + CHROME_AIR : FALLBACK_TOP_CHROME,
		bottom: toolbar ? frame.bottom - toolbar.top + CHROME_AIR : FALLBACK_BOTTOM_CHROME,
	}
}

/** The part of the view a note can be seen in: the viewport, less the menu and toolbar strips. */
export function getUsableViewBounds(editor: Editor): Box {
	const view = editor.getViewportPageBounds()
	const zoom = editor.getZoomLevel()
	const chrome = measureChrome(editor)
	const top = chrome.top / zoom
	const bottom = chrome.bottom / zoom
	return new Box(view.x, view.y + top, view.w, Math.max(0, view.h - top - bottom))
}
