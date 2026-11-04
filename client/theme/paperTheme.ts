import greekItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-greek-standard-italic.woff2?url'
import greek from '@fontsource-variable/source-serif-4/files/source-serif-4-greek-standard-normal.woff2?url'
import latinExtItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-standard-italic.woff2?url'
import latinExt from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-standard-normal.woff2?url'
import latinItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-standard-italic.woff2?url'
import latin from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-standard-normal.woff2?url'
import { DEFAULT_THEME, TLDefaultColor, TLFontFace, TLTheme, TLThemeColors, TLThemeFont } from 'tldraw'

// Warm paper and ink, in the spirit of claude.ai's day theme.
export const PAPER = '#FAF8F3'
const SHEET = '#FFFEFB'
const INK = '#1F1E1B'
const RULE = '#E2DED4'
export const CLAY = '#C2603E'
// A muted forest green, the app's one accent, shared with the chat panel.
const ACCENT = '#344C41'

/**
 * Ink tones for each palette color. Hues keep their usual meaning, so an agent
 * that draws "blue" for one vector component and "red" for another still reads
 * correctly, but every tone is muted to sit on paper.
 */
const INKS = {
	black: INK,
	grey: '#7A7468',
	'light-violet': '#9466AD',
	violet: '#6E4C93',
	blue: '#2F5B9A',
	'light-blue': '#3A78B5',
	yellow: '#B07F1A',
	orange: CLAY,
	green: '#2D7556',
	'light-green': '#4C8740',
	'light-red': '#C45E4E',
	red: '#AE3B2C',
	white: SHEET,
} as const

/**
 * Fill tints and note colors, picked by hand. Blending a muted ink with paper turns
 * it grey, so these are clean watercolor washes of each hue instead.
 */
const WASHES: Record<keyof typeof INKS, { tint: string; note: string }> = {
	black: { tint: '#E6E1D6', note: '#F5E2A8' },
	grey: { tint: '#ECE8DF', note: '#E4DFD4' },
	'light-violet': { tint: '#EFE3F3', note: '#E7D4EF' },
	violet: { tint: '#E7DDF0', note: '#DCCBEA' },
	blue: { tint: '#DDE7F4', note: '#CEDCF0' },
	'light-blue': { tint: '#E0EDF7', note: '#D1E5F4' },
	yellow: { tint: '#F7E8C0', note: '#F5DC97' },
	orange: { tint: '#F8DFD1', note: '#F5CDB6' },
	green: { tint: '#DAEBE0', note: '#CAE3D1' },
	'light-green': { tint: '#E4EFD8', note: '#D9E9C6' },
	'light-red': { tint: '#F9E2DB', note: '#F6D2C7' },
	red: { tint: '#F4DAD4', note: '#F0C6BD' },
	white: { tint: SHEET, note: SHEET },
}

function mix(color: string, base: string, amountOfBase: number) {
	const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
	const a = channels(color)
	const b = channels(base)
	const mixed = a.map((value, i) => Math.round(value * (1 - amountOfBase) + b[i] * amountOfBase))
	return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function inkColor(ink: string, wash: { tint: string; note: string }): TLDefaultColor {
	return {
		solid: ink,
		fill: ink,
		linedFill: mix(ink, PAPER, 0.25),
		semi: wash.tint,
		pattern: mix(ink, PAPER, 0.35),
		// Frames are quiet sheets: a hairline in the frame's tone over slightly lighter paper.
		frameHeadingStroke: mix(ink, RULE, 0.7),
		frameHeadingFill: SHEET,
		frameStroke: mix(ink, RULE, 0.7),
		frameFill: SHEET,
		frameText: mix(INK, PAPER, 0.25),
		// The default note color is black, so its wash is the classic pale yellow.
		noteFill: wash.note,
		noteText: INK,
		highlightSrgb: mix(ink, '#F5D76E', 0.55),
		highlightP3: mix(ink, '#F5D76E', 0.55),
	}
}

const paperLight: TLThemeColors = {
	...DEFAULT_THEME.colors.light,
	text: INK,
	background: PAPER,
	negativeSpace: PAPER,
	solid: SHEET,
	cursor: INK,
	noteBorder: RULE,
	snap: ACCENT,
	selectionStroke: ACCENT,
	selectionFill: 'rgba(52, 76, 65, 0.12)',
	brushFill: 'rgba(31, 30, 27, 0.05)',
	brushStroke: 'rgba(31, 30, 27, 0.25)',
	selectedContrast: SHEET,
	laser: ACCENT,
	...(Object.fromEntries(
		Object.entries(INKS).map(([name, ink]) => [
			name,
			inkColor(ink, WASHES[name as keyof typeof INKS]),
		])
	) as Record<keyof typeof INKS, TLDefaultColor>),
}

/**
 * Source Serif 4, a variable font with optical sizes, so the same face reads well in
 * an 18 px note and a 44 px title. tldraw font faces take no unicode-range, so each
 * subset is its own family and the font stack falls back glyph by glyph; physics
 * boards need the Greek subset for θ, ω, and Δ.
 */
function serifFaces(family: string, normal: string, italic: string): TLFontFace[] {
	return [
		{ family, src: { url: normal, format: 'woff2' }, weight: '200 900', style: 'normal' },
		{ family, src: { url: italic, format: 'woff2' }, weight: '200 900', style: 'italic' },
	]
}

const serif: TLThemeFont = {
	// The web subsets leave out subscripts and math symbols, so those fall back to a
	// system serif made for scientific text.
	fontFamily:
		"'easel_serif', 'easel_serif_ext', 'easel_serif_greek', 'STIX Two Text', STIXGeneral, 'Cambria Math', 'Times New Roman', serif",
	faces: [
		...serifFaces('easel_serif', latin, latinItalic),
		...serifFaces('easel_serif_ext', latinExt, latinExtItalic),
		...serifFaces('easel_serif_greek', greek, greekItalic),
	],
	icon: DEFAULT_THEME.fonts.serif.icon,
}

export const paperTheme: TLTheme = {
	...DEFAULT_THEME,
	fonts: { ...DEFAULT_THEME.fonts, serif },
	colors: {
		light: paperLight,
		dark: DEFAULT_THEME.colors.dark,
	},
}
