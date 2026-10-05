import { test, expect } from '../../common/test-base';
import { tableSource } from '../../common/fixtures';

// Reported after the resize-anchoring fix: dragging a column narrower/wider and
// RELEASING left the page blank — "only one column, no column names". That is
// the write-back path, not the drag math: the committed set-col-width lands in
// the model, the note is rewritten, Obsidian re-runs the code-block processor,
// and the table is rebuilt from the model with that ONE column now having an
// explicit width while its siblings are still auto. That is the "mixed" render
// path (hasExplicitWidths + col[data-auto] + tableBlock.ts's post-swap
// applyAutoColWidths fix-up), which nothing else in this suite covers end to end
// for an all-auto table that becomes mixed through a resize.
const SOURCE = tableSource({
	widths: [0, 0, 0],
	rows: [
		{ 0: 'one', 1: 'two', 2: 'three' },
		{ 0: 'a', 1: 'b', 2: 'c' },
	],
});

test('resizing a column and releasing leaves every column and header after the rebuild', async ({ page, renderBlock }) => {
	const block = await renderBlock(SOURCE);
	expect(await page.locator('.bt-table thead .bt-th').count()).toBe(3);

	const box = (await page.locator('.bt-table').boundingBox())!;
	await page.mouse.move(box.x + 30, box.y + 10);
	await expect.poll(() => page.locator('.bt-col-selector').evaluate((el: HTMLElement) => el.classList.contains('bt-strip-visible')))
		.toBe(true);

	await page.locator('.bt-sel-resize-col').first().evaluate((el: HTMLElement) => {
		const mk = (type: string, x: number) => new PointerEvent(type, { button: 0, pointerId: 1, clientX: x, clientY: 200, bubbles: true, cancelable: true });
		el.dispatchEvent(mk('pointerdown', 100));
		el.dispatchEvent(mk('pointermove', 140));
		el.dispatchEvent(mk('pointerup', 140));
	});

	// The write landed: the first column now carries an explicit width.
	await expect.poll(() => block.noteText()).toContain('width:');
	const note = await block.noteText();
	for (const id of ['c_0', 'c_1', 'c_2']) {
		expect(note, `column ${id} disappeared from the note:\n${note}`).toContain(id);
	}
	expect(note, `cell content disappeared from the note:\n${note}`).toContain('three');

	// Obsidian's own follow-up to that write: the block's DOM is torn down and the
	// code-block processor runs again over the rewritten note. The rebuilt table
	// is now a MIXED one (c_0 explicit, c_1/c_2 still auto), which is the render
	// path a resize is the only thing in the plugin that can produce.
	await block.reprocess();
	await expect.poll(() => page.locator('.bt-table thead .bt-th').count()).toBe(3);

	// And the rebuilt table still renders all three columns, with their headers.
	const headerText = await page.locator('.bt-table thead .bt-th').allInnerTexts();
	expect(headerText.map(s => s.trim())).toEqual(['A', 'B', 'C']);
	const renderedWidths = await page.evaluate(() => {
		const t = document.querySelector('.bt-table')!;
		return [...t.querySelectorAll('col')].map(c => c.getBoundingClientRect().width);
	});
	expect(renderedWidths).toHaveLength(3);
	for (const w of renderedWidths) expect(w, `column collapsed to ${w}px`).toBeGreaterThan(20);
	const cellCounts = await page.evaluate(() =>
		[...document.querySelectorAll('.bt-table tbody tr')].map(tr => tr.children.length));
	expect(cellCounts).toEqual([3, 3]);
});
