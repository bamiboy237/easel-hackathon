import {
	atom,
	Box,
	BoxModel,
	Editor,
	OverlayUtil,
	PI2,
	TLOverlay,
	TLShapeId,
	VecModel,
} from 'tldraw'
import { AGENT_FACE_URL } from '../../shared/icons/AgentFace'
import { ContextItem } from '../../shared/types/ContextItem'
import { AgentAppAgentsManager } from '../agent/managers/AgentAppAgentsManager'
import { CHANGE_GHOST_MS, ChangeGhostKind, PROTECTED_FLASH_MS } from '../agent/managers/AgentActionManager'

type AgentHighlightColor = 'selected' | 'protected'

// The outline on the user's shapes after the agent bumps into them stays quiet.
const PROTECTED_ALPHA = 0.4
const GHOST_WASH_ALPHA = 0.12
const LANDED_ALPHA = 0.3
const FLASH_IN_MS = 120
const FLASH_OUT_MS = 240
const ANIMATION_PERIOD = 100_000
const DASH_SPEED = 20
const MINIMAP_FILL_ALPHA = 0.12
const MINIMAP_PULSE_PERIOD = 2400
/** One breath of the working dots, in milliseconds. */
const WORK_DOT_PERIOD = 1200
/** The agent's face on its working slip, in screen pixels. */
const FACE_SIZE = 16

let agentFace: HTMLImageElement | null = null
/** The agent's face as an image for the canvas, once it has loaded. */
function getAgentFace(): HTMLImageElement | null {
	if (typeof Image === 'undefined') return null
	if (!agentFace) {
		agentFace = new Image()
		agentFace.src = AGENT_FACE_URL
	}
	return agentFace.complete && agentFace.naturalWidth > 0 ? agentFace : null
}

interface AgentAreaHighlightOverlay extends TLOverlay {
	type: 'agent-highlight'
	props: {
		kind: 'area'
		bounds: BoxModel
		color: AgentHighlightColor
		generating: boolean
		/** For a protected flash: when it started, so it can fade in and out. */
		flashStartedAt?: number
		/** For a change ghost: whether an undo removed the shape, a restore brought it back, or the agent created it, and when. */
		ghost?: { kind: ChangeGhostKind; startedAt: number }
	}
}

interface AgentPointHighlightOverlay extends TLOverlay {
	type: 'agent-highlight'
	props: {
		kind: 'point'
		point: VecModel
		color: AgentHighlightColor
		generating: boolean
	}
}

/** Where the agent is working: a quiet outline, three breathing dots, and the step. */
interface AgentWorkOverlay extends TLOverlay {
	type: 'agent-highlight'
	props: {
		kind: 'work'
		bounds: BoxModel
		step: string
		generating: boolean
	}
}

type AgentHighlightOverlay = AgentAreaHighlightOverlay | AgentPointHighlightOverlay | AgentWorkOverlay

export class AgentHighlightOverlayUtil extends OverlayUtil<AgentHighlightOverlay> {
	static override type = 'agent-highlight' as const
	override options = { zIndex: 700 }

	private readonly $animationElapsed = atom('agent highlight animation elapsed', 0)
	private hasAnimatedOverlays = false

	constructor(editor: Editor) {
		super(editor)
		editor.on('tick', this.handleTick)
	}

	override dispose() {
		this.editor.off('tick', this.handleTick)
	}

	override isActive(): boolean {
		return AgentAppAgentsManager.getAgents(this.editor).length > 0
	}

