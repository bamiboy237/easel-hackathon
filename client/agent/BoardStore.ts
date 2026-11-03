import { Editor, getSnapshot, loadSnapshot, react, RecordsDiff, TLRecord } from 'tldraw'
import { BoardCommand } from '../../shared/schema/BoardCommand'
import { BoardCommandManager } from './managers/BoardCommandManager'

/** Save a snapshot after this many new commands... */
const SNAPSHOT_EVERY_COMMANDS = 25
/** ...or after this long with unsaved commands. */
const SNAPSHOT_EVERY_MS = 2 * 60_000
const SNAPSHOT_CHECK_MS = 15_000
/** Browsers cap keepalive request bodies at 64 KB. */
const KEEPALIVE_LIMIT = 60_000

/** Read-only holds per editor, so overlapping loads restore the editor's own setting. */
const readonlyHolds = new WeakMap<Editor, { count: number; wasReadonly: boolean }>()

function holdReadonly(editor: Editor) {
	const hold = readonlyHolds.get(editor) ?? { count: 0, wasReadonly: editor.getInstanceState().isReadonly }
	hold.count++
	readonlyHolds.set(editor, hold)
	editor.updateInstanceState({ isReadonly: true })
	return () => {
		hold.count--
		if (hold.count > 0) return
		readonlyHolds.delete(editor)
		editor.updateInstanceState({ isReadonly: hold.wasReadonly })
	}
}

interface StoredBoard {
	snapshot: { rev: number; savedAt: number; document: any } | null
	commands: BoardCommand[]
}

/**
 * Keeps the board in the local board store. Each command is appended as it is
 * recorded, and a full snapshot is saved periodically. On load, the board is
 * the latest snapshot plus the commands recorded after it, and the command log
 * comes back with it, so revert works on commands from before a reload.
 */
export class BoardStore {
	private persisted = 0
	private queue: BoardCommand[] = []
	private flushing: Promise<void> | null = null
	private commandsSinceSnapshot = 0
	private lastSnapshotAt = Date.now()
	private snapshotting = false
	private cleanups: (() => void)[] = []
	private disposed = false

	constructor(
		private editor: Editor,
		private commands: BoardCommandManager,
		/** Whether an agent is mid-pass. Its previews are not commands, so no snapshot is taken then. */
		private isAgentBusy: () => boolean,
		private boardId = 'default'
	) {}

	async load(): Promise<void> {
		const { editor } = this
		// Hold edits until the board is back, so nothing lands on the old state.
		const release = holdReadonly(editor)
		try {
			const response = await fetch(`/board/${this.boardId}`)
			if (!response.ok) throw new Error(`Could not load the board (${response.status}).`)
			const stored = (await response.json()) as StoredBoard
			if (this.disposed) return

			if (!stored.snapshot && stored.commands.length === 0) {
				// A new board store starts from the board the browser already has.
				this.watch()
				await this.saveSnapshot()
				return
			}

			const fromRev = stored.snapshot?.rev ?? 0
			const replay = stored.commands
				.filter((command) => command.status === 'applied' && (command.rev ?? 0) > fromRev)
				.sort((a, b) => (a.rev ?? 0) - (b.rev ?? 0))
			// Remote changes are not recorded as new commands.
			editor.store.mergeRemoteChanges(() => {
				if (stored.snapshot) loadSnapshot(editor.store, { document: stored.snapshot.document })
				for (const command of replay) {
					editor.store.applyDiff(command.payload as RecordsDiff<TLRecord>)
				}
			})
			this.commands.restore(stored.commands)
			this.persisted = this.commands.getHistory().length
			this.lastSnapshotAt = stored.snapshot?.savedAt ?? 0
			this.commandsSinceSnapshot = replay.length
			this.watch()
			console.info(
				`Loaded the board: snapshot at rev ${fromRev}, ${replay.length} commands replayed, ${stored.commands.length} in the log.`
			)
		} finally {
			release()
		}
	}

	/** Write any commands that are not stored yet. */
	flush(): Promise<void> {
		if (this.flushing) return this.flushing.then(() => (this.queue.length > 0 ? this.flush() : undefined))
		if (this.queue.length === 0) return Promise.resolve()
		const batch = this.queue.splice(0)
		this.flushing = this.post('commands', { commands: batch })
			.catch((error) => {
				// Keep the batch and try again with the next command or snapshot.
				this.queue.unshift(...batch)
				console.error('Could not save board commands.', error)
			})
			.finally(() => {
				this.flushing = null
			})
		return this.flushing
	}

	/** Save a full snapshot at the current revision. Skipped while an agent is mid-pass. */
	async saveSnapshot(): Promise<boolean> {
		if (this.snapshotting || this.isAgentBusy()) return false
		this.snapshotting = true
		try {
			await this.flush()
			// Read the revision and the document together, between commands.
			const rev = this.commands.getRev()
			const { document } = getSnapshot(this.editor.store)
			await this.post('snapshots', { rev, document })
			this.commandsSinceSnapshot = 0
			this.lastSnapshotAt = Date.now()
			return true
		} catch (error) {
			console.error('Could not save a board snapshot.', error)
			return false
		} finally {
			this.snapshotting = false
		}
	}

	dispose() {
		this.disposed = true
		for (const cleanup of this.cleanups) cleanup()
		this.cleanups = []
	}

	private watch() {
		this.persisted = Math.min(this.persisted, this.commands.getHistory().length)
		this.cleanups.push(
			react('board store', () => {
				const history = this.commands.getHistory()
				if (history.length <= this.persisted) return
				const added = history.slice(this.persisted)
				this.persisted = history.length
				this.queue.push(...added)
				this.commandsSinceSnapshot += added.filter((command) => command.status === 'applied').length
				void this.flush()
				if (this.commandsSinceSnapshot >= SNAPSHOT_EVERY_COMMANDS) void this.saveSnapshot()
			})
		)
		const timer = setInterval(() => {
			if (this.commandsSinceSnapshot === 0) return
			if (this.commandsSinceSnapshot >= SNAPSHOT_EVERY_COMMANDS || Date.now() - this.lastSnapshotAt >= SNAPSHOT_EVERY_MS) {
				void this.saveSnapshot()
			}
		}, SNAPSHOT_CHECK_MS)
		this.cleanups.push(() => clearInterval(timer))
	}

	private async post(path: 'commands' | 'snapshots', data: unknown) {
		const body = JSON.stringify(data)
		const response = await fetch(`/board/${this.boardId}/${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			// A command written just before a reload still reaches the store.
			keepalive: body.length < KEEPALIVE_LIMIT,
		})
		if (!response.ok) throw new Error(`Board store answered ${response.status}.`)
	}
}
