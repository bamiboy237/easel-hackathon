import { atom, Editor, RecordsDiff, squashRecordDiffs, TLRecord } from 'tldraw'
import {
	BoardCommand,
	BoardCommandSchema,
	CommandOrigin,
	CommandOriginSchema,
} from '../../../shared/schema/BoardCommand'

function emptyChanges(): RecordsDiff<TLRecord> {
	return { added: {}, updated: {}, removed: {} }
}

export class BoardCommandManager {
	private history = atom<readonly BoardCommand[]>('board commands', [])
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

	execute(origin: CommandOrigin, type: string, apply: () => void): RecordsDiff<TLRecord> {
		CommandOriginSchema.parse(origin)
		if (!type) throw new Error('A board command must have a type.')
		const changes = this.withoutRecording(() => this.editor.store.extractingChanges(apply))
		this.record(origin, type, changes)
		return changes
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

	private record(origin: CommandOrigin, type: string, changes: RecordsDiff<TLRecord>) {
		const { store } = this.editor
		const isDocumentRecord = (record: TLRecord) => store.scopedTypes.document.has(record.typeName)
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
		if (
			[payload.added, payload.updated, payload.removed]
				.every((group) => Object.keys(group).length === 0)
		) {
			return
		}
		const command = BoardCommandSchema.parse({
			commandId: crypto.randomUUID(),
			origin,
			type,
			payload,
			createdAt: Date.now(),
		})
		for (const record of Object.values(command.payload.added)) {
			store.schema.validateRecord(store, record, 'createRecord', null)
		}
		for (const [before, after] of Object.values(command.payload.updated)) {
			store.schema.validateRecord(store, after, 'updateRecord', before)
		}
		this.history.update((history) => [...history, command])
	}
}