	override getOverlays(): AgentHighlightOverlay[] {
		const overlays: AgentHighlightOverlay[] = []
		const agents = AgentAppAgentsManager.getAgents(this.editor)

		for (const agent of agents) {
			const activeRequest = agent.requests.getActiveRequest()
			const activeContextItems = activeRequest?.contextItems ?? []

			// A question about a mark needs no "looking at" outline: the pencil mark and
			// its thread already show what the agent is working on.
			const aboutMark = !!agent.marks.getActive()

			// While it works, the agent shows where on the board it is and what it is
			// doing there, instead of outlining everything it can see.
			const reviewing = activeContextItems.find((item) => item.type === 'area' && item.source === 'agent')
			const work =
				agent.actions.getWork() ??
				(agent.requests.isGenerating() && reviewing?.type === 'area'
					? { bounds: toBoxModel(reviewing.bounds), step: 'Reviewing' }
					: null)
			if (work && !aboutMark) {
				overlays.push({
					id: `agent-highlight:${agent.id}:work`,
					type: 'agent-highlight',
					props: { kind: 'work', bounds: work.bounds, step: work.step, generating: true },
				})
			}

			for (const ghost of agent.actions.getChangeGhosts()) {
				overlays.push({
					id: `agent-highlight:${agent.id}:ghost:${ghost.id}`,
					type: 'agent-highlight',
					props: {
						kind: 'area',
						bounds: ghost.bounds,
						// The agent's own shapes land in the selection accent; undo and restore use ink.
						color: ghost.kind === 'landed' ? 'selected' : 'protected',
						generating: false,
						ghost: { kind: ghost.kind, startedAt: ghost.startedAt },
					},
				})
			}

			for (const shapeId of agent.actions.getProtectedFlash()) {
				const bounds = this.editor.getShapePageBounds(shapeId)
				if (!bounds) continue
				overlays.push({
					id: `agent-highlight:${agent.id}:protected:${shapeId}`,
					type: 'agent-highlight',
					props: {
						kind: 'area',
						bounds: toBoxModel(bounds),
						color: 'protected',
						generating: false,
						flashStartedAt: agent.actions.getProtectedFlashStartedAt(),
					},
				})
			}

			const selectedContextItems = agent.requests.isGenerating() ? [] : agent.context.getItems()
			this.addContextItemOverlays(overlays, agent.id, 'selected', selectedContextItems, false)
			if (!aboutMark) this.addContextItemOverlays(overlays, agent.id, 'active', activeContextItems, true)
		}

		return overlays
	}

	override render(ctx: CanvasRenderingContext2D, overlays: AgentHighlightOverlay[]): void {
		// Track whether any overlay is animating so the tick handler knows when to
		// advance the animation. This is a side effect, so it belongs in render
		// (an effect) rather than getOverlays (a reactive computation).
		this.hasAnimatedOverlays = overlays.some(
			(overlay) => overlay.props.generating || ('color' in overlay.props && overlay.props.color === 'protected') || ('ghost' in overlay.props && !!overlay.props.ghost)
		)

		const zoom = this.editor.getZoomLevel()
		const colors = this.getColors()
		const dashOffset = getDashOffset(this.$animationElapsed.get(), zoom)

		for (const overlay of overlays) {
			if (overlay.props.kind === 'work') {
				this.renderWork(ctx, overlay.props.bounds, overlay.props.step, zoom)
				continue
			}
			const color = colors[overlay.props.color]
			if (overlay.props.kind === 'area' && overlay.props.ghost) {
				this.renderGhost(ctx, overlay.props.bounds, overlay.props.ghost, color, zoom)
			} else if (overlay.props.kind === 'area') {
				this.renderArea(ctx, overlay.props.bounds, {
					color,
					alpha:
						overlay.props.color === 'protected'
							? PROTECTED_ALPHA * getFlashOpacity(overlay.props.flashStartedAt ?? 0)
							: 1,
					generating: overlay.props.generating,
					dashOffset,
					zoom,
				})
			} else if (overlay.props.kind === 'point') {
				this.renderPoint(ctx, overlay.props.point, {
					color,
					generating: overlay.props.generating,
					dashOffset,
					zoom,
				})
			}
		}
	}

