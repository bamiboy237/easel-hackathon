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
import { ContextItem } from '../../shared/types/ContextItem'
import { AgentAppAgentsManager } from '../agent/managers/AgentAppAgentsManager'
import { CHANGE_GHOST_MS, ChangeGhostKind, PROTECTED_FLASH_MS } from '../agent/managers/AgentActionManager'

type AgentHighlightColor = 'selected' | 'tooltip' | 'protected'

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
		label?: string
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

type AgentHighlightOverlay = AgentAreaHighlightOverlay | AgentPointHighlightOverlay

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

			if (
				activeRequest?.bounds &&
				!this.isEquivalentToPendingContextArea(activeRequest.bounds, activeContextItems)
			) {
				overlays.push({
					id: `agent-highlight:${agent.id}:viewport`,
					type: 'agent-highlight',
					props: {
						kind: 'area',
						bounds: toBoxModel(activeRequest.bounds),
						color: 'tooltip',
						generating: true,
						label: `Agent ${agent.id.slice(0, 6)}'s view`,
					},
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
			this.addContextItemOverlays(overlays, agent.id, 'active', activeContextItems, true)
		}

		return overlays
	}

	override render(ctx: CanvasRenderingContext2D, overlays: AgentHighlightOverlay[]): void {
		// Track whether any overlay is animating so the tick handler knows when to
		// advance the animation. This is a side effect, so it belongs in render
		// (an effect) rather than getOverlays (a reactive computation).
		this.hasAnimatedOverlays = overlays.some(
			(overlay) => overlay.props.generating || overlay.props.color === 'protected' || ('ghost' in overlay.props && !!overlay.props.ghost)
		)

		const zoom = this.editor.getZoomLevel()
		const colors = this.getColors()
		const dashOffset = getDashOffset(this.$animationElapsed.get(), zoom)

		for (const overlay of overlays) {
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
					label: overlay.props.label,
					labelText: colors.labelText,
					zoom,
				})
			} else {
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
					areaHighlights.push({
						id,
						type: 'agent-highlight',
						props: {
							kind: 'area',
							bounds: toBoxModel(item.bounds),
							color: 'selected',
							generating,
							label: generating && item.source === 'agent' ? 'Reviewing' : undefined,
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

	private isEquivalentToPendingContextArea(
		agentViewportBounds: BoxModel,
		contextItems: ContextItem[]
	): boolean {
		return contextItems.some(
			(item) =>
				item.type === 'area' &&
				item.source === 'agent' &&
				Box.Equals(item.bounds, agentViewportBounds)
		)
	}

	private renderArea(
		ctx: CanvasRenderingContext2D,
		pageBounds: BoxModel,
		{
			color,
			alpha,
			generating,
			dashOffset,
			label,
			labelText,
			zoom,
		}: {
			color: string
			alpha: number
			generating: boolean
			dashOffset: number
			label?: string
			labelText: string
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

		if (label) {
			this.renderLabel(ctx, bounds, label, color, labelText, zoom)
		}
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

	private renderLabel(
		ctx: CanvasRenderingContext2D,
		bounds: Box,
		label: string,
		color: string,
		labelText: string,
		zoom: number
	): void {
		const scale = 1 / zoom
		const padding = 4
		const fontSize = 12
		const fontFamily = this.editor.getCurrentTheme().fonts.sans.fontFamily

		ctx.save()
		ctx.translate(bounds.x, bounds.y)
		ctx.scale(scale, scale)
		ctx.font = `500 ${fontSize}px ${fontFamily}`
		ctx.textBaseline = 'top'

		const width = Math.ceil(ctx.measureText(label).width) + padding * 2
		const height = fontSize + padding * 2

		ctx.fillStyle = color
		ctx.beginPath()
		ctx.roundRect(0, 0, width, height, 4)
		ctx.fill()

		ctx.fillStyle = labelText
		ctx.fillText(label, padding, padding)
		ctx.restore()
	}

	private getColors() {
		const themeColors = this.editor.getCurrentTheme().colors[this.editor.getColorMode()]
		return {
			selected: themeColors.selectionStroke,
			tooltip: themeColors.text,
			protected: themeColors.text,
			labelText: themeColors.background,
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
