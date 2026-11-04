/** A fountain-pen nib, the agent's mark: on the send button and on the ball. */
export function NibIcon({ size = 16 }: { size?: number }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
			<path d="M12 21 7 11l5-8 5 8z" />
			<path d="M12 21v-7" />
			<circle cx="12" cy="11.5" r="1.4" />
		</svg>
	)
}
