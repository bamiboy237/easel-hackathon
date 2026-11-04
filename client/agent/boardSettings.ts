import { Editor } from 'tldraw'

/**
 * Choices the user makes for a board. They are saved in the board's document
 * settings, so they travel with the board and every viewer sees the same.
 */
export interface BoardSettings {
	/** When a thread is resolved: keep it as a small pin at its mark, or remove it and its mark. */
	resolvedThreads: 'pin' | 'remove'
}

const DEFAULTS: BoardSettings = { resolvedThreads: 'pin' }

export function getBoardSettings(editor: Editor): BoardSettings {
	const saved = editor.getDocumentSettings().meta.easel as Partial<BoardSettings> | undefined
	return { ...DEFAULTS, ...(saved ?? {}) }
}

/** Change one setting. Call it inside a user command, so it is recorded like any board change. */
export function updateBoardSettings(editor: Editor, change: Partial<BoardSettings>) {
	const meta = editor.getDocumentSettings().meta
	const next = { ...getBoardSettings(editor), ...change }
	editor.updateDocumentSettings({ meta: { ...meta, easel: next as unknown as Record<string, never> } })
}
