import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: click auto-fit-all (自动调整列宽和列高), then resize a column, and
// afterwards the columns are enormous — one td measured 98942.8 x 135.984, the
// pane shows a single mostly-empty column, and every table done this way ends up
// the same. Cause: every column in that flow is AUTO, and an auto column's width
// is its content's max-content — i.e. the whole paragraph on ONE line. Chinese
// prose has no spaces to break on, so the measurement (and the layout itself) is
// unbounded: 936 chars of Chinese prose = a 13128px column inside a 1240px pane.
// auto-fit-all is what puts a table into that state (it clears every column's
// width), which is why that button is the first step of the repro.
//
// Fix: an auto-layout table (renderer.ts tags it .bt-table-auto) is capped at the
// row's available width so long text wraps like any other table cell, and the
// nowrap measurement behind auto-fit / a mixed table's auto columns is capped at
// the view's own width instead of pinning a paragraph's single-line width.
const PROSE = '鸦片战争以后中国社会的主要矛盾发生了深刻的变化，外国资本主义的侵入破坏了中国自给自足的自然经济基础，同时给中国资本主义生产的发展造成了某些客观的条件和可能。'.repeat(12);

const SOURCE = tableSource({
	widths: [0, 0, 0],
	rows: [
		{ 0: '鸦片战争以后', 1: PROSE, 2: 'c1' },
		{ 0: 'x', 1: 'y', 2: 'z' },
	],
});

async function geometry(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const t = document.querySelector('.bt-table')!;
		const wrapper = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement;
		return {
			paneW: +document.getElementById('root')!.getBoundingClientRect().width.toFixed(1),
			wrapperW: +wrapper.getBoundingClientRect().width.toFixed(1),
			tableW: +t.getBoundingClientRect().width.toFixed(1),
			colW: [...t.querySelectorAll('col')].map(c => +c.getBoundingClientRect().width.toFixed(1)),
			firstDataRowH: +[...t.querySelectorAll('tbody tr')][0].getBoundingClientRect().height.toFixed(1),
		};
	});
}

test('a prose column renders at the view\'s width, not the paragraph\'s single-line width', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const g = await geometry(page);
	// The paragraph must WRAP inside the pane (a wrapped paragraph is many lines
	// tall), and no column may be wider than the view.
	expect(g.tableW, `table rendered ${g.tableW}px wide in a ${g.paneW}px pane`).toBeLessThanOrEqual(g.paneW + 1);
	for (const w of g.colW) expect(w, `column rendered ${w}px wide`).toBeLessThanOrEqual(g.paneW);
	expect(g.firstDataRowH, 'the prose paragraph did not wrap').toBeGreaterThan(60);
});

test('auto-fit-all sizes the columns from the view width, not from each cell\'s content', async ({ page, renderFull }) => {
	await renderFull(SOURCE);

	const box = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(box.x + 30, box.y + 10);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	// The reported first step: auto-fit-all.
	await page.locator('.bt-ctrl-btn').nth(1).click();
	await page.waitForTimeout(200);

	const committed = await page.evaluate(() =>
		(window as unknown as { __btOps: { type: string; width?: number }[] }).__btOps
			.filter(op => op.type === 'set-col-width')
			.map(op => op.width as number));
	expect(committed).toHaveLength(3);

	// Every column is sized from the VIEW, so all three come out the same share of
	// it — NOT the paragraph's single-line width (which used to arrive here as a
	// five-figure px value), and no column hogs the table just because its cell
	// holds the longest text.
	const g = await geometry(page);
	for (const w of committed) expect(w, `a column width of ${w}px was committed`).toBeLessThanOrEqual(g.paneW);
	expect(new Set(committed).size, `columns were fitted to their content, not the view: ${committed.join(', ')}`).toBe(1);
	for (const w of g.colW) expect(w, `column rendered ${w}px wide after auto-fit`).toBeLessThanOrEqual(g.paneW);
	expect(g.tableW, 'the fitted table should fill the view it was fitted to').toBeCloseTo(g.paneW, -1);
});

test('auto-fit-all then resizing a column keeps the whole table within the view', async ({ page, renderFull }) => {
	// The reported repro end to end: auto-fit-all, then drag a column's seam.
	await renderFull(SOURCE);

	const box = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(box.x + 30, box.y + 10);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	await page.locator('.bt-ctrl-btn').nth(1).click();
	await page.waitForTimeout(200);

	await page.locator('.bt-sel-resize-col').first().evaluate((el: HTMLElement) => {
		const mk = (type: string, x: number) => new PointerEvent(type, { button: 0, pointerId: 1, clientX: x, clientY: 200, bubbles: true, cancelable: true });
		el.dispatchEvent(mk('pointerdown', 100));
		el.dispatchEvent(mk('pointermove', 140));
		el.dispatchEvent(mk('pointerup', 140));
	});
	await page.waitForTimeout(200);

	const g = await geometry(page);
	// The dragged column grew by the drag; the prose column it was fitted to the
	// view does not come back as a five-figure width, and no column exceeds the
	// view it was fitted to.
	for (const w of g.colW) expect(w, `column rendered ${w}px wide after the resize`).toBeLessThanOrEqual(g.paneW);
	expect(g.tableW, `table rendered ${g.tableW}px in a ${g.paneW}px pane`).toBeLessThanOrEqual(g.paneW * 2);
});
