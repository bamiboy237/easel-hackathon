import {
	atom,
	Box,
	Editor,
	RecordsDiff,
	reverseRecordsDiff,
	squashRecordDiffs,
	TLBinding,
	TLRecord,
	TLShape,
	TLShapeId,
} from 'tldraw'
import {
	BoardCommand,
	BoardCommandSchema,
	CommandOrigin,
	CommandOriginSchema,
} from '../../../shared/schema/BoardCommand'

function emptyChanges(): RecordsDiff<TLRecord> {
	return { added: {}, updated: {}, removed: {} }
}

export interface ExecuteOptions {
	/** The board revision the command was based on. Required for agent commands. */
	baseRev?: number
	/**
	 * Protected shapes the current request asked the agent to change: selected,
	 * added as context, or named in the request. Shapes inside them count too.
	 */
	allowedShapeIds?: ReadonlySet<string>
	/** The agent pass the command came from, one per model request. */
	passId?: string
	/** The user request the pass belongs to, shared by its follow-up passes. */
	requestId?: string
	/** For a revert or restore, the commands it undid and the records it kept. */
	revertedCommandIds?: string[]
	keptRecordIds?: string[]
}

/** A record a revert left as it is, and why. */
export interface KeptRecord {
	id: string
	/**
	 * - `edited`: a later human command changed it.
	 * - `connected`: the user bound their own shape to it.
	 * - `deleted`: a later command deleted it, so there is nothing to restore.
	 */
	reason: 'edited' | 'connected' | 'deleted'
}

export interface RevertResult {
	/** The command the revert recorded, or null when there was nothing to change. */
	commandId: string | null
	kept: KeptRecord[]
}

export type BoardCommandResult =
	| { status: 'applied'; commandId: string | null; changes: RecordsDiff<TLRecord> }
	| {
			status: 'rejected'
			reason: 'stale'
			changes: RecordsDiff<TLRecord>
			staleRecordIds: string[]
	  }
	| {
			status: 'rejected'
			reason: 'protected'
			changes: RecordsDiff<TLRecord>
			protectedRecordIds: string[]
	  }

/** Who created a shape. Stored in `shape.meta.createdBy`, so it persists with the board. */
export type ShapeCreator = 'user' | 'agent' | 'voice'

export function getShapeCreator(shape: TLShape): ShapeCreator | undefined {
	const creator = shape.meta.createdBy
	return creator === 'user' || creator === 'agent' || creator === 'voice' ? creator : undefined
}

type ShapeLookup = (id: string) => TLShape | undefined

// Shapes that only touch at an edge do not overlap.
const OVERLAP_TOLERANCE = 2

function sameValue(a: unknown, b: unknown): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Three-way merge for one record: take each property back to `before` when the
 * reverted change set it and nothing changed it since. Properties changed
 * since keep their current value. Returns the merged record and whether any
 * property kept a newer value.
 */
function mergeBack<R extends TLRecord>(before: R, after: R, current: R): { record: R; keptNewer: boolean } {
	let keptNewer = false
	const mergeLevel = (b: any, a: any, c: any): any => {
		const result = { ...c }
		const keys = new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])
		for (const key of keys) {
			if (key === 'id' || key === 'typeName') continue
			if (sameValue(b?.[key], a?.[key])) continue
			if (sameValue(c?.[key], a?.[key])) {
				if (b && key in b) result[key] = b[key]
				else delete result[key]
			} else if ((key === 'props' || key === 'meta') && c?.[key] && typeof c[key] === 'object') {
				result[key] = mergeLevel(b?.[key], a?.[key], c[key])
			} else {
				keptNewer = true
			}
		}
		return result
	}
	return { record: mergeLevel(before, after, current) as R, keptNewer }
}

function overlaps(a: Box, b: Box): boolean {
	const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
	const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)
	return w > OVERLAP_TOLERANCE && h > OVERLAP_TOLERANCE
}

