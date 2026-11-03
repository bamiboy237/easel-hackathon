import { useEffect } from 'react'
import { loadSnapshot, TLEditorSnapshot, useEditor } from 'tldraw'

/** True when the page was opened with `?board=reference`. */
export const isReferenceBoard = new URLSearchParams(window.location.search).get('board') === 'reference'

/**
 * Loads the saved Phase 1 reference board, a fixed board used to judge visual changes.
 * The board is not persisted, so every reload starts from the saved version.
 */
export function ReferenceBoardLoader() {
	const editor = useEditor()

	useEffect(() => {
		let cancelled = false
		fetch('/dev/reference-board.json')
			.then((response) => {
				if (!response.ok) throw new Error(`Reference board not found (${response.status})`)
				return response.json() as Promise<TLEditorSnapshot>
			})
			.then((snapshot) => {
				if (cancelled) return
				// Remote changes are not recorded as user commands.
				editor.store.mergeRemoteChanges(() => loadSnapshot(editor.store, snapshot))
				editor.zoomToFit()
			})
			.catch((error) => console.error(error))
		return () => {
			cancelled = true
		}
	}, [editor])

	return null
}
