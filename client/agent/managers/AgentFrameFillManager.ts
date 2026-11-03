import { BoxModel, TLShapeId } from 'tldraw'
import { BaseAgentManager } from './BaseAgentManager'

export interface MapFrame {
	id: TLShapeId
	title: string
	description: string
	/** Frame bounds in the model's coordinate space, used in the fill request. */
	modelBounds: BoxModel
}

/**
 * Fills the frames of a map one at a time, one follow-up request per frame,
 * so the user can work in finished frames while later ones generate.
 */
export class AgentFrameFillManager extends BaseAgentManager {
	private frames: MapFrame[] = []
	private pending: MapFrame[] = []

	reset(): void {
		this.frames = []
		this.pending = []
	}

	enqueue(frames: MapFrame[]) {
		this.frames.push(...frames)
		this.pending.push(...frames)
	}

	/**
	 * Move agent-created shapes into the frame they were drawn in, then schedule
	 * the next frame's fill request. Returns false when no frame is left.
	 */
	scheduleNext(): boolean {
		this.fileCreatedShapesIntoFrames()

		const frame = this.pending.shift()
		if (!frame) {
			this.reset()
			return false
		}

		const { editor } = this.agent
		const bounds = editor.getShapePageBounds(frame.id)
		if (!bounds) return this.scheduleNext()

		const { x, y, w, h } = frame.modelBounds
		this.agent.schedule({
			agentMessages: [
				`Fill the "${frame.title}" frame: ${frame.description}
The frame spans x=${x}, y=${y}, w=${w}, h=${h}. Its title and description sit at the top. Put all new content inside the frame, starting at y=${y + 110}, with at least 24 units of padding from its edges.
Fill only this frame. Do not create a map, and do not change other frames or the user's work. When this frame is complete, finish. The app starts the next frame.`,
			],
			bounds: bounds.clone().expandBy(40),
			source: 'self',
		})
		return true
	}

	private fileCreatedShapesIntoFrames() {
		if (this.frames.length === 0) return
		const { editor } = this.agent
		const pageId = editor.getCurrentPageId()

		const moves = new Map<TLShapeId, TLShapeId[]>()
		for (const shape of this.agent.lints.getCreatedShapes()) {
			if (shape.parentId !== pageId || shape.type === 'frame') continue
			const shapeBounds = editor.getShapePageBounds(shape.id)
			if (!shapeBounds) continue
			const frame = this.frames.find((f) => editor.getShapePageBounds(f.id)?.contains(shapeBounds))
			if (!frame) continue
			moves.set(frame.id, [...(moves.get(frame.id) ?? []), shape.id])
		}
		if (moves.size === 0) return

		const result = this.agent.commands.execute(
			'agent',
			'file-into-frame',
			() => {
				editor.run(
					() => {
						for (const [frameId, ids] of moves) editor.reparentShapes(ids, frameId)
					},
					{ ignoreShapeLock: true, history: 'ignore' }
				)
			},
			{ baseRev: this.agent.getLastBaseRev() }
		)
		if (result.status === 'rejected') {
			this.agent.actions.reportStaleCommand('file-into-frame', result.staleRecordIds)
		}
	}
}