export class BoardCommandManager {
	private history = atom<readonly BoardCommand[]>('board commands', [])
	private rev = 0
	/** The last revision at which a user or voice command changed each record. */
	private humanRevs = new Map<string, number>()
	private pendingUserChanges = emptyChanges()
	private recordingDepth = 0
	/** The origin of the command being executed, used to stamp the shapes it creates. */
	private executingOrigin: CommandOrigin | null = null
	/** Off while a revert restores records, so restored shapes keep their original creator. */
	private stampsCreator = true
	private cleanups: (() => void)[] = []

	constructor(private editor: Editor) {
		const { store } = editor
		// Stamp each new shape with its creator. Remote changes, such as a loaded
		// board, keep what they have. A shape that already has a creator keeps it,
		// so undo and redo do not change who owns a shape.
		this.cleanups.push(
			store.sideEffects.registerBeforeCreateHandler('shape', (shape, source) => {
				if (source !== 'user' || !this.stampsCreator || getShapeCreator(shape)) return shape
				const createdBy: ShapeCreator =
					this.recordingDepth > 0 ? (this.executingOrigin ?? 'agent') : 'user'
				return { ...shape, meta: { ...shape.meta, createdBy } }
			})
		)
		for (const type of store.scopedTypes.document) {
			this.cleanups.push(
				store.sideEffects.registerAfterCreateHandler(type, (record, source) => {
					if (source !== 'user' || this.recordingDepth > 0) return
					this.collect({ added: { [record.id]: record }, updated: {}, removed: {} })
				}),
				store.sideEffects.registerAfterChangeHandler(type, (before, after, source) => {
					if (source !== 'user' || this.recordingDepth > 0) return
					const updated: RecordsDiff<TLRecord>['updated'] = {}
					updated[before.id] = [before, after]
					this.collect({ added: {}, updated, removed: {} })
				}),
				store.sideEffects.registerAfterDeleteHandler(type, (record, source) => {
					if (source !== 'user' || this.recordingDepth > 0) return
					this.collect({ added: {}, updated: {}, removed: { [record.id]: record } })
				})
			)
		}
		this.cleanups.push(
			store.sideEffects.registerOperationCompleteHandler(() => {
				const changes = this.pendingUserChanges
				this.pendingUserChanges = emptyChanges()
				this.record('user', 'document-change', changes)
			})
		)
	}

	getHistory(): readonly BoardCommand[] {
		return this.history.get()
	}

	/**
	 * Replace the log with commands loaded from the board store, after the board
	 * itself was rebuilt from them. Revisions and stale checks continue from there.
	 */
	restore(commands: readonly unknown[]) {
		const restored: BoardCommand[] = []
		for (const command of commands) {
			const parsed = BoardCommandSchema.safeParse(command)
			if (parsed.success) restored.push(parsed.data)
			else console.warn('Skipped a stored command that does not match the schema.', parsed.error)
		}
		this.rev = Math.max(0, ...restored.map((command) => command.rev ?? 0))
		this.humanRevs.clear()
		for (const command of restored) {
			if (command.status !== 'applied' || command.origin === 'agent') continue
			for (const id of [command.payload.added, command.payload.updated, command.payload.removed].flatMap(Object.keys)) {
				this.humanRevs.set(id, command.rev!)
			}
		}
		this.history.set(restored)
	}

	/** The current board revision. It increases by one with each applied command. */
	getRev(): number {
		return this.rev
	}

