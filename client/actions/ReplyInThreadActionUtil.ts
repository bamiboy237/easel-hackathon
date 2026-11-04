import { TLShapeId } from 'tldraw'
import { ReplyInThreadAction } from '../../shared/schema/AgentActionSchemas'
import { Streaming } from '../../shared/types/Streaming'
import { AgentHelpers } from '../AgentHelpers'
import { findNoteSpot, overlapsShapes } from '../agent/findClearSpace'
import { measureThreadHeight, THREAD_TYPE, ThreadShape } from '../shapes/ThreadShapeUtil'
import { Box } from 'tldraw'
import { AgentActionUtil, registerActionUtil } from './AgentActionUtil'

/** The agent answers a mark in its thread, on the board beside the mark. */
export const ReplyInThreadActionUtil = registerActionUtil(
	class ReplyInThreadActionUtil extends AgentActionUtil<ReplyInThreadAction> {
		static override type = 'reply_in_thread' as const

		override getInfo(action: Streaming<ReplyInThreadAction>) {
			return {
				icon: 'comment' as const,
				description: action.text ?? null,
				canGroup: () => false,
			}
		}

		override sanitizeAction(action: Streaming<ReplyInThreadAction>, helpers: AgentHelpers) {
			if (!action.complete) return action
			const id = helpers.ensureShapeIdExists(action.thread as never)
			if (!id) return null
			return { ...action, thread: id }
		}

		override applyAction(action: Streaming<ReplyInThreadAction>) {
			const { editor } = this.agent
			if (!action.text) return
			// The model may write the text before the thread ID, and a half-written ID
			// names no shape. Until the ID names a thread, the answer streams onto the
			// thread this mark question belongs to.
			const named = action.thread ? editor.getShape<ThreadShape>(`shape:${action.thread}` as TLShapeId) : undefined
			const fallback = this.agent.marks.getActive()?.threadId
			const thread =
				named?.type === THREAD_TYPE ? named : fallback ? editor.getShape<ThreadShape>(fallback as TLShapeId) : undefined
			if (!thread || thread.type !== THREAD_TYPE) return
			const id = thread.id
			// The answer streams onto the note as it is written. Each partial version
			// replaces the last; only the finished answer is recorded.
			const entries = [...thread.props.entries, { author: 'agent' as const, text: action.complete ? action.text.trim() : action.text }]
			if (!action.complete) {
				editor.updateShape<ThreadShape>({ id, type: THREAD_TYPE, props: { entries } })
				return
			}
			// A longer note must not grow over other work, or out of view when it
			// started in view. If it would, it moves to the next clear spot beside its mark.
			const h = measureThreadHeight(editor, entries)
			const page = editor.getShapePageBounds(id)!
			const grown = new Box(page.x, page.y, thread.props.w, h)
			// A thread the user put inside a frame is not blocked by that frame.
			const own = [id, thread.props.markShapeId, ...thread.props.targetIds, ...editor.getShapeAncestors(id).map((s) => s.id)].filter(
				Boolean
			) as TLShapeId[]
			const view = editor.getViewportPageBounds()
			let position = { x: thread.x, y: thread.y }
			if (overlapsShapes(editor, grown, own) || (view.contains(page) && !view.contains(grown))) {
				const markId = thread.props.markShapeId as TLShapeId
				const subject = (markId && editor.getShapePageBounds(markId)) || editor.getShapePageBounds(id)!
				const spot = findNoteSpot(editor, subject, { w: thread.props.w, h }, own)
				// The spot is on the page; the thread stores its place in its parent's space.
				if (spot) {
					const local = editor.getPointInParentSpace(id, { x: spot.x, y: spot.y })
					position = { x: local.x, y: local.y }
				}
			}
			editor.updateShape<ThreadShape>({ id, type: THREAD_TYPE, ...position, props: { entries } })
		}
	}
)