	override renderMinimap(
		ctx: CanvasRenderingContext2D,
		overlays: AgentHighlightOverlay[],
		zoom: number
	): void {
		const colors = this.getColors()
		const animationElapsed = this.$animationElapsed.get()

		for (const overlay of overlays) {
			if (overlay.props.kind === 'work') continue
			const color = colors[overlay.props.color]

			if (overlay.props.kind === 'area') {
				const bounds = Box.From(overlay.props.bounds).expandBy(4)
				const radius = Math.min(bounds.w, bounds.h, 3 / zoom)
				ctx.globalAlpha = overlay.props.generating
					? getMinimapPulseAlpha(animationElapsed)
					: MINIMAP_FILL_ALPHA
				ctx.fillStyle = color
				ctx.beginPath()
				ctx.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, radius)
				ctx.fill()
				ctx.globalAlpha = 0.85
				ctx.lineWidth = 1 / zoom
				ctx.strokeStyle = color
				ctx.stroke()
				ctx.globalAlpha = 1
			} else {
				const radius = 3 / zoom
				ctx.beginPath()
				ctx.arc(overlay.props.point.x, overlay.props.point.y, radius, 0, PI2)
				ctx.fillStyle = color
				ctx.fill()
			}
		}
	}

	private addContextItemOverlays(
		overlays: AgentHighlightOverlay[],
		agentId: string,
		group: 'selected' | 'active',
		contextItems: ContextItem[],
		generating: boolean
	): void {
		const areaHighlights: AgentAreaHighlightOverlay[] = []
		const pointHighlights: AgentPointHighlightOverlay[] = []

		for (let i = 0; i < contextItems.length; i++) {
			const item = contextItems[i]
			const id = `agent-highlight:${agentId}:${group}:${i}`

			switch (item.type) {
				case 'area': {
					// The agent's own review area shows as its working place instead.
					if (generating && item.source === 'agent') break
					areaHighlights.push({
						id,
						type: 'agent-highlight',
						props: {
							kind: 'area',
							bounds: toBoxModel(item.bounds),
							color: 'selected',
							generating,
						},
					})
					break
				}
				case 'shapes': {
					const bounds = this.editor.getShapesPageBounds(
						item.shapes.map((shape) => `shape:${shape.shapeId}` as TLShapeId)
					)
					if (!bounds) break
					areaHighlights.push({
						id,
						type: 'agent-highlight',
						props: {
							kind: 'area',
							bounds: toBoxModel(bounds),
							color: 'selected',
							generating,
						},
					})
					break
				}
				case 'shape': {
					const bounds = this.editor.getShapePageBounds(`shape:${item.shape.shapeId}` as TLShapeId)
					if (!bounds) break
					areaHighlights.push({
						id,
						type: 'agent-highlight',
						props: {
							kind: 'area',
							bounds: toBoxModel(bounds),
							color: 'selected',
							generating,
						},
					})
					break
				}
				case 'point': {
					pointHighlights.push({
						id,
						type: 'agent-highlight',
						props: {
							kind: 'point',
							point: item.point,
							color: 'selected',
							generating,
						},
					})
					break
				}
			}
		}

		overlays.push(...areaHighlights, ...pointHighlights)
	}

	private renderArea(
		ctx: CanvasRenderingContext2D,
		pageBounds: BoxModel,
		{
			color,
			alpha,
			generating,
			dashOffset,
			zoom,
		}: {
			color: string
			alpha: number
			generating: boolean
			dashOffset: number
			zoom: number
		}
	): void {
		const bounds = Box.From(pageBounds).expandBy(4)
		ctx.save()
		ctx.globalAlpha = alpha
		ctx.strokeStyle = color
		ctx.lineWidth = 1 / zoom
		ctx.lineCap = 'round'
		if (generating) {
			ctx.setLineDash([4 / zoom, 4 / zoom])
			ctx.lineDashOffset = dashOffset
		}
		ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
		ctx.restore()
	}

	/**
	 * The agent's working place: a forest hairline around what it is changing,
	 * and above it three graphite dots that breathe in opacity only, followed by
	 * the step in small type. Text and dots keep their size at any zoom.
	 */
	private renderWork(ctx: CanvasRenderingContext2D, pageBounds: BoxModel, step: string, zoom: number): void {
		// The theme's accent and ink, so the slip follows the color mode.
		const theme = this.editor.getCurrentTheme().colors[this.editor.getColorMode()]
		const bounds = Box.From(pageBounds).expandBy(6 / zoom)
		ctx.save()
		ctx.strokeStyle = theme.selectionStroke
		ctx.globalAlpha = 0.4
		ctx.lineWidth = 1 / zoom
		ctx.beginPath()
		ctx.roundRect(bounds.x, bounds.y, bounds.w, bounds.h, 3 / zoom)
		ctx.stroke()
		ctx.restore()

		ctx.save()
		ctx.translate(bounds.x, bounds.y)
		ctx.scale(1 / zoom, 1 / zoom)
		const baseline = -8
		const elapsed = this.$animationElapsed.get()
		const still = prefersReducedMotion()
		const fontFamily = this.editor.getCurrentTheme().fonts.sans.fontFamily
		ctx.font = `500 11px ${fontFamily}`
		const label = step ? fitStep(ctx, step, Math.max(220, bounds.w * zoom - 30)) : ''
		// A slip of board paper behind the dots and the step, so they read over ink.
		// The agent's face leads the slip, then the dots, then the step.
		const face = getAgentFace()
		const lead = face ? FACE_SIZE + 4 : 0
		const slipWidth = lead + 28 + (label ? ctx.measureText(label).width + 6 : 0)
		ctx.fillStyle = theme.background
		ctx.globalAlpha = 0.92
		ctx.beginPath()
		ctx.roundRect(-4, baseline - 15, slipWidth + 4, 21, 5)
		ctx.fill()
		if (face) {
			ctx.globalAlpha = 1
			ctx.drawImage(face, 0, baseline - 5 - FACE_SIZE / 2, FACE_SIZE, FACE_SIZE)
			ctx.translate(lead, 0)
		}
		for (let i = 0; i < 3; i++) {
			const phase = ((elapsed / WORK_DOT_PERIOD - i * 0.15) % 1 + 1) % 1
			ctx.globalAlpha = still ? 0.6 : 0.3 + 0.6 * (0.5 - 0.5 * Math.cos(phase * PI2))
			ctx.fillStyle = theme.text
			ctx.beginPath()
			ctx.arc(4 + i * 8, baseline - 5, 2, 0, PI2)
			ctx.fill()
		}
		if (label) {
			// The step is quieter than ink, like the app's secondary text.
			ctx.globalAlpha = 0.7
			ctx.textBaseline = 'alphabetic'
			ctx.fillStyle = theme.text
			ctx.fillText(label, 28, baseline - 1)
		}
		ctx.restore()
	}

	/**
	 * Where an undo removed a shape, a soft wash fades away. Where a restore
	 * brought one back, an ink outline fades away, and where the agent just
	 * created one, an outline in the selection accent does. All use a plain
	 * ease-out fade.
	 */
	private renderGhost(
		ctx: CanvasRenderingContext2D,
		pageBounds: BoxModel,
		ghost: { kind: ChangeGhostKind; startedAt: number },
		color: string,
		zoom: number
	): void {
		const t = Math.min(1, (Date.now() - ghost.startedAt) / CHANGE_GHOST_MS)
		const fade = 1 - easeOut(t)
		if (fade <= 0) return
		ctx.save()
		ctx.fillStyle = color
		ctx.strokeStyle = color
		ctx.lineWidth = 1 / zoom
		if (ghost.kind === 'removed') {
			ctx.globalAlpha = GHOST_WASH_ALPHA * fade
			ctx.fillRect(pageBounds.x, pageBounds.y, pageBounds.w, pageBounds.h)
		} else {
			const bounds = Box.From(pageBounds).expandBy(4)
			ctx.globalAlpha = (ghost.kind === 'landed' ? LANDED_ALPHA : PROTECTED_ALPHA) * fade
			ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h)
		}
		ctx.restore()
	}

	private renderPoint(
		ctx: CanvasRenderingContext2D,
		pagePoint: VecModel,
		{
			color,
			generating,
			dashOffset,
			zoom,
		}: { color: string; generating: boolean; dashOffset: number; zoom: number }
	): void {
		const radius = 3 / zoom
		ctx.save()
		ctx.beginPath()
		ctx.arc(pagePoint.x, pagePoint.y, radius, 0, PI2)
		ctx.strokeStyle = color
		ctx.fillStyle = color
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		if (generating) {
			ctx.setLineDash([3 / zoom, 3 / zoom])
			ctx.lineDashOffset = dashOffset
			ctx.lineWidth = 2 / zoom
			ctx.stroke()
		} else {
			ctx.lineWidth = 1 / zoom
			ctx.fill()
			ctx.stroke()
		}
		ctx.restore()
	}

	private getColors() {
		const themeColors = this.editor.getCurrentTheme().colors[this.editor.getColorMode()]
		return {
			selected: themeColors.selectionStroke,
			protected: themeColors.text,
		}
	}

	private handleTick = (elapsed: number) => {
		if (!this.hasAnimatedOverlays) return
		this.$animationElapsed.update((phase) => (phase + elapsed) % ANIMATION_PERIOD)
	}
}

