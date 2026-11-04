import {
	BindingOnShapeChangeOptions,
	BindingUtil,
	Box,
	Editor,
	RecordProps,
	T,
	TLBinding,
	TLShape,
	TLShapeId,
} from 'tldraw'
import { THREAD_TYPE } from './ThreadShapeUtil'

export const ANNOTATION_BINDING = 'annotation'

/**
 * Where the annotation sits relative to its target, in page space.
 * - A mark sits on its target: (rx, ry, rw, rh) is its box as fractions of the
 *   target's box, so it keeps its place and its size within the target.
 * - A thread sits beside its target: (ox, oy) is its top left measured from the
 *   target's top right, so it keeps its distance.
 */
export interface AnnotationBindingProps {
	/** The first target that still exists leads, so the annotation follows one target. */
	order: number
	rx: number
	ry: number
	rw: number
	rh: number
	ox: number
	oy: number
}

declare module 'tldraw' {
	export interface TLGlobalBindingPropsMap {
		[ANNOTATION_BINDING]: AnnotationBindingProps
	}
}

export type AnnotationBinding = TLBinding<typeof ANNOTATION_BINDING>

const EPSILON = 0.5

/**
 * Binds a mark's stroke, or its thread, to each shape the mark points at.
 * Moving or resizing the target places the annotation from the stored
 * relation, so following is idempotent: when undo restores a target and its
 * annotation together, the annotation is already in place and nothing moves
 * twice. Moving the annotation by hand updates the relation.
 */
export class AnnotationBindingUtil extends BindingUtil<AnnotationBinding> {
	static override type = ANNOTATION_BINDING
	static override props: RecordProps<AnnotationBinding> = {
		order: T.number,
		rx: T.number,
		ry: T.number,
		rw: T.number,
		rh: T.number,
		ox: T.number,
		oy: T.number,
	}

	override getDefaultProps(): AnnotationBindingProps {
		return { order: 0, rx: 0, ry: 0, rw: 1, rh: 1, ox: 0, oy: 0 }
	}

	override onAfterChangeToShape({ binding }: BindingOnShapeChangeOptions<AnnotationBinding>) {
		const { editor } = this
		if (getLeadBinding(editor, binding.fromId)?.id === binding.id) followTarget(editor, binding)
		// A target the annotation does not follow keeps its relation current, so
		// if it takes the lead later, the annotation does not jump.
		else refreshRelation(editor, binding)
	}

	override onAfterChangeFromShape({ binding }: BindingOnShapeChangeOptions<AnnotationBinding>) {
		// The annotation moved on its own, such as the user dragging it: keep the
		// new place relative to the target. After following, this finds no change.
		refreshRelation(this.editor, binding)
	}
}

/** Store where the annotation sits now relative to this binding's target, if it changed. */
function refreshRelation(editor: Editor, binding: AnnotationBinding) {
	const current = editor.getBinding(binding.id) as AnnotationBinding | undefined
	const target = editor.getShapePageBounds(binding.toId)
	const bounds = editor.getShapePageBounds(binding.fromId)
	if (!current || !target || !bounds) return
	const relation = getRelation(bounds, target)
	const p = current.props
	const same =
		Math.abs(relation.ox - p.ox) < EPSILON &&
		Math.abs(relation.oy - p.oy) < EPSILON &&
		Math.abs(relation.rx - p.rx) * target.w < EPSILON &&
		Math.abs(relation.ry - p.ry) * target.h < EPSILON &&
		Math.abs(relation.rw - p.rw) * target.w < EPSILON &&
		Math.abs(relation.rh - p.rh) * target.h < EPSILON
	if (same) return
	editor.updateBinding<AnnotationBinding>({ id: current.id, type: ANNOTATION_BINDING, props: { ...relation, order: p.order } })
}

/** Place an annotation after its target changed, if this binding is the one it follows. */
export function followTarget(editor: Editor, binding: AnnotationBinding) {
	if (getLeadBinding(editor, binding.fromId)?.id !== binding.id) return
	const annotation = editor.getShape(binding.fromId)
	const target = editor.getShapePageBounds(binding.toId)
	if (annotation && target) place(editor, annotation, target, binding.props)
}

