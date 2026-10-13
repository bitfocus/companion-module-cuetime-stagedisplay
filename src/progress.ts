/**
 * Pure helpers for drawing a session progress bar.
 *
 * Companion has no bar primitive: an advanced feedback can only return text, a
 * `png64`, or a raw `imageBuffer` with an explicit pixel format. These helpers build
 * the raw-pixel form (`RGBA`), which needs no image encoder, plus a text form used as
 * a fallback when the control cannot accept an image buffer.
 *
 * They are pure and separate from the feedback so the geometry and clamping can be
 * asserted directly — the visual result cannot be verified without Companion running.
 */

/** Characters for the text fallback. Widely supported, unlike the fancy bar glyphs. */
const FILLED = '█'
const EMPTY = '░'

/** Clamps a percentage into `0..100`, treating anything unparseable as `0`. */
export function clampPercent(value: unknown): number {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return 0
	return Math.min(100, Math.max(0, numeric))
}

/** Splits a Companion colour number (`0xttrrggbb`) into `[r, g, b]`. */
export function colorChannels(color: unknown): [number, number, number] {
	const value = Number.isFinite(Number(color)) ? Math.trunc(Number(color)) : 0
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

export interface BarImageOptions {
	/** Buffer width in pixels. */
	width: number
	/** Buffer height in pixels. */
	height: number
	/** Fill percentage, `0..100`. Values outside the range are clamped. */
	percent: number
	/** Colour of the filled part, as `0xttrrggbb`. */
	barColor: number
	/** Colour of the unfilled remainder, as `0xttrrggbb`. */
	trackColor: number
}

/**
 * Renders the bar as base64-encoded `RGBA` pixels.
 *
 * The fill is scaled by width, so a 0% bar is an empty track rather than nothing —
 * that reads as "no time remaining" instead of a button that failed to render.
 */
export function renderBarImage(options: BarImageOptions): string {
	const width = Math.max(0, Math.floor(options.width))
	const height = Math.max(0, Math.floor(options.height))
	const percent = clampPercent(options.percent)

	const [barR, barG, barB] = colorChannels(options.barColor)
	const [trackR, trackG, trackB] = colorChannels(options.trackColor)
	const filledWidth = Math.round((percent / 100) * width)

	const pixels = Buffer.alloc(width * height * 4)
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const offset = (y * width + x) * 4
			const filled = x < filledWidth
			pixels[offset] = filled ? barR : trackR
			pixels[offset + 1] = filled ? barG : trackG
			pixels[offset + 2] = filled ? barB : trackB
			pixels[offset + 3] = 0xff
		}
	}

	return pixels.toString('base64')
}

/**
 * Renders the bar as block characters, for controls that cannot take an image buffer.
 *
 * At 100% every segment is filled and at 0% none are, so the extremes are still
 * distinguishable in a monospace font.
 */
export function renderBarText(percent: number, segments = 10): string {
	const count = Math.max(1, Math.floor(segments))
	const filled = Math.round((clampPercent(percent) / 100) * count)
	return FILLED.repeat(filled) + EMPTY.repeat(count - filled)
}
