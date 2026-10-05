import { test, expect } from '../../common/test-base';
import type { Page } from '@playwright/test';
import { tableSource } from '../../common/fixtures';

// Reported: "every time the mouse goes into the table's edit area the table
// resizes, and the width wrongly grows" — an auto-layout table whose width
// ratcheted on every single hover, indefinitely.
//
// Cause: renderer.ts's rebuild() (reached from the hover path — shell
// mouseenter -> showSelectors -> requestAnimationFrame(rebuild)) measured every
// column's RENDERED width and wrote it straight back onto <col> and
// <table style="width">, on every rebuild. That is a read -> write loop: any
// width that came from OUTSIDE the loop (a theme `width` declaration the inline
// pin can't beat in the cascade, contentRow's own width:max-content, an
// auto-layout minimum wider than the pinned columns, the table's own
// border/padding) was re-measured and re-pinned as the new floor on the next
// hover, so the delta compounded forever instead of settling. Measured on the
// real source before the fix: +40px per hover with a `width: 100% !important`
// rule, -8px per hover with the grid theme's cell borders, -40px per hover with
// table padding, and (reported from a real vault) +108px per hover on a
// 2-column table that always rendered 18px wider than what had just been pinned.
//
// Fix: the auto-layout pin is written ONCE per rendered table (autoPinTotal);
// later rebuilds still measure, but use the measurement for POSITIONING only
// (colWidthForLayout / measuredColWidth), never as new geometry. Each case below
// re-hovers the same table repeatedly and asserts the rendered width never moves
// — in either direction, since the same loop also visibly shrank tables.
const SOURCE = tableSource({
	widths: [0, 0, 0],
	rows: [
		{ 0: 'alpha one', 1: 'beta two', 2: 'gamma three' },
		{ 0: 'alpha two', 1: 'beta three', 2: 'gamma one' },
	],
});

const CYCLES = 5;

/** Hovers the table `cycles` times, returning its rendered width after each hover. */
async function hoverWidths(page: Page, cycles: number): Promise<number[]> {
	const box = (await page.locator('table.bt-table').boundingBox())!;
	const widths: number[] = [];
	for (let i = 0; i < cycles; i++) {
		await page.mouse.move(box.x + Math.min(30, box.width / 2), box.y + Math.min(10, box.height / 2));
		await page.waitForTimeout(120);
		widths.push(await page.locator('table.bt-table').evaluate(el => el.getBoundingClientRect().width));
		await page.mouse.move(2, 2);
		await page.waitForTimeout(60);
	}
	return widths;
}

function expectStable(widths: number[]): void {
	expect(widths).toHaveLength(CYCLES);
	for (let i = 1; i < widths.length; i++) {
		expect(
			widths[i],
			`table width changed from ${widths[0]}px to ${widths[i]}px by hover ${i} (per-hover widths: ${widths.join(', ')})`,
		).toBeCloseTo(widths[0], 1);
	}
}

test('repeated hovers leave an auto-layout table\'s width alone (baseline)', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	expectStable(await hoverWidths(page, CYCLES));
});

test('repeated hovers leave the width alone with a themed cell-border grid', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	// The built-in grid theme's borders make the table's own box (and therefore
	// what a re-measurement reads) differ from the sum of the columns by a few px
	// per column — the old re-pin subtracted that difference on every hover. The
	// class goes on the rendered .bt-render-root itself (renderThemeClass.ts's own
	// target), NOT on the fixture's #root container it is built inside.
	await page.evaluate(() => {
		document.querySelector('.bt-render-root')?.classList.add('bt-theme-grid');
	});
	expectStable(await hoverWidths(page, CYCLES));
});

test('repeated hovers leave the width alone when the table itself has padding', async ({ page, renderFull }) => {
	await renderFull(SOURCE);
	await page.addStyleTag({ content: '.bt-table { padding: 10px !important; }' });
	expectStable(await hoverWidths(page, CYCLES));
});

test('repeated hovers leave the width alone when a stylesheet width outranks the inline pin', async ({ page, renderFull }) => {
	// An author `!important` declaration beats an inline non-important one, so
	// the pin JS writes can genuinely lose the cascade in a real vault (theme or
	// Obsidian rule). The table must then be sized by that rule and STAY there —
	// the old loop instead measured the rule's width and re-pinned it as a new
	// floor every hover, growing without bound.
	await renderFull(SOURCE);
	await page.addStyleTag({ content: '.markdown-rendered table { width: 100% !important; }' });
	expectStable(await hoverWidths(page, CYCLES));
});
