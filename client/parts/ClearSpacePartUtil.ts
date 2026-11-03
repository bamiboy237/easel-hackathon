import { Box, clamp, TLShapeId } from 'tldraw'
import { ClearSpacePart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { findClearSpaceBeside, findClearSpaceInView } from '../agent/findClearSpace'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

const DEFAULT_SIZE = { w: 640, h: 480 }

/**
 * Where new work fits. For a request about selected shapes or context, that is
 * clear space beside them. Otherwise it is clear space in the user's view.
 * Follow-up passes and frame fills already know where they work.
 */
export const ClearSpacePartUtil = registerPromptPartUtil(
	class ClearSpacePartUtil extends PromptPartUtil<ClearSpacePart> {
		static override type = 'clearSpace' as const

		override getPart(request: AgentRequest, helpers: AgentHelpers): ClearSpacePart {
			const { editor } = this
			// Follow-up passes know where they work, and an aside has its own space.
			if (request.source === 'self' || this.agent.aside.getActive()) {
				return { type: 'clearSpace', near: 'view', space: null }
			}

			const subjectIds = new Set<TLShapeId>(editor.getSelectedShapeIds())
			const areas: Box[] = []
			for (const item of request.contextItems) {
				if (item.type === 'shape') subjectIds.add(`shape:${item.shape.shapeId}` as TLShapeId)
				if (item.type === 'shapes') for (const shape of item.shapes) subjectIds.add(`shape:${shape.shapeId}` as TLShapeId)
				if (item.type === 'area') areas.push(Box.From(item.bounds))
			}
			const boxes = [...subjectIds].map((id) => editor.getShapePageBounds(id)).filter((b): b is Box => !!b)
			const subject = boxes.length + areas.length > 0 ? Box.Common([...boxes, ...areas]) : null

			let space: Box | null = null
			if (subject) {
				const size = { w: clamp(subject.w, 400, 900), h: clamp(subject.h, 300, 800) }
				space = findClearSpaceBeside(editor, subject, size)
			} else {
				space = findClearSpaceInView(editor, DEFAULT_SIZE)
			}
			return {
				type: 'clearSpace',
				near: subject ? 'subject' : 'view',
				space: space ? helpers.roundBox(helpers.applyOffsetToBox(space)) : null,
			}
		}
	}
)
