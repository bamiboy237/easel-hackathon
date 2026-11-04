import { useCallback, useMemo, useState } from 'react'
import {
	DefaultDashStyle,
	DefaultFontStyle,
	DefaultSizeStyle,
	DefaultToolbar,
	DefaultToolbarContent,
	ErrorBoundary,
	TLComponents,
	Tldraw,
	TldrawUiToastsProvider,
	TLUiOverrides,
	ToolbarItem,
} from 'tldraw'
import { TldrawAgentApp } from './agent/TldrawAgentApp'
import {
	TldrawAgentAppContextProvider,
	TldrawAgentAppProvider,
} from './agent/TldrawAgentAppProvider'
import { ChatPanel } from './components/ChatPanel'
import { ChatPanelFallback } from './components/ChatPanelFallback'
import { ContextualStylePanel } from './components/ContextualStylePanel'
import { CustomHelperButtons } from './components/CustomHelperButtons'
import { MarkChip, MarkComposer } from './components/MarkComposer'
import { isReferenceBoard, ReferenceBoardLoader } from './components/ReferenceBoard'
import { paperTheme } from './theme/paperTheme'
import { AgentHighlightOverlayUtil } from './overlays/AgentHighlightOverlayUtil'
import { MarkOverlayUtil } from './overlays/MarkOverlayUtil'
import { MarkTool } from './tools/MarkTool'

// Customize tldraw's styles to play to the agent's strengths
DefaultSizeStyle.setDefaultValue('s')
// Text reads as print on paper; the hand-drawn font stays one click away
DefaultFontStyle.setDefaultValue('serif')
DefaultDashStyle.setDefaultValue('solid')

// The Mark tool: circle, underline, strike, scribble, or tap anything to ask about it
const tools = [MarkTool]
const overlayUtils = [AgentHighlightOverlayUtil, MarkOverlayUtil]
const themes = { default: paperTheme }
const overrides: TLUiOverrides = {
	tools: (editor, tools) => {
		return {
			...tools,
			mark: {
				id: 'mark',
				label: 'Mark and ask',
				kbd: 'm',
				icon: 'question-mark-circle',
				onSelect() {
					editor.setCurrentTool('mark')
				},
			},
		}
	},
}

/** The default toolbar with the Mark tool first, so asking about the board is one click away. */
function Toolbar() {
	return (
		<DefaultToolbar>
			<ToolbarItem tool="mark" />
			<DefaultToolbarContent />
		</DefaultToolbar>
	)
}

function App() {
	const [app, setApp] = useState<TldrawAgentApp | null>(null)

	const handleUnmount = useCallback(() => {
		setApp(null)
	}, [])

	// Custom components that need the agent app's React context
	const components: TLComponents = useMemo(() => {
		return {
			StylePanel: ContextualStylePanel,
			Toolbar,
			InFrontOfTheCanvas: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<MarkComposer />
						<MarkChip />
					</TldrawAgentAppContextProvider>
				),
			HelperButtons: () =>
				app && (
					<TldrawAgentAppContextProvider app={app}>
						<CustomHelperButtons />
					</TldrawAgentAppContextProvider>
				),
		}
	}, [app])

	return (
		<TldrawUiToastsProvider>
			<div className="tldraw-agent-container">
				<div className="tldraw-canvas">
					<Tldraw
						// The reference board is not persisted, so it never overwrites the user's saved board.
						persistenceKey={isReferenceBoard ? undefined : 'tldraw-agent-demo'}
						tools={tools}
						overlayUtils={overlayUtils}
						overrides={overrides}
						components={components}
						themes={themes}
					>
						<TldrawAgentAppProvider onMount={setApp} onUnmount={handleUnmount} />
						{isReferenceBoard && <ReferenceBoardLoader />}
					</Tldraw>
				</div>
				<ErrorBoundary fallback={ChatPanelFallback}>
					{app && (
						<TldrawAgentAppContextProvider app={app}>
							<ChatPanel />
						</TldrawAgentAppContextProvider>
					)}
				</ErrorBoundary>
			</div>
		</TldrawUiToastsProvider>
	)
}

export default App
