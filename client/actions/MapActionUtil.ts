import { Box, clamp, createShapeId, TLShapeId, toRichText } from 'tldraw'
import { MapAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { MapFrame } from '../agent/managers/AgentFrameFillManager'
import { AgentHelpers } from '../AgentHelpers'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

const FRAME_GAP = 80
const MAP_MARGIN = 200

export const MapActionUtil = registerActionUtil(
	class MapActionUtil extends AgentActionUtil<MapAction> {
		static override type = 'map' as const

		override getInfo(action: Streaming<MapAction>) {
			const titles = action.frames?.map((frame) => frame?.title).filter(Boolean) ?? []
			return {
				icon: 'pencil' as const,
				description: `**Map:** ${titles.join(' · ')}`,
			}
		}

		override sanitizeAction(action: Streaming<MapAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			for (const frame of action.frames) {
				frame.frameId = helpers.ensureShapeIdIsUnique(frame.frameId)
			}
			return action
		}

		override applyAction(action: Streaming<MapAction>, helpers: AgentHelpers) {
			if (!action.complete || action.frames.length === 0) return
			const { editor } = this

			const w = clamp(action.frameWidth, 480, 1600)
			const h = clamp(action.frameHeight, 400, 2000)
			const origin = getMapOrigin(editor.getViewportPageBounds(), editor.getCurrentPageBounds())

			const frames: MapFrame[] = action.frames.map((frame, i) => {
				const id = `shape:${frame.frameId}` as TLShapeId
				const x = origin.x + i * (w + FRAME_GAP)
				editor.createShape({
					id,
					type: 'frame',
					x,
					y: origin.y,
					props: { w, h, name: frame.title },
				})
				editor.createShape({
					id: createShapeId(),
					type: 'text',
					parentId: id,
					x: 24,
					y: 24,
					props: { richText: toRichText(frame.description), autoSize: false, w: w - 48 },
					meta: { note: `Description of the ${frame.title} frame` },
				})
				return {
					id,
					title: frame.title,
					description: frame.description,
					modelBounds: helpers.roundBox(helpers.applyOffsetToBox({ x, y: origin.y, w, h })),
				}
			})

			this.agent.frames.enqueue(frames)

			const mapBounds = new Box(origin.x, origin.y, frames.length * (w + FRAME_GAP) - FRAME_GAP, h)
			if (!editor.getViewportPageBounds().contains(mapBounds)) {
				editor.zoomToBounds(mapBounds, { inset: 80, animation: { duration: 300 } })
			}
		}
	}
)

// The user's space is to the left of the map, so a new map goes right of existing content.
function getMapOrigin(viewport: Box, content: Box | undefined) {
	if (!content) return { x: viewport.x + 80, y: viewport.y + 80 }
	return { x: content.maxX + MAP_MARGIN, y: content.minY }
}
