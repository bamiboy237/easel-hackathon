import { Editor, TLDefaultColorStyle } from 'tldraw'

/**
 * Choices the user makes for a board. They are saved in the board's document
 * settings, so they travel with the board and every viewer sees the same.
 */
export interface BoardSettings {
	/** When a thread is resolved: keep it as a small pin at its mark, or remove it and its mark. */
	resolvedThreads: 'pin' | 'remove'
	/** The ink the agent draws in: the colors it chose itself, or one color the user picked. */
	agentInk: 'same' | TLDefaultColorStyle
}

const DEFAULTS: BoardSettings = { resolvedThreads: 'pin', agentInk: 'same' }

export function getBoardSettings(editor: Editor): BoardSettings {
	const saved = editor.getDocumentSettings().meta.easel as Partial<BoardSettings> | undefined
	return { ...DEFAULTS, ...(saved ?? {}) }
}

/**
 * Change one setting. Call it inside a user command, so it is recorded like any
 * board change. It writes the document record through the store, not through
 * `updateDocumentSettings`, which skips undo history: undoing the change then
 * restores the setting together with whatever it changed on the board.
 */
export function updateBoardSettings(editor: Editor, change: Partial<BoardSettings>) {
	const document = editor.getDocumentSettings()
	const next = { ...getBoardSettings(editor), ...change }
	editor.store.put([{ ...document, meta: { ...document.meta, easel: next as unknown as Record<string, never> } }])
}
