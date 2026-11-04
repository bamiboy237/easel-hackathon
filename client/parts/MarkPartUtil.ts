import { Box, FileHelpers } from 'tldraw'
import { convertTldrawIdToSimpleId } from '../../shared/format/convertTldrawShapeToFocusedShape'
import { MarkPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

/** How much of the board around a mark goes into its crop. */
const MARK_PADDING = 40
const MAX_MARK_SIDE = 1024

/** The mark the request asks about, with a crop of its region so marks on images and sketches work. */
export const MarkPartUtil = registerPromptPartUtil(
	class MarkPartUtil extends PromptPartUtil<MarkPart> {
		static override type = 'mark' as const

		override async getPart(_request: unknown, helpers: AgentHelpers): Promise<MarkPart> {
			const mark = this.agent.marks.getActive()
			if (!mark) return { type: 'mark', mark: null }
			const { editor } = this
			const region = Box.From(mark.bounds).expandBy(MARK_PADDING)
			const shapes = editor.getCurrentPageShapesSorted().filter((shape) => {
				const b = editor.getShapePageBounds(shape)
				return !!b && region.collides(b)
			})
			let image = ''
			if (shapes.length > 0) {
				const scale = Math.min(2, MAX_MARK_SIDE / Math.max(region.w, region.h))
				const result = await editor.toImage(shapes, { format: 'jpeg', background: true, bounds: region, padding: 0, scale })
				image = await FileHelpers.blobToDataUrl(result.blob)
			}
			return {
				type: 'mark',
				mark: {
					kind: mark.kind,
					targetIds: mark.targetIds.map((id) => convertTldrawIdToSimpleId(id)),
					bounds: helpers.roundBox(helpers.applyOffsetToBox(mark.bounds)),
					question: mark.text,
					image,
				},
			}
		}
	}
)
