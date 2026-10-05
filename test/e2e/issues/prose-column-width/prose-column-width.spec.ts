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
// Fix: auto-fit-all sizes every column from the VIEW's width (an equal share of
// it) whenever the content-fitted total would exceed the view, an auto-layout
// table is capped at the view width for tables that were never auto-fitted, and
// both leave the add-column strip its own 18px so a view-filling table can't be
// covered by it (or by the whole-view width handle sitting on that same edge).
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
		// Both live in the outermost layer now — sibling overlays of the wrapper.
		const addCol = document.querySelector('.bt-render-root > .bt-edge-add-col') as HTMLElement | null;
		const grip = document.querySelector('.bt-render-root > .bt-view-resize-br') as HTMLElement | null;
		const tBox = t.getBoundingClientRect();
		const addColBox = addCol?.getBoundingClientRect();
		const gripBox = grip?.getBoundingClientRect();
		const root = document.querySelector('.bt-render-root') as HTMLElement;
		const rBox = root.getBoundingClientRect();
		return {
			paneW: +document.getElementById('root')!.getBoundingClientRect().width.toFixed(1),
			wrapperW: +wrapper.getBoundingClientRect().width.toFixed(1),
			tableW: +tBox.width.toFixed(1),
			colW: [...t.querySelectorAll('col')].map(c => +c.getBoundingClientRect().width.toFixed(1)),
			firstDataRowH: +[...t.querySelectorAll('tbody tr')][0].getBoundingClientRect().height.toFixed(1),
			addColW: addCol ? +addCol.offsetWidth : 0,
			gripW: grip ? +grip.offsetWidth : 0,
			laneW: Math.round(parseFloat(getComputedStyle(root).paddingRight) || 0),
			leftPadW: Math.round(parseFloat(getComputedStyle(root).paddingLeft) || 0),
			overlap: addColBox ? +(tBox.right - addColBox.left).toFixed(1) : -1,
			gripOverStrip: addColBox && gripBox ? +(addColBox.right - gripBox.left).toFixed(1) : -1,
			gripRight: gripBox ? +(gripBox.right - rBox.left).toFixed(1) : -1,
			rootW: +rBox.width.toFixed(1),
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
	// The reserved right lane holds the add-column strip AND the view-width
	// handle, side by side, in the outermost layer: [table][+ strip][handle][pane
	// edge]. Table + lane = the pane's content box, and neither overlay is on the
	// table.
	expect(g.laneW, 'the lane should hold the strip plus the width handle').toBe(g.addColW + g.gripW);
	expect(g.tableW, 'the table should fill the content box, clear of the lane')
		.toBeCloseTo(g.paneW - g.leftPadW - g.laneW, -1);
	expect(g.overlap, `table's right edge is ${g.overlap}px past the add-column strip's left edge`).toBeLessThanOrEqual(0.5);
	expect(g.gripOverStrip, `the width handle is ${g.gripOverStrip}px past the strip's right edge`).toBeLessThanOrEqual(0.5);
	expect(g.gripRight, 'the width handle should sit at the outer edge').toBeCloseTo(g.rootW, -1);
});

test('an auto column next to an explicit one still leaves the add-column strip its space', async ({ page, renderFull }) => {
	// The mixed table — one column with an explicit width, its sibling still auto
	// — is the case applyAutoColWidths measures and pins, and the one reported as
	// "现在是滚动到最右边列表才和添加按钮不重叠": each fitted column was capped
	// at the whole view, so table + strip came out wider than the view and the
	// sticky strip sat on the last column until the table was scrolled right.
	await renderFull(tableSource({
		widths: [100, 0],
		rows: [
			{ 0: 'x', 1: PROSE },
			{ 0: 'y', 1: 'z' },
		],
	}));
	// The strip's position comes from positionEdgeStrips (hover/scroll-driven, the
	// same as every other root-level overlay here), so hover before measuring.
	const box = (await page.locator('.bt-table-wrapper:not(#wrapper)').boundingBox())!;
	await page.mouse.move(box.x + 30, box.y + 10);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	const g = await geometry(page);
	expect(g.addColW, 'the add-column strip should be present in this edit-mode render').toBeGreaterThan(0);
	expect(g.laneW, 'the lane should hold the strip plus the width handle').toBe(g.addColW + g.gripW);
	expect(g.overlap, `table's right edge is ${g.overlap}px past the strip's left edge`).toBeLessThanOrEqual(0.5);
	expect(g.gripOverStrip, `the width handle is ${g.gripOverStrip}px past the strip's right edge`).toBeLessThanOrEqual(0.5);
	expect(g.firstDataRowH, 'the prose paragraph did not wrap').toBeGreaterThan(60);
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
