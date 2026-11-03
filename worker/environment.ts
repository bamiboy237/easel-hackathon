export interface Environment {
	AGENT_DURABLE_OBJECT: DurableObjectNamespace
	BOARD_DURABLE_OBJECT: DurableObjectNamespace<import('./do/BoardDurableObject').BoardDurableObject>
	OPENAI_API_KEY: string
	ANTHROPIC_API_KEY: string
	GOOGLE_API_KEY: string
	MODEL_API_KEY: string
	/** Optional. Overrides the Meta Model API base URL, for example to route through a local relay. */
	MODEL_API_BASE_URL?: string
}
