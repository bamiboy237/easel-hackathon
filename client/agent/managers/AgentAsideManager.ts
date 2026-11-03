import { atom, Box, BoxModel, Editor, TLShape, TLShapeId } from 'tldraw'
import { TodoItem } from '../../../shared/types/TodoItem'
import { findClearSpaceBeside, findClearSpaceInView } from '../findClearSpace'
import type { MapFrame } from './AgentFrameFillManager'
import { BaseAgentManager } from './BaseAgentManager'

/** How much room an aside gets, and how far from the main work it sits. */
const ASIDE_SIZE = { w: 640, h: 480 }

/** Unfinished plan work, kept while the agent is on an aside. */
interface PlanBookmark {
	todos: TodoItem[]
	frames: MapFrame[]
}

export interface ActiveAside {
	topic: string
	/** Page bounds of the space the aside works in. */
	region: BoxModel
	/** Page bounds of the work the aside stepped away from. */
	from: BoxModel | null
	plan: PlanBookmark | null
}

/**
 * Asides: short detours from the main work, such as "this looks like torque
 * from statics, can we brush up on it?" An aside can start at any time, while
 * the agent works or while the user reads what it made. It works in clear
 * space a little apart from the main work, draws in a pencil style, and keeps
 * any unfinished plan so "back to it" can pick that plan up again.
 */
export class AgentAsideManager extends BaseAgentManager {
	private $active = atom<ActiveAside | null>('active aside', null)
	/** The plan most recently cut short by a new user request, if any. */
	private lastPlan: PlanBookmark | null = null

	constructor(agent: ConstructorParameters<typeof BaseAgentManager>[0]) {
		super(agent)
		const editor = agent.editor
		// The agent's shapes on an aside are drawn like pencil notes.
		this.disposables.add(
			editor.store.sideEffects.registerBeforeCreateHandler('shape', (shape) => {
				const aside = this.$active.get()
				if (!aside || !this.agent.getIsActingOnEditor()) return shape
				return pencil(shape, aside.topic)
			})
		)
	}

	reset(): void {
		this.$active.set(null)
		this.lastPlan = null
	}

	getActive(): ActiveAside | null {
		return this.$active.get()
	}

	/** Keep unfinished plan work before a new request or a stop clears it. */
	capturePlan() {
		const todos = this.agent.todos.getTodos().filter((todo) => todo.status !== 'done')
		const frames = [...this.agent.frames.getPending()]
		if (todos.length > 0 || frames.length > 0) this.lastPlan = { todos, frames }
	}

	/** The plan finished, so there is nothing to return to. */
	clearPlan() {
		this.lastPlan = null
	}

	/** Start an aside beside the work the user is on. */
	start(topic: string): ActiveAside {
		const { editor } = this.agent
		const from = getFocusBounds(editor, this.agent)
		const region =
			(from && findClearSpaceBeside(editor, from, ASIDE_SIZE)) ??
			findClearSpaceInView(editor, ASIDE_SIZE) ??
			new Box(editor.getViewportPageBounds().x + 40, editor.getViewportPageBounds().y + 40, ASIDE_SIZE.w, ASIDE_SIZE.h)
		this.capturePlan()
		const aside: ActiveAside = {
			topic,
			region: { x: region.x, y: region.y, w: region.w, h: region.h },
			from: from ? { x: from.x, y: from.y, w: from.w, h: from.h } : null,
			plan: this.lastPlan,
		}
		this.lastPlan = null
		// The plan waits until the aside ends.
		this.agent.todos.reset()
		this.agent.frames.reset()
		this.$active.set(aside)
		return aside
	}

	/** End the aside and put the waiting plan back. */
	end(): ActiveAside | null {
		const aside = this.$active.get()
		if (!aside) return null
		this.$active.set(null)
		if (aside.plan) {
			this.agent.todos.setTodos(aside.plan.todos)
			this.agent.frames.enqueue(aside.plan.frames)
		}
		return aside
	}
}

/** The work the user is on: their selection, else the agent's work in view, else nothing. */
function getFocusBounds(editor: Editor, agent: { lints: { getCreatedShapes(): TLShape[] } }): Box | null {
	const selected = editor.getSelectionPageBounds()
	if (selected) return selected
	const view = editor.getViewportPageBounds()
	const pageId = editor.getCurrentPageId()
	const agentShapes = editor
		.getCurrentPageShapes()
		.filter((shape) => shape.parentId === pageId && shape.meta.createdBy === 'agent')
		.map((shape) => editor.getShapePageBounds(shape))
		.filter((bounds): bounds is Box => !!bounds && bounds.collides(view))
	if (agentShapes.length > 0) return Box.Common(agentShapes)
	const recent = agent.lints
		.getCreatedShapes()
		.map((shape) => editor.getShapePageBounds(shape.id as TLShapeId))
		.filter((bounds): bounds is Box => !!bounds)
	return recent.length > 0 ? Box.Common(recent) : null
}

/** Pencil style: hand-drawn strokes and lettering, a little lighter. */
function pencil(shape: TLShape, topic: string): TLShape {
	const props = { ...(shape.props as Record<string, unknown>) }
	if ('dash' in props && props.dash !== 'dotted') props.dash = 'draw'
	if ('font' in props) props.font = 'draw'
	if ('fill' in props && props.fill === 'solid') props.fill = 'semi'
	return {
		...shape,
		opacity: Math.min(shape.opacity, 0.8),
		props: props as TLShape['props'],
		meta: { ...shape.meta, aside: topic },
	} as TLShape
}
