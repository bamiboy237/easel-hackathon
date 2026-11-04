import { atom, Box, BoxModel, RecordsDiff, structuredClone, TLRecord, TLShapeId } from 'tldraw'
import { parseAgentAction } from '../../../shared/schema/parseAgentAction'
import { AgentAction } from '../../../shared/types/AgentAction'
import { ChatHistoryItem } from '../../../shared/types/ChatHistoryItem'
import { Streaming } from '../../../shared/types/Streaming'
import { AgentActionUtil, getAgentActionUtilsRecordForMode } from '../../actions/AgentActionUtil'
import { AgentHelpers } from '../../AgentHelpers'
import type { TldrawAgent } from '../TldrawAgent'
import { BaseAgentManager } from './BaseAgentManager'
import type { BoardCommandResult } from './BoardCommandManager'

type RejectedCommandResult = Extract<BoardCommandResult, { status: 'rejected' }>

/** Follow-up passes that rejection notices can start for one user request. */
const MAX_REJECTION_PASSES = 3

/** How long the board outlines protected shapes after the agent bumps into them. */
export const PROTECTED_FLASH_MS = 1600

/** Where the agent is working on the board, and a short line about the step. */
export interface AgentWork {
	bounds: BoxModel
	step: string
	/** The shapes the agent has changed in this request so far. */
	shapeIds: string[]
	/** Of those, the ones it created. */
	createdIds: string[]
}

/** How long a change ghost fades on the board. */
export const CHANGE_GHOST_MS = 320

/**
 * What a change ghost marks: a shape an undo removed, a shape a restore
 * brought back, or a shape the agent just created.
 */
export type ChangeGhostKind = 'removed' | 'added' | 'landed'

/** A short fade on the board where a shape left, returned, or landed. */
export interface ChangeGhost {
	id: string
	bounds: { x: number; y: number; w: number; h: number }
	kind: ChangeGhostKind
	startedAt: number
}

/**
 * Manages action-related functionality for the agent.
 * Handles action utils, action execution, and chat history updates for actions.
 */
export class AgentActionManager extends BaseAgentManager {
	/**
	 * A record of the agent's action util instances.
	 * Used by the `getAgentActionUtil` method.
	 */
	private agentActionUtils: Record<AgentAction['_type'], AgentActionUtil<AgentAction>>

	/**
	 * The agent action util instance for the "unknown" action type.
	 *
	 * This is returned by the `getAgentActionUtil` method when the action type
	 * isn't properly specified. This can happen if the model isn't finished
	 * streaming yet or makes a mistake.
	 */
	unknownActionUtil: AgentActionUtil<AgentAction>

	private rejectionPasses = 0
	private rejectionNoticePending = false
	private $protectedFlash = atom<TLShapeId[]>('protected flash', [])
	private protectedFlashTimeout: ReturnType<typeof setTimeout> | null = null
	private protectedFlashStartedAt = 0
	private $changeGhosts = atom<ChangeGhost[]>('change ghosts', [])
	private changeGhostTimeout: ReturnType<typeof setTimeout> | null = null

	/** Where the agent is working on the board during this request, and on what. */
	private $work = atom<AgentWork | null>('agent work', null)

	constructor(agent: TldrawAgent) {
		super(agent)
		this.agentActionUtils = getAgentActionUtilsRecordForMode(
			this.agent,
			agent.mode.getCurrentModeType()
		)
		this.unknownActionUtil = this.agentActionUtils.unknown
	}

	/**
	 * Reset the action manager to its initial state.
	 * Currently no state to reset as action utils are stateless.
	 */
	reset(): void {
		this.rejectionPasses = 0
		this.rejectionNoticePending = false
	}

	/** Called as each request starts. A new user request gets a fresh retry budget. */
	onRequestStart(source: string): void {
		this.rejectionNoticePending = false
		// The agent's own follow-up passes continue the same work, so its place stays.
		if (source !== 'self') {
			this.rejectionPasses = 0
			this.$work.set(null)
		}
	}

	/**
	 * Where the agent is changing the board right now, and a short line about the
	 * step, while a request runs. Null before its first change, and after the
	 * request ends.
	 */
	getWork(): AgentWork | null {
		if (!this.agent.requests.isGenerating()) return null
		return this.$work.get()
	}

	/** The board work of the latest request, kept after it ends until the next one starts. */
	getLastWork(): AgentWork | null {
		return this.$work.get()
	}

	/** Remember the shapes an applied step changed as the agent's working place. */
	private noteWork(action: Streaming<AgentAction>, changes: RecordsDiff<TLRecord>) {
		const { editor } = this.agent
		const ids = [...Object.keys(changes.added), ...Object.keys(changes.updated)].filter((id) =>
			id.startsWith('shape:')
		) as TLShapeId[]
		const boxes = ids.map((id) => editor.getShapePageBounds(id)).filter((b): b is Box => !!b)
		if (boxes.length === 0) return
		const intent = 'intent' in action && typeof action.intent === 'string' ? action.intent.trim() : ''
		const previous = this.$work.get()
		const shapeIds = [...new Set([...(previous?.shapeIds ?? []), ...ids])]
		const created = Object.keys(changes.added).filter((id) => id.startsWith('shape:'))
		const createdIds = [...new Set([...(previous?.createdIds ?? []), ...created])]
		this.$work.set({ bounds: Box.Common(boxes).toJson(), step: intent || previous?.step || '', shapeIds, createdIds })
	}

