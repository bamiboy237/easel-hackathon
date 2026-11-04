import { StateNode, TLPointerEventInfo, VecModel } from 'tldraw'
import { AgentAppAgentsManager } from '../agent/managers/AgentAppAgentsManager'

function getMarks(tool: StateNode) {
	return AgentAppAgentsManager.getAgents(tool.editor)[0]?.marks
}

/**
 * The Mark tool: circle, underline, strike through, scribble on, or tap
 * anything to ask about it. While a mark waits for its question, clicking a
 * shape adds it to the target or takes it out, and Escape drops the mark.
 * Ordinary drawing tools never make marks.
 */
export class MarkTool extends StateNode {
	static override id = 'mark'
	static override initial = 'idle'
	static override children() {
		return [MarkIdle, MarkDrawing]
	}

	override isLockable = false

	override onEnter() {
		this.editor.setCursor({ type: 'cross', rotation: 0 })
	}

	override onExit() {
		this.editor.setCursor({ type: 'default', rotation: 0 })
		this.editor.setHintingShapes([])
	}

	override onCancel() {
		const marks = getMarks(this)
		if (marks?.getDraft()) marks.cancelDraft()
		else this.editor.setCurrentTool('select')
	}
}

class MarkIdle extends StateNode {
	static override id = 'idle'

	override onPointerMove() {
		// While a mark waits, show which shape a click would add or remove.
		const marks = getMarks(this)
		if (!marks?.getDraft()) {
			this.editor.setHintingShapes([])
			return
		}
		const shape = this.editor.getShapeAtPoint(this.editor.inputs.getCurrentPagePoint(), { hitInside: true })
		this.editor.setHintingShapes(shape && !shape.meta.mark ? [shape] : [])
	}

	override onPointerDown(info: TLPointerEventInfo) {
		this.parent.transition('drawing', info)
	}
}

class MarkDrawing extends StateNode {
	static override id = 'drawing'

	private points: VecModel[] = []

	override onEnter() {
		const p = this.editor.inputs.getCurrentPagePoint()
		this.points = [{ x: p.x, y: p.y }]
	}

	override onPointerMove() {
		const p = this.editor.inputs.getCurrentPagePoint()
		const last = this.points[this.points.length - 1]
		if (Math.hypot(p.x - last.x, p.y - last.y) * this.editor.getZoomLevel() < 2) return
		this.points.push({ x: p.x, y: p.y })
		if (this.editor.inputs.getIsDragging()) getMarks(this)?.setStroke([...this.points])
	}

	override onPointerUp() {
		const marks = getMarks(this)
		const draft = marks?.getDraft()
		const dragged = this.editor.inputs.getIsDragging()
		this.parent.transition('idle')
		if (!marks) return

		// A click while a mark waits corrects its target instead of starting a new mark.
		if (draft && !dragged) {
			const shape = this.editor.getShapeAtPoint(this.points[0], { hitInside: true })
			if (shape && shape.id !== draft.shapeId) {
				marks.toggleTarget(shape.id)
				// The click took focus from the note; give it back, so Enter asks.
				requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.mark-composer input')?.focus())
				return
			}
		}
		marks.finishStroke(this.points)
	}

	override onCancel() {
		getMarks(this)?.setStroke(null)
		this.parent.transition('idle')
	}
}