	/**
	 * Run a command and record it. An agent command is rejected, with its changes
	 * rolled back, when either check fails:
	 * - Stale: a user or voice command changed one of its records after its base revision.
	 * - Protected: it changes, moves, or deletes a shape the user owns, or places a
	 *   shape over one, and the current request did not ask for that.
	 */
	execute(
		origin: CommandOrigin,
		type: string,
		apply: () => void,
		{
			baseRev,
			allowedShapeIds = new Set(),
			passId,
			requestId,
			revertedCommandIds,
			keptRecordIds,
		}: ExecuteOptions = {}
	): BoardCommandResult {
		CommandOriginSchema.parse(origin)
		if (!type) throw new Error('A board command must have a type.')
		if (origin === 'agent' && baseRev === undefined) {
			throw new Error('An agent command must carry the board revision it was based on.')
		}
		const checksProtection = origin === 'agent'
		const overlapsBefore = checksProtection ? this.getProtectedOverlaps(allowedShapeIds) : new Set<string>()
		const previousOrigin = this.executingOrigin
		this.executingOrigin = origin
		let changes: RecordsDiff<TLRecord>
		try {
			changes = this.withoutRecording(() => this.editor.store.extractingChanges(apply))
		} finally {
			this.executingOrigin = previousOrigin
		}
		const rollBack = () =>
			this.withoutRecording(() =>
				this.editor.store.applyDiff(reverseRecordsDiff(changes), { runCallbacks: false })
			)

		const staleRecordIds = baseRev === undefined ? [] : this.getStaleRecordIds(changes, baseRev)
		if (staleRecordIds.length > 0) {
			rollBack()
			this.record(origin, type, changes, { baseRev, passId, requestId, reason: 'stale', staleRecordIds })
			return { status: 'rejected', reason: 'stale', changes: emptyChanges(), staleRecordIds }
		}

		const protectedRecordIds = checksProtection
			? this.getProtectedViolations(changes, allowedShapeIds, overlapsBefore)
			: []
		if (protectedRecordIds.length > 0) {
			rollBack()
			this.record(origin, type, changes, {
				baseRev,
				passId,
				requestId,
				reason: 'protected',
				protectedRecordIds,
			})
			return { status: 'rejected', reason: 'protected', changes: emptyChanges(), protectedRecordIds }
		}

		const commandId = this.record(origin, type, changes, {
			baseRev,
			passId,
			requestId,
			revertedCommandIds,
			keptRecordIds,
		})
		return { status: 'applied', commandId, changes }
	}

	/** The applied agent commands from one pass, or from every pass of one request. */
	getAgentCommandIds({ passId, requestId }: { passId?: string; requestId?: string }): string[] {
		return this.getHistory()
			.filter(
				(command) =>
					command.status === 'applied' &&
					command.origin === 'agent' &&
					((passId !== undefined && command.passId === passId) ||
						(requestId !== undefined && command.requestId === requestId))
			)
			.map((command) => command.commandId)
	}