	/** The protected shapes the board outlines briefly after a protected rejection. */
	getProtectedFlash(): TLShapeId[] {
		return this.$protectedFlash.get()
	}

	/** The change ghosts still fading on the board. */
	getChangeGhosts(): ChangeGhost[] {
		return this.$changeGhosts.get()
	}

	/**
	 * Run an undo or restore, and fade the shapes it removed or added so they
	 * do not pop off or on. The change itself is instant; only the overlay fades.
	 */
	showChange<T>(change: () => T): T {
		const before = this.getPageShapeBounds()
		const result = change()
		const after = this.getPageShapeBounds()
		const startedAt = Date.now()
		const ghosts: ChangeGhost[] = []
		for (const [id, bounds] of before) if (!after.has(id)) ghosts.push({ id, bounds, kind: 'removed', startedAt })
		for (const [id, bounds] of after) if (!before.has(id)) ghosts.push({ id, bounds, kind: 'added', startedAt })
		this.addChangeGhosts(ghosts)
		return result
	}

	/**
	 * Give shapes the agent just created a faint outline that fades, so each one
	 * reads as landing rather than popping in. The shapes themselves are already
	 * in place; only the overlay fades.
	 */
	private markLanded(recordIds: string[]) {
		const { editor } = this.agent
		const startedAt = Date.now()
		const landed: ChangeGhost[] = []
		for (const id of recordIds) {
			if (!id.startsWith('shape:')) continue
			const b = editor.getShapePageBounds(id as TLShapeId)
			if (b) landed.push({ id, bounds: { x: b.x, y: b.y, w: b.w, h: b.h }, kind: 'landed', startedAt })
		}
		this.addChangeGhosts(landed)
	}

	/** Show ghosts alongside any still fading, and clear them all once the last one has faded. */
	private addChangeGhosts(ghosts: ChangeGhost[]) {
		if (ghosts.length === 0 || prefersReducedMotion()) return
		const now = Date.now()
		this.$changeGhosts.update((current) => [
			...current.filter((g) => now - g.startedAt < CHANGE_GHOST_MS),
			...ghosts,
		])
		if (this.changeGhostTimeout) clearTimeout(this.changeGhostTimeout)
		this.changeGhostTimeout = setTimeout(() => {
			this.$changeGhosts.set([])
			this.changeGhostTimeout = null
		}, CHANGE_GHOST_MS)
	}

	private getPageShapeBounds() {
		const { editor } = this.agent
		const map = new Map<string, ChangeGhost['bounds']>()
		for (const id of editor.getCurrentPageShapeIds()) {
			const b = editor.getShapePageBounds(id)
			if (b) map.set(id, { x: b.x, y: b.y, w: b.w, h: b.h })
		}
		return map
	}

	/** When the current protected flash started, so the overlay can fade it in and out. */
	getProtectedFlashStartedAt(): number {
		return this.protectedFlashStartedAt
	}

	/**
	 * Rebuild action utils for a specific mode.
	 * Called when the agent's mode changes to ensure mode-specific
	 * action utils are used.
	 *
	 * @param mode - The mode to rebuild utils for.
	 */
	rebuildUtilsForMode(mode: string): void {
		this.agentActionUtils = getAgentActionUtilsRecordForMode(this.agent, mode)
		this.unknownActionUtil = this.agentActionUtils.unknown
	}

	/**
	 * Get an agent action util for a specific action type.
	 *
	 * @param type - The type of action to get the util for.
	 * @returns The action util.
	 */
	getAgentActionUtil(type?: string) {
		const utilType = this.getAgentActionUtilType(type)
		return this.agentActionUtils[utilType]
	}

	/**
	 * Get the util type for a provided action type.
	 * If no util type is found, returns 'unknown'.
	 * @param type - The action type to get the util type for.
	 * @returns The action util type, or 'unknown' if not found.
	 */
	getAgentActionUtilType(type?: string): AgentAction['_type'] {
		if (!type) return 'unknown'
		const util = this.agentActionUtils[type as AgentAction['_type']]
		if (!util) return 'unknown'
		return type as AgentAction['_type']
	}

