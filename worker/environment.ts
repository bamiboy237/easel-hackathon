export interface Environment {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	BOARD_DURABLE_OBJECT: DurableObjectNamespace<import('./do/BoardDurableObject').BoardDurableObject>
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string
	MODEL_API_KEY: string
	/** Optional. Overrides the Meta Model API base URL, for example to route through a local relay. */
	MODEL_API_BASE_URL?: string
	/**
	 * Optional. Overrides the OpenAI API base URL for the server's own calls, such as
	 * minting a voice session key through a local relay. The browser's audio stream
	 * still connects to OpenAI directly.
	 */
	OPENAI_API_BASE_URL?: string
}