	/**
	 * Undo applied commands, and keep newer human work. Runs as one user command
	 * of the given type, built from the command log. For each record the commands
	 * touched:
	 * - Nothing changed it since: it goes back to its earlier version.
	 * - A later command changed some of its properties: only the properties
	 *   nobody changed since go back.
	 * - A shape the commands created that the user has since edited, or bound
	 *   their own shape to, stays.
	 * Shapes that move into a deleted container keep their place on the page.
	 * Reverting a revert restores the work it undid, the same way.
	 */
	revert(commandIds: readonly string[], type: 'revert' | 'restore' = 'revert'): RevertResult {
		const { editor } = this
		const ids = new Set(commandIds)
		const history = this.getHistory()
		const reverted = history.filter((c) => ids.has(c.commandId) && c.status === 'applied')
		if (reverted.length === 0) return { commandId: null, kept: [] }

		const touches = (command: BoardCommand, id: string) =>
			id in command.payload.added || id in command.payload.updated || id in command.payload.removed
		const lastRev = new Map<string, number>()
		for (const command of reverted) {
			for (const id of [command.payload.added, command.payload.updated, command.payload.removed].flatMap(Object.keys)) {
				lastRev.set(id, Math.max(lastRev.get(id) ?? 0, command.rev ?? 0))
			}
		}
		const firstRev = Math.min(...reverted.map((c) => c.rev ?? 0))
		const later = history.filter((c) => c.status === 'applied' && !ids.has(c.commandId))
		// Other reverts and restores are not edits, so reverting passes in any order
		// gives the same result.
		const isHumanEdit = (c: BoardCommand) => c.origin !== 'agent' && c.type !== 'revert' && c.type !== 'restore'
		const humanChangedSince = (id: string, rev: number) =>
			later.some((c) => isHumanEdit(c) && (c.rev ?? 0) > rev && touches(c, id))

		const diff = squashRecordDiffs(reverted.map((c) => c.payload as RecordsDiff<TLRecord>))
		const kept: KeptRecord[] = []
		const toDelete: TLShapeId[] = []
		const toRemove: TLRecord['id'][] = []
		const toPut: TLRecord[] = []
		const restoreShapes: TLShape[] = []
		const restoreOthers: TLRecord[] = []

		for (const record of Object.values(diff.added)) {
			const current = editor.store.get(record.id)
			if (!current) continue
			if (humanChangedSince(record.id, lastRev.get(record.id) ?? firstRev)) {
				kept.push({ id: record.id, reason: 'edited' })
				continue
			}
			if (current.typeName === 'shape') {
				const connected = editor
					.getBindingsInvolvingShape(current.id)
					.some((binding: TLBinding) => !(binding.id in diff.added) && humanChangedSince(binding.id, firstRev))
				if (connected) {
					kept.push({ id: record.id, reason: 'connected' })
					continue
				}
				toDelete.push(current.id)
			} else {
				toRemove.push(current.id)
			}
		}

		for (const [before, after] of Object.values(diff.updated)) {
			const current = editor.store.get(after.id)
			if (!current) {
				kept.push({ id: after.id, reason: 'deleted' })
				continue
			}
			const { record, keptNewer } = mergeBack(before, after, current)
			if (keptNewer && humanChangedSince(after.id, lastRev.get(after.id) ?? firstRev)) {
				kept.push({ id: after.id, reason: 'edited' })
			}
			if (!sameValue(record, current)) toPut.push(record)
		}

		for (const record of Object.values(diff.removed)) {
			if (editor.store.has(record.id)) continue
			if (record.typeName === 'shape') restoreShapes.push(record)
			else restoreOthers.push(record)
		}

		const apply = () => {
			editor.run(
				() => {
					// Restore deleted shapes first, so updates and bindings can refer to them.
					if (restoreShapes.length > 0) {
						const restoring = new Set<string>(restoreShapes.map((shape) => shape.id))
						const pageId = editor.getCurrentPageId()
						editor.store.put(
							restoreShapes.map((shape) =>
								restoring.has(shape.parentId) || editor.store.has(shape.parentId)
									? shape
									: { ...shape, parentId: pageId }
							)
						)
					}
					if (toPut.length > 0) editor.store.put(toPut)
					if (toDelete.length > 0) {
						// Keep shapes that are not being reverted, such as the user's own note
						// inside an agent frame, where they are on the page.
						const deleting = new Set<string>(toDelete)
						for (const id of toDelete) {
							const survivors = editor.getSortedChildIdsForParent(id).filter((child) => !deleting.has(child))
							if (survivors.length === 0) continue
							let target = editor.getShape(id)?.parentId
							while (target && deleting.has(target)) target = editor.getShape(target as TLShapeId)?.parentId
							editor.reparentShapes(survivors, target ?? editor.getCurrentPageId())
						}
						editor.deleteShapes(toDelete)
					}
					const leftover = toRemove.filter((id) => editor.store.has(id))
					if (leftover.length > 0) editor.store.remove(leftover)
					const others = restoreOthers.filter((record) => {
						if (record.typeName !== 'binding') return true
						const binding = record as TLBinding
						return editor.store.has(binding.fromId) && editor.store.has(binding.toId)
					})
					if (others.length > 0) editor.store.put(others)
				},
				{ ignoreShapeLock: true, history: 'ignore' }
			)
		}

		this.stampsCreator = false
		let result: BoardCommandResult
		try {
			result = this.execute('user', type, apply, {
				revertedCommandIds: reverted.map((c) => c.commandId),
				keptRecordIds: kept.map((k) => k.id),
			})
		} finally {
			this.stampsCreator = true
		}
		const commandId = result.status === 'applied' ? result.commandId : null
		return { commandId, kept }
	}

