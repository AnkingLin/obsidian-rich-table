import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';
import { tableSource } from '../../common/fixtures';

// A column's resize handle has to sit on the seam the user can SEE, and a drag
// has to move the column by the amount the pointer moved. Both used to be
// derived from <col>'s style width — i.e. from whatever was last written there.
// That is fine only while something keeps rewriting it in step with the render
// (renderer.ts's rebuild() used to re-pin an auto-layout table's widths on every
// hover, which is exactly the loop that made the table's own width ratchet), and
// it is wrong the moment the two differ: a theme/Obsidian `width` declaration
// the inline pin can't beat in the cascade, the table's own border/padding, or a
// content-forced minimum all make the rendered column a different width from the
// pin. Measured on a 3-column auto table with `width:100% !important`: <col>
// pinned at 102.55px, column rendering at 108.63px — the first handle's seam 6px
// left of the real edge, and a 40px drag committing 142px while visibly moving
// the column 56px.
//
// Fix: the handle seam (renderAutofit.ts's colRightX), the strip/grip widths
// (renderer.ts's colWidthForLayout) and the drag's own starting width
// (renderResize.ts's setupColResize) now MEASURE the rendered column instead of
// reading the pin, with the style width left as the fallback for a tree with no
// boxes to measure.
const SOURCE = tableSource({
	widths: [0, 0, 0],
	rows: [
		{ 0: 'alpha one', 1: 'beta two', 2: 'gamma three' },
		{ 0: 'alpha two', 1: 'beta three', 2: 'gamma one' },
	],
});

const DRAG_PX = 40;

/** Real rendered right edge of column 0, relative to the table's own left edge. */
async function renderedSeam(page: Page): Promise<number> {
	return page.evaluate(() => {
		const t = document.querySelector('table.bt-table')!;
		const col = [...t.querySelectorAll('col')][0];
		return col.getBoundingClientRect().right - t.getBoundingClientRect().left;
	});
}

/** Width column 0's cells actually render at. */
async function renderedColWidth(page: Page): Promise<number> {
	return page.evaluate(() => {
		const t = document.querySelector('table.bt-table')!;
		return [...t.querySelectorAll('tbody tr')][0].children[0].getBoundingClientRect().width;
	});
}

async function hoverTable(page: Page): Promise<void> {
	const box = (await page.locator('table.bt-table').boundingBox())!;
	await page.mouse.move(box.x + 30, box.y + 10);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);
}

/** Drags the first column's resize handle by `DRAG_PX` and returns the committed width. */
async function dragFirstHandle(page: Page): Promise<number> {
	await page.locator('.bt-sel-resize-col').first().evaluate((el: HTMLElement, dragPx: number) => {
		const mk = (type: string, x: number) => new PointerEvent(type, { button: 0, pointerId: 1, clientX: x, clientY: 200, bubbles: true, cancelable: true });
		el.dispatchEvent(mk('pointerdown', 100));
		el.dispatchEvent(mk('pointermove', 100 + dragPx));
		el.dispatchEvent(mk('pointerup', 100 + dragPx));
	}, DRAG_PX);
	const ops = await page.evaluate(() => (window as unknown as { __btOps: { type: string; width?: number }[] }).__btOps);
	const widthOps = ops.filter(op => op.type === 'set-col-width');
	expect(widthOps.length).toBeGreaterThan(0);
	return widthOps[widthOps.length - 1].width ?? NaN;
}

async function expectHandleOnRealSeam(page: Page): Promise<void> {
	const rx = await page.locator('.bt-sel-resize-col').first().evaluate((el: HTMLElement) => parseFloat(el.style.getPropertyValue('--rx')));
	const seam = await renderedSeam(page);
	expect(Math.abs(rx - seam), `handle seam at ${rx}px, column really ends at ${seam}px`).toBeLessThanOrEqual(0.75);
}

test('a resize handle sits on the rendered seam, and the drag tracks the pointer (baseline)', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await hoverTable(page);
	await expectHandleOnRealSeam(page);

	const before = await renderedColWidth(page);
	const committed = await dragFirstHandle(page);
	expect(Math.abs(committed - (before + DRAG_PX))).toBeLessThanOrEqual(1.5);
	expect(Math.abs((await renderedColWidth(page)) - (before + DRAG_PX))).toBeLessThanOrEqual(3);
});

test('a resize handle sits on the rendered seam with the grid theme\'s cell borders', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await page.evaluate(() => document.querySelector('.bt-render-root')?.classList.add('bt-theme-grid'));
	await hoverTable(page);
	await expectHandleOnRealSeam(page);

	const before = await renderedColWidth(page);
	const committed = await dragFirstHandle(page);
	expect(Math.abs(committed - (before + DRAG_PX))).toBeLessThanOrEqual(1.5);
});

test('a resize handle sits on the rendered seam when a stylesheet width outranks the pin', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await page.addStyleTag({ content: '.markdown-rendered table { width: 100% !important; }' });
	await hoverTable(page);
	await expectHandleOnRealSeam(page);

	// The table's own width is the theme rule's here, so what the drag can be
	// held to is the width it started from: the committed value must be anchored
	// to the column the user is looking at, not to a pin the render ignores.
	const before = await renderedColWidth(page);
	const committed = await dragFirstHandle(page);
	expect(Math.abs(committed - (before + DRAG_PX))).toBeLessThanOrEqual(1.5);
});

test('a resize handle sits on the rendered seam when the table itself has a border', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await page.addStyleTag({ content: '.bt-table { border: 2px solid red !important; }' });
	await hoverTable(page);
	await expectHandleOnRealSeam(page);

	const before = await renderedColWidth(page);
	const committed = await dragFirstHandle(page);
	expect(Math.abs(committed - (before + DRAG_PX))).toBeLessThanOrEqual(1.5);
});
