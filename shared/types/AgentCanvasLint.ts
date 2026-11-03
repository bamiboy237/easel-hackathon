import { SimpleShapeId } from './ids-schema'

export interface AgentCanvasLint {
	type: AgentCanvasLintType
	shapeIds: SimpleShapeId[]
	/** The start of each shape's text, in the same order as shapeIds, so the model can find it. */
	texts?: string[]
}

export type AgentCanvasLintType = 'growY-on-shape' | 'overlapping-text' | 'friendless-arrow'
