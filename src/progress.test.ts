import { describe, it, expect } from 'vitest'
import { clampPercent, colorChannels, renderBarImage, renderBarText } from './progress.ts'

/** Decodes a rendered bar so individual pixels can be asserted. */
function pixels(base64: string): Buffer {
	return Buffer.from(base64, 'base64')
}

function pixelAt(buffer: Buffer, width: number, x: number, y: number): [number, number, number, number] {
	const offset = (y * width + x) * 4
	return [buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]]
}

const BAR = 0x00ff00 // green
const TRACK = 0x2d2d2d // dark grey

describe('clampPercent', () => {
	it('passes through values inside the range', () => {
		expect(clampPercent(0)).toBe(0)
		expect(clampPercent(50)).toBe(50)
		expect(clampPercent(100)).toBe(100)
		expect(clampPercent(12.5)).toBe(12.5)
	})

	it('clamps values outside it', () => {
		expect(clampPercent(-1)).toBe(0)
		expect(clampPercent(101)).toBe(100)
		expect(clampPercent(1e9)).toBe(100)
	})

	it('treats unparseable input as zero rather than NaN', () => {
		// A NaN here would propagate into the pixel maths and produce a blank button.
		expect(clampPercent(undefined)).toBe(0)
		expect(clampPercent(null)).toBe(0)
		expect(clampPercent('nonsense')).toBe(0)
		expect(clampPercent(Number.NaN)).toBe(0)
	})
})

describe('colorChannels', () => {
	it('splits a Companion colour number', () => {
		expect(colorChannels(0xff0000)).toEqual([255, 0, 0])
		expect(colorChannels(0x00ff00)).toEqual([0, 255, 0])
		expect(colorChannels(0x0000ff)).toEqual([0, 0, 255])
		expect(colorChannels(0x123456)).toEqual([0x12, 0x34, 0x56])
	})

	it('ignores the alpha byte, which Companion packs above the colour', () => {
		expect(colorChannels(0xffff0000)).toEqual([255, 0, 0])
	})

	it('falls back to black for junk', () => {
		expect(colorChannels(undefined)).toEqual([0, 0, 0])
		expect(colorChannels('red')).toEqual([0, 0, 0])
	})
})

describe('renderBarImage', () => {
	it('produces an RGBA buffer of exactly width * height * 4 bytes', () => {
		const base64 = renderBarImage({ width: 8, height: 3, percent: 50, barColor: BAR, trackColor: TRACK })
		expect(pixels(base64)).toHaveLength(8 * 3 * 4)
	})

	it('is fully opaque', () => {
		const buffer = pixels(renderBarImage({ width: 4, height: 2, percent: 50, barColor: BAR, trackColor: TRACK }))
		for (let i = 3; i < buffer.length; i += 4) expect(buffer[i]).toBe(0xff)
	})

	it('fills from the left up to the percentage across the full width', () => {
		const width = 10
		const buffer = pixels(renderBarImage({ width, height: 1, percent: 50, barColor: BAR, trackColor: TRACK }))

		// 50% of 10 columns: the first five are the bar, the rest the track.
		for (let x = 0; x < 5; x += 1) {
			expect(pixelAt(buffer, width, x, 0), `x=${x} should be filled`).toEqual([0, 255, 0, 255])
		}
		for (let x = 5; x < width; x += 1) {
			expect(pixelAt(buffer, width, x, 0), `x=${x} should be track`).toEqual([0x2d, 0x2d, 0x2d, 0xff])
		}
	})

	it('renders an empty track at 0% and a full bar at 100%', () => {
		const width = 10
		const empty = pixels(renderBarImage({ width, height: 1, percent: 0, barColor: BAR, trackColor: TRACK }))
		// 0% is an empty *track*, not an empty buffer: "no time left", not "nothing drawn".
		for (let x = 0; x < width; x += 1) expect(pixelAt(empty, width, x, 0)).toEqual([0x2d, 0x2d, 0x2d, 0xff])

		const full = pixels(renderBarImage({ width, height: 1, percent: 100, barColor: BAR, trackColor: TRACK }))
		for (let x = 0; x < width; x += 1) expect(pixelAt(full, width, x, 0)).toEqual([0, 255, 0, 255])
	})

	it('applies the percentage to every row, not just the first', () => {
		const width = 4
		const buffer = pixels(renderBarImage({ width, height: 3, percent: 100, barColor: BAR, trackColor: TRACK }))
		for (let y = 0; y < 3; y += 1) expect(pixelAt(buffer, width, 3, y)).toEqual([0, 255, 0, 255])
	})

	it('clamps and rounds, and never exceeds the width', () => {
		const width = 8
		const over = pixels(renderBarImage({ width, height: 1, percent: 500, barColor: BAR, trackColor: TRACK }))
		for (let x = 0; x < width; x += 1) expect(pixelAt(over, width, x, 0)).toEqual([0, 255, 0, 255])

		const under = pixels(renderBarImage({ width, height: 1, percent: -5, barColor: BAR, trackColor: TRACK }))
		for (let x = 0; x < width; x += 1) expect(pixelAt(under, width, x, 0)).toEqual([0x2d, 0x2d, 0x2d, 0xff])
	})

	it('survives degenerate geometry without throwing', () => {
		expect(() => renderBarImage({ width: 0, height: 0, percent: 50, barColor: BAR, trackColor: TRACK })).not.toThrow()
		expect(pixels(renderBarImage({ width: 0, height: 0, percent: 50, barColor: BAR, trackColor: TRACK }))).toHaveLength(
			0,
		)
		// Fractional sizes are floored rather than producing a ragged buffer.
		expect(
			pixels(renderBarImage({ width: 2.7, height: 1, percent: 50, barColor: BAR, trackColor: TRACK })),
		).toHaveLength(8)
	})
})

describe('renderBarText', () => {
	it('fills proportionally and always returns the full segment count', () => {
		expect(renderBarText(0, 10)).toBe('░░░░░░░░░░')
		expect(renderBarText(50, 10)).toBe('█████░░░░░')
		expect(renderBarText(100, 10)).toBe('██████████')
	})

	it('clamps and defaults sensibly', () => {
		expect(renderBarText(500, 4)).toBe('████')
		expect(renderBarText(-10, 4)).toBe('░░░░')
		expect(renderBarText(50)).toHaveLength(10)
		expect(renderBarText(Number.NaN)).toHaveLength(10)
	})

	it('never returns fewer segments than asked for, even for fractional counts', () => {
		expect(renderBarText(50, 3.7)).toHaveLength(3)
		expect(renderBarText(50, 0)).toHaveLength(1)
	})
})
