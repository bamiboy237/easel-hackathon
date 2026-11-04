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
			if (!action.complete) return
			const { editor } = this.agent
			const id = `shape:${action.thread}` as TLShapeId
			const thread = editor.getShape<ThreadShape>(id)
			if (!thread || thread.type !== THREAD_TYPE) return
			const entries = [...thread.props.entries, { author: 'agent' as const, text: action.text.trim() }]
			// A longer note must not grow over other work. If it would, it moves to the
			// next clear spot beside its mark.
			const h = measureThreadHeight(editor, entries)
			const grown = new Box(thread.x, thread.y, thread.props.w, h)
			const own = [id, thread.props.markShapeId, ...thread.props.targetIds].filter(Boolean) as TLShapeId[]
			let position = { x: thread.x, y: thread.y }
			if (overlapsShapes(editor, grown, own)) {
				const markId = thread.props.markShapeId as TLShapeId
				const subject = (markId && editor.getShapePageBounds(markId)) || editor.getShapePageBounds(id)!
				const spot = findNoteSpot(editor, subject, { w: thread.props.w, h }, own)
				if (spot) position = { x: spot.x, y: spot.y }
			}
			editor.updateShape<ThreadShape>({ id, type: THREAD_TYPE, ...position, props: { entries } })
		}
	}
)