/**
 * The protected flash fades in quickly and fades out a little slower, so it
 * never pops on or off. Enter uses a strong ease-out; exit is a plain fade.
 */
function getFlashOpacity(startedAt: number): number {
	const elapsed = Date.now() - startedAt
	if (elapsed < FLASH_IN_MS) return easeOut(elapsed / FLASH_IN_MS)
	const fadeStart = PROTECTED_FLASH_MS - FLASH_OUT_MS
	if (elapsed < fadeStart) return 1
	return Math.max(0, 1 - (elapsed - fadeStart) / FLASH_OUT_MS)
}

function easeOut(t: number): number {
	return 1 - Math.pow(1 - t, 3)
}

function toBoxModel(box: BoxModel): BoxModel {
	return { x: box.x, y: box.y, w: box.w, h: box.h }
}

function getMinimapPulseAlpha(phase: number): number {
	const progress = (phase % MINIMAP_PULSE_PERIOD) / MINIMAP_PULSE_PERIOD
	return MINIMAP_FILL_ALPHA + 0.06 * (0.5 + Math.sin(progress * PI2 - Math.PI / 2) * 0.5)
}

function getDashOffset(elapsed: number, zoom: number): number {
	return -((elapsed / 1000) * DASH_SPEED) / zoom
}

/** The step, shortened with an ellipsis to fit the width, in the context's current font. */
function fitStep(ctx: CanvasRenderingContext2D, step: string, maxWidth: number): string {
	if (ctx.measureText(step).width <= maxWidth) return step
	let text = step
	while (text.length > 1 && ctx.measureText(text + '…').width > maxWidth) text = text.slice(0, -1)
	return text.trimEnd() + '…'
}

function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}
