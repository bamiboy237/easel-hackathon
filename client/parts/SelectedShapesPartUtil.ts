import { structuredClone } from 'tldraw'
import {
	convertTldrawIdToSimpleId,
	convertTldrawShapeToFocusedShape,
} from '../../shared/format/convertTldrawShapeToFocusedShape'
import { SelectedShapesPart } from '../../shared/schema/PromptPartDefinitions'
import { AgentRequest } from '../../shared/types/AgentRequest'
import { AgentHelpers } from '../AgentHelpers'
import { PromptPartUtil, registerPromptPartUtil } from './PromptPartUtil'

export const SelectedShapesPartUtil = registerPromptPartUtil(
	class SelectedShapesPartUtil extends PromptPartUtil<SelectedShapesPart> {
		static override type = 'selectedShapes' as const

		override getPart(_request: AgentRequest, helpers: AgentHelpers): SelectedShapesPart {
			const { editor } = this

			const userSelectedShapes = editor.getSelectedShapes().map((v) => structuredClone(v)) ?? []

			return {
				type: 'selectedShapes',
				shapeIds: userSelectedShapes.map((shape) => convertTldrawIdToSimpleId(shape.id)),
				// Full details, so the agent can anchor its reply to the shape the user is asking about
				shapes: userSelectedShapes.map((shape) =>
					helpers.roundShape(
						helpers.applyOffsetToShape(convertTldrawShapeToFocusedShape(editor, shape))
					)
				),
			}
		}
	}
)
