/**
 * E2E coverage for repairing a rollup whose target field changed type.
 *
 * A `sum` rollup stops computing once its target turns into text. The cell
 * then shows a hint instead of a value; clicking it opens the rollup editor,
 * and saving a calculation that fits brings the values back.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );

async function deleteIfCreated( requestUtils, path ) {
	if ( ! path ) {
		return;
	}
	try {
		await requestUtils.rest( {
			method: 'DELETE',
			path,
			params: { force: true },
		} );
	} catch {
		// Best-effort cleanup; the test may have already deleted it.
	}
}

async function createFlaggedRollupFixture( requestUtils ) {
	const post = ( path, data ) =>
		requestUtils.rest( { method: 'POST', path, data } );

	const invoices = await post( '/wp/v2/crtxt_documents', {
		title: `E2E Rollup Invoices ${ SUFFIX }`,
		status: 'private',
	} );
	const amount = await post(
		`/cortext/v1/collections/${ invoices.id }/fields`,
		{ title: 'Amount', type: 'number' }
	);
	const projects = await post( '/wp/v2/crtxt_documents', {
		title: `E2E Rollup Projects ${ SUFFIX }`,
		status: 'private',
	} );
	const relation = await post(
		`/cortext/v1/collections/${ projects.id }/fields`,
		{
			title: 'Invoices',
			type: 'relation',
			related_collection_id: invoices.id,
			relation_multiple: true,
		}
	);
	const rollup = await post(
		`/cortext/v1/collections/${ projects.id }/fields`,
		{
			title: 'Total',
			type: 'rollup',
			rollup_relation_field_id: relation.id,
			rollup_target_field_id: amount.id,
			rollup_aggregator: 'sum',
		}
	);
	const invoice = await post( '/wp/v2/crtxt_documents', {
		title: 'Invoice 1',
		status: 'private',
		cortext_trait: invoices.id,
		meta: { [ `field-${ amount.id }` ]: 42 },
	} );
	const project = await post( '/wp/v2/crtxt_documents', {
		title: 'Project 1',
		status: 'private',
		cortext_trait: projects.id,
	} );
	await post( `/wp/v2/crtxt_documents/${ project.id }`, {
		meta: { [ `field-${ relation.id }` ]: [ invoice.id ] },
	} );

	// Turning the target into text leaves the sum with nothing to add up.
	await post( `/cortext/v1/fields/${ amount.id }/convert`, {
		type: 'text',
	} );

	return { invoices, projects, rollup, invoice, project };
}

test.describe( 'Rollup repair', () => {
	test( 'fixes a flagged rollup from the hint in its cell', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let fixture = {};

		try {
			fixture = await createFlaggedRollupFixture( requestUtils );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.projects.slug }-${ fixture.projects.id }`
			);
			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			const projectRow = canvas
				.locator( '.dataviews-view-table tbody tr' )
				.filter( { hasText: 'Project 1' } );

			const hint = projectRow.getByRole( 'button', {
				name: 'Target property changed type',
			} );
			await expect( hint ).toBeVisible();
			await hint.click();

			// The editor popover renders in the shell, outside the canvas.
			const save = page.getByRole( 'button', { name: 'Save rollup' } );
			await expect( save ).toBeEnabled();
			await save.click();

			await expect( hint ).toHaveCount( 0 );
			await expect( projectRow ).toContainText( '42' );
		} finally {
			for ( const doc of [
				fixture.project,
				fixture.invoice,
				fixture.projects,
				fixture.invoices,
			] ) {
				await deleteIfCreated(
					requestUtils,
					doc && `/wp/v2/crtxt_documents/${ doc.id }`
				);
			}
		}
	} );

	test( 'fixes a flagged rollup from the hint in its row details', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let fixture = {};

		try {
			fixture = await createFlaggedRollupFixture( requestUtils );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.project.id }`
			);
			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			const total = canvas
				.locator( '.cortext-row-detail__property' )
				.filter( { hasText: 'Total' } );

			const hint = total.getByRole( 'button', {
				name: 'Target property changed type',
			} );
			await expect( hint ).toBeVisible();
			await hint.click();

			const save = page.getByRole( 'button', { name: 'Save rollup' } );
			await expect( save ).toBeEnabled();
			await save.click();

			await expect( hint ).toHaveCount( 0 );
			await expect( total ).toContainText( '42' );
		} finally {
			for ( const doc of [
				fixture.project,
				fixture.invoice,
				fixture.projects,
				fixture.invoices,
			] ) {
				await deleteIfCreated(
					requestUtils,
					doc && `/wp/v2/crtxt_documents/${ doc.id }`
				);
			}
		}
	} );
} );
