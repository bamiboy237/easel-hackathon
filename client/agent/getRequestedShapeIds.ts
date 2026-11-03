import { Box, Editor, TLShapeId } from 'tldraw'
import { AgentRequest } from '../../shared/types/AgentRequest'

function escapeRegExp(text: string) {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The shapes a request asks the agent to work on, which the agent may change
 * even when the user owns them: shapes the user selected, shapes and areas the
 * user added as context, and shapes the request names by ID or, for a frame, by
 * its title. Context the agent added for itself does not count.
 */
export function getRequestedShapeIds(editor: Editor, request: AgentRequest): Set<TLShapeId> {
	const ids = new Set<TLShapeId>()
	if (request.source === 'user') {
		for (const id of editor.getSelectedShapeIds()) ids.add(id)
	}

	const shapes = editor.getCurrentPageShapes()
	for (const item of request.contextItems) {
		if (item.source !== 'user') continue
		switch (item.type) {
			case 'shape':
				ids.add(`shape:${item.shape.shapeId}` as TLShapeId)
				break
			case 'shapes':
				for (const shape of item.shapes) ids.add(`shape:${shape.shapeId}` as TLShapeId)
				break
			case 'area': {
				const area = Box.From(item.bounds)
				for (const shape of shapes) {
					const bounds = editor.getShapePageBounds(shape)
					if (bounds && area.contains(bounds)) ids.add(shape.id)
				}
				break
			}
			case 'point':
				break
		}
	}

	// Only the user's own words name shapes. Messages from the agent to itself
	// repeat shape IDs from rejection notices and must not unlock them.
	if (request.source !== 'self') {
		const text = [...request.agentMessages, ...request.userMessages].join('\n')
		const lowerText = text.toLowerCase()
		for (const shape of shapes) {
			const shortId = shape.id.slice('shape:'.length)
			if (new RegExp(`(^|[^\\w-])${escapeRegExp(shortId)}($|[^\\w-])`).test(text)) {
				ids.add(shape.id)
			}
			if (shape.type === 'frame') {
				const name = (shape.props as { name?: string }).name?.trim().toLowerCase()
				if (name && name.length >= 3 && lowerText.includes(name)) ids.add(shape.id)
			}
		}
	}
	return ids
}
