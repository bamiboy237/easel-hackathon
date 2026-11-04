export function ChatPanelFallback() {
	return (
		<div className="chat-fallback">
			<p>Couldn't load the chat. Reload to try again.</p>
			<button
				onClick={() => {
					localStorage.clear()
					window.location.reload()
				}}
			>
				Clear chat history
			</button>
		</div>
	)
}
