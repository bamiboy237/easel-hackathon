import {
	DefaultMainMenu,
	DefaultMainMenuContent,
	TldrawUiMenuCheckboxItem,
	TldrawUiMenuGroup,
	TldrawUiMenuSubmenu,
	useValue,
} from 'tldraw'
import { BoardSettings, getBoardSettings, updateBoardSettings } from '../agent/boardSettings'
import { AGENT_INKS } from '../agent/managers/AgentInkManager'
import { useAgent } from '../agent/TldrawAgentAppProvider'

/** The board menu, with Easel's own choices for this board above tldraw's items. */
export function BoardMenu() {
	const agent = useAgent()
	const { editor } = agent
	const settings = useValue('board settings', () => getBoardSettings(editor), [editor])
	const set = (change: Partial<BoardSettings>) => {
		editor.markHistoryStoppingPoint('board-settings')
		agent.commands.execute('user', 'board-settings', () => updateBoardSettings(editor, change))
	}

	return (
		<DefaultMainMenu>
			<TldrawUiMenuGroup id="easel-preferences">
				<TldrawUiMenuSubmenu id="easel-resolved-threads" label="Resolved threads">
					<TldrawUiMenuGroup id="easel-resolved-threads-choices">
						<TldrawUiMenuCheckboxItem
							id="easel-resolved-pin"
							label="Keep a pin"
							checked={settings.resolvedThreads === 'pin'}
							onSelect={() => set({ resolvedThreads: 'pin' })}
						/>
						<TldrawUiMenuCheckboxItem
							id="easel-resolved-remove"
							label="Remove them"
							checked={settings.resolvedThreads === 'remove'}
							onSelect={() => set({ resolvedThreads: 'remove' })}
						/>
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
				<TldrawUiMenuSubmenu id="easel-agent-ink" label="Agent ink">
					<TldrawUiMenuGroup id="easel-agent-ink-choices">
						{AGENT_INKS.map(({ ink, label }) => (
							<TldrawUiMenuCheckboxItem
								key={ink}
								id={`easel-agent-ink-${ink}`}
								label={label}
								checked={settings.agentInk === ink}
								onSelect={() => agent.ink.setInk(ink)}
							/>
						))}
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
			</TldrawUiMenuGroup>
			<DefaultMainMenuContent />
		</DefaultMainMenu>
	)
}