	/**
	 * Make the agent perform an action.
	 * Applies the action to the editor and tracks it in chat history.
	 * @param action - The action to make the agent do.
	 * @param helpers - The helpers to use for action execution.
	 * @param baseRev - The board revision the agent read before it chose this action.
	 * @returns An object containing the diff of changes made and a promise that resolves when the action completes.
	 */
	act(
		action: Streaming<AgentAction>,
		helpers: AgentHelpers = new AgentHelpers(this.agent),
		baseRev: number = this.agent.commands.getRev()
	): {
		diff: RecordsDiff<TLRecord>
		promise: Promise<void> | null
	} {
		const { editor } = this.agent
		if (action.complete) {
			action = {
				...parseAgentAction(action, this.agent.mode.getCurrentModeType()),
				complete: true,
				time: action.time,
			}
		}
		const util = this.getAgentActionUtil(action._type)
		this.agent.setIsActingOnEditor(true)

		let promise: Promise<void> | null = null
		let diff: RecordsDiff<TLRecord>
		let rejected = false
		let commandId: string | null = null
		try {
			const apply = () => {
				promise = util.applyAction(structuredClone(action), helpers) ?? null
			}
			if (action.complete) {
				const result = this.agent.commands.execute('agent', action._type, apply, {
					baseRev,
					allowedShapeIds: this.agent.getAllowedShapeIds(),
					...this.agent.getPassIds(),
				})
				diff = result.changes
				if (result.status === 'applied') {
					commandId = result.commandId
					this.markLanded(Object.keys(result.changes.added))
					this.noteWork(action, result.changes)
				}
				if (result.status === 'rejected') {
					rejected = true
					this.reportRejectedCommand(action._type, result)
				}
			} else {
				diff = this.agent.commands.withoutRecording(() => editor.store.extractingChanges(apply))
			}
		} catch (error) {
			// always toast the error
			this.agent.onError(error)
			promise = null
			throw error // you may not want to throw in productions
		} finally {
			this.agent.setIsActingOnEditor(false)
		}

		// Add the action to chat history
		if (util.savesToHistory() && !rejected) {
			const historyItem: ChatHistoryItem = {
				type: 'action',
				action,
				diff,
				acceptance: 'pending',
				passId: this.agent.getPassIds().passId,
				commandId,
			}

			this.agent.chat.update((historyItems) => {
				// If there are no items, start off the chat history with the first item
				if (historyItems.length === 0) return [historyItem]

				// Find the last EXTERNAL prompt index (ignore prompts from 'self' which are internal state transitions)
				const lastPromptIndex = historyItems.findLastIndex(
					(item) => item.type === 'prompt' && item.promptSource !== 'self'
				)

				// If the last action is still in progress AND it's after the last external prompt, replace it
				const lastActionHistoryItemIndex = historyItems.findLastIndex(
					(item) => item.type === 'action'
				)
				const lastActionHistoryItem =
					lastActionHistoryItemIndex !== -1 ? historyItems[lastActionHistoryItemIndex] : null
				if (
					lastActionHistoryItem &&
					lastActionHistoryItem.type === 'action' &&
					!lastActionHistoryItem.action.complete &&
					(lastPromptIndex === -1 || lastActionHistoryItemIndex > lastPromptIndex)
				) {
					const newHistoryItems = [...historyItems]
					// Replace the incomplete action with the complete one (timestamp already set above)
					newHistoryItems[lastActionHistoryItemIndex] = historyItem
					return newHistoryItems
				} else {
					// Otherwise, just add the new item to the end of the list
					return [...historyItems, historyItem]
				}
			})
		}

		return { diff, promise }
	}

	/**
	 * Tell the agent that a command was rejected, so that its next pass reads the
	 * current board and works around the change. Rejection notices can start a
	 * few follow-up passes per user request, so an agent that keeps aiming at the
	 * same shapes cannot loop.
	 */
	reportRejectedCommand(type: string, result: RejectedCommandResult) {
		const recordIds = result.reason === 'stale' ? result.staleRecordIds : result.protectedRecordIds
		const ids = recordIds.map((id) => id.replace(/^(shape|binding):/, ''))
		const message =
			result.reason === 'stale'
				? `Your "${type}" action was rejected and nothing from it was applied, because the user changed these shapes after you read the board: ${ids.join(', ')}. Keep the user's changes. Look at the current board before you change those shapes again, and redo the action only if it is still needed.`
				: `Your "${type}" action was rejected and nothing from it was applied, because it would change, move, or cover the user's own work: ${ids.join(', ')}. Shapes the user made, and frames they drew with everything inside, are theirs. Leave them as they are, and put your work in clear space that does not overlap them. Change the user's work only when they select it or ask you to.`
		console.warn(`Rejected ${result.reason} agent command "${type}":`, ids)
		if (result.reason === 'protected') this.flashProtected(recordIds as TLShapeId[])

		if (!this.rejectionNoticePending) {
			if (this.rejectionPasses >= MAX_REJECTION_PASSES) {
				console.warn('Rejection notice not sent: this request has used its follow-up passes.')
				return
			}
			this.rejectionPasses++
			this.rejectionNoticePending = true
		}
		this.agent.schedule({ agentMessages: [message], source: 'self' })
	}

	private flashProtected(ids: TLShapeId[]) {
		// Stamp the start first: the overlay reads it when the flash list changes.
		this.protectedFlashStartedAt = Date.now()
		this.$protectedFlash.update((current) => [...new Set([...current, ...ids])])
		if (this.protectedFlashTimeout) clearTimeout(this.protectedFlashTimeout)
		this.protectedFlashTimeout = setTimeout(() => {
			this.$protectedFlash.set([])
			this.protectedFlashTimeout = null
		}, PROTECTED_FLASH_MS)
	}
}

function prefersReducedMotion(): boolean {
	return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}
