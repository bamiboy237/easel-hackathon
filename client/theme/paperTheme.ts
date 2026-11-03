import greekItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-greek-standard-italic.woff2?url'
import greek from '@fontsource-variable/source-serif-4/files/source-serif-4-greek-standard-normal.woff2?url'
import latinExtItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-standard-italic.woff2?url'
import latinExt from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-ext-standard-normal.woff2?url'
import latinItalic from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-standard-italic.woff2?url'
import latin from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-standard-normal.woff2?url'
import { DEFAULT_THEME, TLDefaultColor, TLFontFace, TLTheme, TLThemeColors, TLThemeFont } from 'tldraw'

// Warm paper and ink, in the spirit of claude.ai's day theme.
export const PAPER = '#F6F2E9'
const SHEET = '#FBF8F2'
const INK = '#1F1E1B'
const RULE = '#DCD4C4'
export const CLAY = '#C2603E'

/**
 * Ink tones for each palette color. Hues keep their usual meaning, so an agent
 * that draws "blue" for one vector component and "red" for another still reads
 * correctly, but every tone is muted to sit on paper.
 */
const INKS = {
	black: INK,
	grey: '#8C867A',
	'light-violet': '#A57DB9',
	violet: '#6E4C93',
	blue: '#2F5B9A',
	'light-blue': '#4B86BF',
	yellow: '#C2922B',
	orange: CLAY,
	green: '#2D7556',
	'light-green': '#5E9452',
	'light-red': '#D2786A',
	red: '#AE3B2C',
	white: SHEET,
} as const

function mix(color: string, base: string, amountOfBase: number) {
	const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
	const a = channels(color)
	const b = channels(base)
	const mixed = a.map((value, i) => Math.round(value * (1 - amountOfBase) + b[i] * amountOfBase))
	return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

function inkColor(ink: string): TLDefaultColor {
	return {
		solid: ink,
		fill: ink,
		linedFill: mix(ink, PAPER, 0.25),
		semi: mix(ink, SHEET, 0.86),
		pattern: mix(ink, PAPER, 0.35),
		// Frames are quiet sheets: a hairline in the frame's tone over slightly lighter paper.
		frameHeadingStroke: mix(ink, RULE, 0.7),
		frameHeadingFill: SHEET,
		frameStroke: mix(ink, RULE, 0.7),
		frameFill: SHEET,
		frameText: mix(INK, PAPER, 0.25),
		// The default note color is black, so it gets the classic pale yellow instead of grey.
		noteFill: ink === INK ? '#F3E3B0' : mix(ink, SHEET, 0.72),
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
	snap: CLAY,
	selectionStroke: CLAY,
	selectionFill: 'rgba(194, 96, 62, 0.14)',
	brushFill: 'rgba(31, 30, 27, 0.05)',
	brushStroke: 'rgba(31, 30, 27, 0.25)',
	selectedContrast: SHEET,
	laser: CLAY,
	...(Object.fromEntries(
		Object.entries(INKS).map(([name, ink]) => [name, inkColor(ink)])
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
	fontFamily: "'easel_serif', 'easel_serif_ext', 'easel_serif_greek', Georgia, serif",
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