	/**
	 * The shape that protects a shape from agent changes, or undefined. A shape is
	 * protected when the user created it, or when it sits inside a frame the user
	 * created. A frame the user draws is their region.
	 */
	getProtector(id: string, lookup: ShapeLookup = this.currentShape): TLShape | undefined {
		const shape = lookup(id)
		if (!shape) return undefined
		if (getShapeCreator(shape) === 'user') return shape
		for (let parent = lookup(shape.parentId); parent; parent = lookup(parent.parentId)) {
			if (parent.type === 'frame' && getShapeCreator(parent) === 'user') return parent
		}
		return undefined
	}

	// Preview updates and their replacements are not separate commands.
	withoutRecording<T>(apply: () => T): T {
		this.recordingDepth++
		try {
			return apply()
		} finally {
			this.recordingDepth--
		}
	}

	dispose() {
		for (const cleanup of this.cleanups) cleanup()
		this.cleanups = []
	}

	private currentShape: ShapeLookup = (id) => {
		const record = this.editor.store.get(id as TLShapeId)
		return record?.typeName === 'shape' ? record : undefined
	}

	private isAllowed(id: string, allowed: ReadonlySet<string>, lookup: ShapeLookup): boolean {
		if (allowed.size === 0) return false
		for (let shape = lookup(id); shape; shape = lookup(shape.parentId)) {
			if (allowed.has(shape.id)) return true
		}
		return false
	}

	/**
	 * The protected shapes an agent shape may not cover: user-created shapes that are
	 * not inside a user frame, and user frames. A shape inside a user frame is covered
	 * by its frame.
	 */
	private getProtectedRoots(allowed: ReadonlySet<string>): TLShape[] {
		const lookup = this.currentShape
		return this.editor.getCurrentPageShapes().filter((shape) => {
			if (this.getProtector(shape.id) !== shape) return false
			return !this.isAllowed(shape.id, allowed, lookup)
		})
	}

	// Pairs of an unprotected shape and a protected root that already overlap, so
	// that an agent can keep editing a shape the user placed their work on.
	private getProtectedOverlaps(allowed: ReadonlySet<string>): Set<string> {
		const pairs = new Set<string>()
		const roots = this.getProtectedRoots(allowed)
		if (roots.length === 0) return pairs
		const rootBounds = roots.map((root) => [root, this.editor.getShapePageBounds(root)] as const)
		for (const shape of this.editor.getCurrentPageShapes()) {
			if (this.getProtector(shape.id)) continue
			const bounds = this.editor.getShapePageBounds(shape)
			if (!bounds) continue
			for (const [root, other] of rootBounds) {
				if (other && overlaps(bounds, other)) pairs.add(`${shape.id}|${root.id}`)
			}
		}
		return pairs
	}

	/** The protected shapes an agent command would change, move, delete, or cover. */
	private getProtectedViolations(
		changes: RecordsDiff<TLRecord>,
		allowed: ReadonlySet<string>,
		overlapsBefore: ReadonlySet<string>
	): string[] {
		const { editor } = this
		const after = this.currentShape
		const updated = changes.updated as Record<string, [TLRecord, TLRecord]>
		const removed = changes.removed as Record<string, TLRecord>
		const before: ShapeLookup = (id) => {
			const record =
				updated[id]?.[0] ??
				removed[id] ??
				(id in changes.added ? undefined : editor.store.get(id as TLShapeId))
			return record?.typeName === 'shape' ? record : undefined
		}
		const violations = new Set<string>()
		const check = (id: string, lookup: ShapeLookup) => {
			const protector = this.getProtector(id, lookup)
			if (protector && !this.isAllowed(id, allowed, lookup)) violations.add(protector.id)
			return protector
		}

		const placed: TLShapeId[] = []
		for (const record of Object.values(changes.removed)) {
			if (record.typeName === 'shape') check(record.id, before)
		}
		for (const record of Object.values(changes.added)) {
			if (record.typeName !== 'shape') continue
			if (!check(record.id, after)) placed.push(record.id)
		}
		for (const [prev, next] of Object.values(changes.updated)) {
			if (next.typeName !== 'shape' || prev.typeName !== 'shape') continue
			// A protected shape, or a shape moved into a user region.
			if (check(next.id, before) || check(next.id, after)) continue
			placed.push(next.id)
			// Moving a shape moves what is inside it.
			const moved =
				prev.x !== next.x ||
				prev.y !== next.y ||
				prev.rotation !== next.rotation ||
				prev.parentId !== next.parentId
			if (!moved) continue
			for (const id of editor.getShapeAndDescendantIds([next.id])) {
				if (id !== next.id) check(id, after)
			}
		}

		// Covering protected shapes: a new shape, or an edited one that newly overlaps.
		const roots = this.getProtectedRoots(allowed)
		if (placed.length > 0 && roots.length > 0) {
			for (const id of placed) {
				const bounds = editor.getShapePageBounds(id)
				if (!bounds) continue
				const ancestors = new Set(editor.getShapeAncestors(id).map((shape) => shape.id))
				const bound = new Set<string>(
					editor.getBindingsFromShape(id, 'arrow').map((binding) => binding.toId)
				)
				for (const root of roots) {
					if (ancestors.has(root.id) || bound.has(root.id)) continue
					if (id in changes.updated && overlapsBefore.has(`${id}|${root.id}`)) continue
					const other = editor.getShapePageBounds(root)
					if (other && overlaps(bounds, other)) violations.add(root.id)
				}
			}
		}
		return [...violations]
	}

