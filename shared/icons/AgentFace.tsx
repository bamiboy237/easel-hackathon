/** The agent's face, an ink drawing of an artist in a beret: on the ball and on its working slip on the board. It is the agent's, not the app's logo. */
export const AGENT_FACE_URL = '/icons/agent.svg'

export function AgentFace({ size = 20 }: { size?: number }) {
	return <img className="agent-face" src={AGENT_FACE_URL} width={size} height={size} alt="" aria-hidden draggable={false} />
}
