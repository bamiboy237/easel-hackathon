import { DurableObject } from 'cloudflare:workers'
import { Environment } from '../environment'

/** A recorded board command, as the client's command log stores it. */
interface StoredCommand {
	commandId: string
	origin: string
	type: string
	status: string
	rev: number | null
	baseRev?: number
	payload: unknown
	createdAt: number
	[key: string]: unknown
}

/**
 * The board store: one local SQLite database per board, in a Durable Object.
 * Commands are appended as they are recorded, and a full tldraw snapshot is
 * saved periodically. A board loads as its latest snapshot plus the commands
 * after it.
 */
export class BoardDurableObject extends DurableObject<Environment> {
	private sql: SqlStorage

	constructor(ctx: DurableObjectState, env: Environment) {
		super(ctx, env)
		this.sql = ctx.storage.sql
		this.sql.exec(`
			CREATE TABLE IF NOT EXISTS commands (
				command_id TEXT PRIMARY KEY,
				board_id TEXT NOT NULL,
				seq INTEGER NOT NULL,
				origin TEXT NOT NULL,
				type TEXT NOT NULL,
				status TEXT NOT NULL,
				rev INTEGER,
				base_rev INTEGER,
				payload TEXT NOT NULL,
				details TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS commands_by_board ON commands (board_id, seq);
			CREATE TABLE IF NOT EXISTS snapshots (
				board_id TEXT NOT NULL,
				rev INTEGER NOT NULL,
				tldraw_snapshot TEXT NOT NULL,
				saved_at INTEGER NOT NULL,
				PRIMARY KEY (board_id, rev)
			);
		`)
	}

	/** Append commands in log order. A command ID that is already stored is skipped. */
	appendCommands(boardId: string, commands: StoredCommand[]): number {
		let seq = (this.sql.exec('SELECT MAX(seq) AS seq FROM commands WHERE board_id = ?', boardId).one().seq as number | null) ?? 0
		let added = 0
		for (const command of commands) {
			const { commandId, origin, type, status, rev, baseRev, payload, createdAt, ...details } = command
			const exists = this.sql.exec('SELECT 1 FROM commands WHERE command_id = ?', commandId).toArray().length > 0
			if (exists) continue
			seq++
			this.sql.exec(
				`INSERT INTO commands (command_id, board_id, seq, origin, type, status, rev, base_rev, payload, details, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				commandId,
				boardId,
				seq,
				origin,
				type,
				status,
				rev,
				baseRev ?? null,
				JSON.stringify(payload),
				JSON.stringify(details),
				createdAt
			)
			added++
		}
		return added
	}

	/** Save a full snapshot taken at board revision `rev`. Keeps the latest few. */
	saveSnapshot(boardId: string, rev: number, snapshot: unknown) {
		this.sql.exec(
			'INSERT OR REPLACE INTO snapshots (board_id, rev, tldraw_snapshot, saved_at) VALUES (?, ?, ?, ?)',
			boardId,
			rev,
			JSON.stringify(snapshot),
			Date.now()
		)
		this.sql.exec(
			`DELETE FROM snapshots WHERE board_id = ? AND rev NOT IN
			 (SELECT rev FROM snapshots WHERE board_id = ? ORDER BY rev DESC LIMIT 3)`,
			boardId,
			boardId
		)
	}

	/** The latest snapshot, and the whole command log in order. */
	load(boardId: string) {
		const snapshotRow = this.sql
			.exec('SELECT rev, tldraw_snapshot, saved_at FROM snapshots WHERE board_id = ? ORDER BY rev DESC LIMIT 1', boardId)
			.toArray()[0]
		const commands = this.sql
			.exec('SELECT * FROM commands WHERE board_id = ? ORDER BY seq', boardId)
			.toArray()
			.map((row) => ({
				...JSON.parse(row.details as string),
				commandId: row.command_id,
				origin: row.origin,
				type: row.type,
				status: row.status,
				rev: row.rev,
				...(row.base_rev === null ? {} : { baseRev: row.base_rev }),
				payload: JSON.parse(row.payload as string),
				createdAt: row.created_at,
			}))
		return {
			snapshot: snapshotRow
				? {
						rev: snapshotRow.rev as number,
						savedAt: snapshotRow.saved_at as number,
						document: JSON.parse(snapshotRow.tldraw_snapshot as string),
					}
				: null,
			commands,
		}
	}
}
