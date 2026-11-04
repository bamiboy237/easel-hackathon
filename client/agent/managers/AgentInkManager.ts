import { TLDefaultColorStyle, TLShape } from 'tldraw'
import { BoardSettings, getBoardSettings, updateBoardSettings } from '../boardSettings'
import { BaseAgentManager } from './BaseAgentManager'
import { getShapeCreator } from './BoardCommandManager'
import type { TldrawAgent } from '../TldrawAgent'

/** The agent's ink: the colors it chose itself, or one color for all its shapes. */
export type AgentInk = BoardSettings['agentInk']

/** The inks offered in the board menu. Graphite is tldraw's grey. Red is kept for marks. */
export const AGENT_INKS: { ink: AgentInk; label: string }[] = [
	{ ink: 'same', label: 'Same as mine' },
	{ ink: 'grey', label: 'Graphite' },
	{ ink: 'blue', label: 'Blue' },
	{ ink: 'violet', label: 'Violet' },
	{ ink: 'green', label: 'Green' },
	{ ink: 'orange', label: 'Orange' },
]

/**
 * Draws the agent's shapes in the ink the user picked for this board, so the
 * user can tell at a glance who drew what. Each agent shape keeps the color the
 * agent gave it in `meta.agentColor`, so choosing "Same as mine" restores it.
 */
export class AgentInkManager extends BaseAgentManager {
	/** On while the ink itself is being changed, so that change is not read as the agent recoloring. */
	private inking = false

	constructor(agent: TldrawAgent) {
		super(agent)
		const { editor } = agent
		// A shape the agent creates takes the board's agent ink.
		this.disposables.add(
			editor.store.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
				if (source !== 'user' || !this.isAgentShape(shape) || !hasColor(shape) || 'agentColor' in shape.meta) return shape
				const ink = this.getInk()
				if (ink === 'same') return shape
				return withInk(shape, shape.props.color, ink)
			})
		)
		// When the agent recolors one of its shapes, the new color is what it chose.
		// It is remembered whatever the ink, and the ink, if any, still shows.
		this.disposables.add(
			editor.store.sideEffects.registerBeforeChangeHandler('shape', (prev, next, source) => {
				if (source !== 'user' || this.inking || !this.agent.getIsActingOnEditor() || !this.isAgentShape(next)) return next
				if (!hasColor(next) || !hasColor(prev) || next.props.color === prev.props.color) return next
				const ink = this.getInk()
				return withInk(next, next.props.color, ink === 'same' ? next.props.color : ink)
			})
		)
	}

	reset(): void {}

	getInk(): AgentInk {
		return getBoardSettings(this.agent.editor).agentInk
	}

	/**
	 * Change the agent's ink for this board, and redraw its existing shapes in it,
	 * as one user command. A shape the user recolored by hand keeps their color.
	 */
	setInk(ink: AgentInk) {
		const { editor } = this.agent
		const previous = this.getInk()
		editor.markHistoryStoppingPoint('agent-ink')
		this.inking = true
		try {
			this.agent.commands.execute('user', 'agent-ink', () => this.applyInk(previous, ink))
		} finally {
			this.inking = false
		}
	}

	/** Redraw the agent's shapes on every page, from the ink they show now to the new one. */
	private applyInk(previous: AgentInk, ink: AgentInk) {
		const { editor } = this.agent
		updateBoardSettings(editor, { agentInk: ink })
		const updates = []
		for (const id of editor.getPages().flatMap((page) => [...editor.getPageShapeIds(page)])) {
			const shape = editor.getShape(id)
			if (!shape || !this.isAgentShape(shape) || !hasColor(shape)) continue
			const original = (shape.meta.agentColor as TLDefaultColorStyle | undefined) ?? shape.props.color
			// A shape not in the ink it should show was recolored by hand, and keeps that color.
			const shown = previous === 'same' ? original : previous
			if (shape.props.color !== shown) continue
			updates.push(withInk(shape, original, ink === 'same' ? original : ink))
		}
		editor.updateShapes(updates)
	}

	private isAgentShape(shape: TLShape) {
		return getShapeCreator(shape) === 'agent' || (!getShapeCreator(shape) && this.agent.getIsActingOnEditor())
	}
}

function hasColor(shape: TLShape): shape is TLShape & { props: { color: TLDefaultColorStyle } } {
	return typeof (shape.props as { color?: unknown }).color === 'string'
}

/** The shape in an ink, remembering the agent's own color. */
function withInk<T extends TLShape>(shape: T, agentColor: TLDefaultColorStyle, ink: TLDefaultColorStyle): T {
	return { ...shape, meta: { ...shape.meta, agentColor }, props: { ...shape.props, color: ink } }
}
