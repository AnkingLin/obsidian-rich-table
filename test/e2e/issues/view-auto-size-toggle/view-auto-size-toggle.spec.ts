import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported: 勾选"自动宽度"和"自动高度"后无法取消 — once Auto width / Auto height
// was checked in the View settings menu, clicking it again did nothing. Both
// entries only ever committed `null` (auto), so regardless of which way the
// checkbox was showing, the click wrote the same value the model already had: the
// setting could be turned on and never off.
//
// Unchecking now freezes the view at the size it currently has — the only choice
// that cannot make the table jump at the moment of the switch, and the natural
// inverse of "auto": an explicit size matching what is on screen.
const MANUAL = tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }], viewWidth: 400, viewHeight: 200 });
const AUTO = tableSource({ widths: [100, 100], rows: [{ 0: 'x', 1: 'y' }] });

async function clickMenuEntry(page: import('@playwright/test').Page, title: string): Promise<void> {
	await page.locator('.bt-ctrl-btn[aria-label="View settings"]').click();
	const clicked = await page.evaluate((t) => {
		const menu = window.RichTableReal.ShimMenu.opened[window.RichTableReal.ShimMenu.opened.length - 1];
		return menu ? menu.clickItem(t) : false;
	}, title);
	expect(clicked, `the menu should have a "${title}" entry`).toBe(true);
}

const viewOps = (page: import('@playwright/test').Page) =>
	page.evaluate(() => (window as unknown as { __btOps: { type: string; width?: number | null; height?: number | null }[] }).__btOps
		.filter(op => op.type === 'set-view-width' || op.type === 'set-view-height'));

test('a checked "Auto width" can be turned back off, freezing the current size', async ({ page, renderFull }) => {
	await renderFull(AUTO);

	const rendered = await page.evaluate(() => {
		const wrapper = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement;
		return { w: wrapper.getBoundingClientRect().width, h: wrapper.getBoundingClientRect().height };
	});

	await clickMenuEntry(page, 'Auto width');
	const [op] = await viewOps(page);
	expect(op?.type).toBe('set-view-width');
	// A real, positive px width — not another `null`, which is what made this
	// impossible to uncheck.
	expect(typeof op.width, 'unchecking Auto width must commit a concrete width').toBe('number');
	expect(op.width as number).toBeGreaterThan(0);
	expect(Math.abs((op.width as number) - rendered.w), 'the frozen width should be what was on screen').toBeLessThanOrEqual(2);
});

test('a checked "Auto height" can be turned back off, freezing the current size', async ({ page, renderFull }) => {
	await renderFull(AUTO);

	const rendered = await page.evaluate(() => {
		const wrapper = document.querySelector('.bt-table-wrapper:not(#wrapper)') as HTMLElement;
		return wrapper.getBoundingClientRect().height;
	});

	await clickMenuEntry(page, 'Auto height');
	const [op] = await viewOps(page);
	expect(op?.type).toBe('set-view-height');
	expect(typeof op.height, 'unchecking Auto height must commit a concrete height').toBe('number');
	expect(op.height as number).toBeGreaterThan(0);
	expect(Math.abs((op.height as number) - rendered), 'the frozen height should be what was on screen').toBeLessThanOrEqual(2);
});

test('an unchecked "Auto width"/"Auto height" still switches back to auto', async ({ page, renderFull }) => {
	await renderFull(MANUAL);

	await clickMenuEntry(page, 'Auto width');
	await clickMenuEntry(page, 'Auto height');
	const ops = await viewOps(page);
	expect(ops).toEqual([
		{ type: 'set-view-width', width: null },
		{ type: 'set-view-height', height: null },
	]);
});
