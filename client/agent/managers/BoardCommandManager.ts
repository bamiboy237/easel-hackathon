import { atom, Editor, RecordsDiff, reverseRecordsDiff, squashRecordDiffs, TLRecord } from 'tldraw'
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
}

export type BoardCommandResult =
	| { status: 'applied'; changes: RecordsDiff<TLRecord> }
	| { status: 'rejected'; changes: RecordsDiff<TLRecord>; staleRecordIds: string[] }

export class BoardCommandManager {
	private history = atom<readonly BoardCommand[]>('board commands', [])
	private rev = 0
	/** The last revision at which a user or voice command changed each record. */
	private humanRevs = new Map<string, number>()
	private pendingUserChanges = emptyChanges()
	private recordingDepth = 0
	private cleanups: (() => void)[] = []

	constructor(private editor: Editor) {
		const { store } = editor
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

	/** The current board revision. It increases by one with each applied command. */
	getRev(): number {
		return this.rev
	}

	/**
	 * Run a command and record it. An agent command whose records a user or voice
	 * command changed after its base revision is stale: its changes are rolled
	 * back, and it is recorded as rejected.
	 */
	execute(
		origin: CommandOrigin,
		type: string,
		apply: () => void,
		{ baseRev }: ExecuteOptions = {}
	): BoardCommandResult {
		CommandOriginSchema.parse(origin)
		if (!type) throw new Error('A board command must have a type.')
		if (origin === 'agent' && baseRev === undefined) {
			throw new Error('An agent command must carry the board revision it was based on.')
		}
		const changes = this.withoutRecording(() => this.editor.store.extractingChanges(apply))
		const staleRecordIds = baseRev === undefined ? [] : this.getStaleRecordIds(changes, baseRev)
		if (staleRecordIds.length > 0) {
			this.withoutRecording(() =>
				this.editor.store.applyDiff(reverseRecordsDiff(changes), { runCallbacks: false })
			)
			this.record(origin, type, changes, { baseRev, staleRecordIds })
			return { status: 'rejected', changes: emptyChanges(), staleRecordIds }
		}
		this.record(origin, type, changes, { baseRev })
		return { status: 'applied', changes }
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
		{ baseRev, staleRecordIds }: { baseRev?: number; staleRecordIds?: string[] } = {}
	) {
		const { store } = this.editor
		const isDocumentRecord = (record: TLRecord) => store.scopedTypes.document.has(record.typeName)
		const rejected = staleRecordIds !== undefined
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
		if (ids.length === 0) return
		const command = BoardCommandSchema.parse({
			commandId: crypto.randomUUID(),
			origin,
			type,
			status: rejected ? 'rejected' : 'applied',
			rev: rejected ? null : this.rev + 1,
			baseRev,
			staleRecordIds,
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
	}
}
