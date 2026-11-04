import { DefaultStylePanel, TLUiStylePanelProps, useEditor, useValue } from 'tldraw'

const TOOLS_WITHOUT_STYLES = new Set(['select', 'hand', 'laser', 'zoom', 'mark'])

/** Shows the style panel only when there is something to style: a selection or a drawing tool. */
export function ContextualStylePanel(props: TLUiStylePanelProps) {
	const editor = useEditor()
	const isVisible = useValue(
		'style panel visible',
		() =>
			editor.getSelectedShapeIds().length > 0 ||
			!TOOLS_WITHOUT_STYLES.has(editor.getCurrentToolId()),
		[editor]
	)
	if (!isVisible) return null
	return <DefaultStylePanel {...props} />
}