/**
 * Follow targets that moved because a shape holding them moved, such as a
 * graph inside a frame. tldraw tells bindings when a shape itself changes, or
 * when its parent changes, but not when its parent moves.
 */
export function followDescendants(editor: Editor, shapeId: TLShapeId) {
	editor.visitDescendants(shapeId, (id) => {
		for (const binding of editor.getBindingsToShape<AnnotationBinding>(id, ANNOTATION_BINDING)) {
			followTarget(editor, binding)
		}
	})
}

/** The binding the annotation follows: the first, by order, whose target still exists. */
export function getLeadBinding(editor: Editor, annotationId: TLShapeId): AnnotationBinding | undefined {
	return editor
		.getBindingsFromShape<AnnotationBinding>(annotationId, ANNOTATION_BINDING)
		.filter((b) => editor.getShape(b.toId))
		.sort((a, b) => a.props.order - b.props.order)[0]
}

/**
 * True when none of an annotation's targets exist any more. A thread saved
 * before bindings existed has no bindings, so its target IDs decide instead.
 */
export function isDetached(editor: Editor, annotationId: TLShapeId, targetIds: string[] = []): boolean {
	if (getLeadBinding(editor, annotationId)) return false
	if (editor.getBindingsFromShape(annotationId, ANNOTATION_BINDING).length > 0) return true
	return !targetIds.some((id) => editor.getShape(id as TLShapeId))
}

function getRelation(bounds: Box, target: Box) {
	return {
		rx: target.w ? (bounds.x - target.x) / target.w : 0,
		ry: target.h ? (bounds.y - target.y) / target.h : 0,
		rw: target.w ? bounds.w / target.w : 1,
		rh: target.h ? bounds.h / target.h : 1,
		ox: bounds.x - target.maxX,
		oy: bounds.y - target.y,
	}
}

/** Put the annotation where its relation says, if it is not there already. */
function place(editor: Editor, annotation: TLShape, target: Box, relation: AnnotationBindingProps) {
	const bounds = editor.getShapePageBounds(annotation.id)
	if (!bounds) return
	if (annotation.type === THREAD_TYPE) {
		const dx = target.maxX + relation.ox - bounds.x
		const dy = target.y + relation.oy - bounds.y
		if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return
		moveByPage(editor, annotation, dx, dy)
		return
	}
	// A mark grows or shrinks with its target, so a circle still circles it.
	const want = {
		x: target.x + relation.rx * target.w,
		y: target.y + relation.ry * target.h,
		w: relation.rw * target.w,
		h: relation.rh * target.h,
	}
	if (Math.abs(want.w - bounds.w) >= EPSILON || Math.abs(want.h - bounds.h) >= EPSILON) {
		const sx = bounds.w ? want.w / bounds.w : 1
		const sy = bounds.h ? want.h / bounds.h : 1
		editor.resizeShape(annotation.id, { x: sx, y: sy }, { scaleOrigin: { x: bounds.x, y: bounds.y } })
	}
	const now = editor.getShapePageBounds(annotation.id)
	const current = editor.getShape(annotation.id)
	if (!now || !current) return
	const dx = want.x - now.x
	const dy = want.y - now.y
	if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return
	moveByPage(editor, current, dx, dy)
}

/**
 * Move a shape by a distance measured on the page. A shape inside a moved or
 * rotated group or frame stores its position in its parent's space, so the
 * target point is converted there first.
 */
function moveByPage(editor: Editor, shape: TLShape, dx: number, dy: number) {
	const origin = editor.getShapePageTransform(shape.id).point()
	const local = editor.getPointInParentSpace(shape.id, { x: origin.x + dx, y: origin.y + dy })
	editor.updateShape({ id: shape.id, type: shape.type, x: local.x, y: local.y })
}

/** Bind an annotation to its targets, keeping its current place relative to each. */
export function bindAnnotation(editor: Editor, annotationId: TLShapeId, targetIds: TLShapeId[]) {
	const bounds = editor.getShapePageBounds(annotationId)
	if (!bounds) return
	targetIds.forEach((toId, order) => {
		const target = editor.getShapePageBounds(toId)
		if (!target) return
		editor.createBinding<AnnotationBinding>({
			type: ANNOTATION_BINDING,
			fromId: annotationId,
			toId,
			props: { order, ...getRelation(bounds, target) },
		})
	})
}