	private collect(changes: RecordsDiff<TLRecord>) {
		this.pendingUserChanges = squashRecordDiffs([this.pendingUserChanges, changes])
	}

	// Every record a command touches is a target. Creating a record on a new ID
	// never conflicts, because no human command can have changed it.
	private getStaleRecordIds(changes: RecordsDiff<TLRecord>, baseRev: number): string[] {
		const ids = [
			...Object.keys(changes.added),
			...Object.keys(changes.updated),
			...Object.keys(changes.removed),
		]
		return ids.filter((id) => (this.humanRevs.get(id) ?? -1) > baseRev)
	}

	private record(
		origin: CommandOrigin,
		type: string,
		changes: RecordsDiff<TLRecord>,
		{
			baseRev,
			passId,
			requestId,
			reason,
			staleRecordIds,
			protectedRecordIds,
			revertedCommandIds,
			keptRecordIds,
		}: {
			baseRev?: number
			passId?: string
			requestId?: string
			reason?: 'stale' | 'protected'
			staleRecordIds?: string[]
			protectedRecordIds?: string[]
			revertedCommandIds?: string[]
			keptRecordIds?: string[]
		} = {}
	) {
		const { store } = this.editor
		const isDocumentRecord = (record: TLRecord) => store.scopedTypes.document.has(record.typeName)
		const rejected = reason !== undefined
		const payload = {
			added: Object.fromEntries(
				Object.entries(changes.added).filter(([, record]) => isDocumentRecord(record))
			),
			updated: Object.fromEntries(
				Object.entries(changes.updated).filter(([, [, after]]) => isDocumentRecord(after))
			),
			removed: Object.fromEntries(
				Object.entries(changes.removed).filter(([, record]) => isDocumentRecord(record))
			),
		}
		const ids = [payload.added, payload.updated, payload.removed].flatMap(Object.keys)
		if (ids.length === 0) return null
		const command = BoardCommandSchema.parse({
			commandId: crypto.randomUUID(),
			origin,
			type,
			status: rejected ? 'rejected' : 'applied',
			rev: rejected ? null : this.rev + 1,
			baseRev,
			passId,
			requestId,
			reason,
			staleRecordIds,
			protectedRecordIds,
			revertedCommandIds,
			keptRecordIds,
			payload,
			createdAt: Date.now(),
		})
		if (!rejected) {
			for (const record of Object.values(command.payload.added)) {
				store.schema.validateRecord(store, record, 'createRecord', null)
			}
			for (const [before, after] of Object.values(command.payload.updated)) {
				store.schema.validateRecord(store, after, 'updateRecord', before)
			}
			this.rev++
			if (origin !== 'agent') {
				for (const id of ids) this.humanRevs.set(id, this.rev)
			}
		}
		this.history.update((history) => [...history, command])
		return command.commandId
	}
}
