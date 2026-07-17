const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

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
		// Cleanup is idempotent; the record may already be gone.
	}
}

test.describe( 'Templates', () => {
	test( 'instantiates page and row templates as snapshots', async ( {
		requestUtils,
	} ) => {
		const fixture = {};
		const suffix = Date.now().toString( 36 ).slice( -4 );

		try {
			const sourcePage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `E2E Page Template Source ${ suffix }`,
					status: 'private',
					content:
						'<!-- wp:paragraph --><p>Original page body</p><!-- /wp:paragraph -->',
				},
			} );
			fixture.sourcePageId = sourcePage.id;

			const pageTemplateResponse = await requestUtils.rest( {
				method: 'POST',
				path: '/cortext/v1/templates/from-document',
				data: {
					document_id: fixture.sourcePageId,
				},
			} );
			fixture.pageTemplateId = pageTemplateResponse.template.id;

			const pageResponse = await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/templates/${ fixture.pageTemplateId }/instantiate`,
			} );
			fixture.pageId = pageResponse.document.id;

			await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/templates/${ fixture.pageTemplateId }`,
				data: {
					content:
						'<!-- wp:paragraph --><p>Mutated page body</p><!-- /wp:paragraph -->',
				},
			} );

			const page = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ fixture.pageId }`,
				params: { context: 'edit' },
			} );
			expect( page.content.raw ).toContain( 'Original page body' );
			expect( page.content.raw ).not.toContain( 'Mutated page body' );

			const collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `E2E Template Rows ${ suffix }`,
					status: 'private',
				},
			} );
			fixture.collectionId = collection.id;

			const field = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: `Status ${ suffix }`,
					status: 'private',
					meta: { type: 'text' },
				},
			} );
			fixture.fieldId = field.id;

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_documents/${ fixture.collectionId }`,
				data: {
					meta: { cortext_fields: [ String( fixture.fieldId ) ] },
				},
			} );

			const sourceRow = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `E2E Row Template Source ${ suffix }`,
					status: 'private',
					cortext_trait: fixture.collectionId,
					content:
						'<!-- wp:paragraph --><p>Original row body</p><!-- /wp:paragraph -->',
					meta: {
						[ `field-${ fixture.fieldId }` ]: 'template default',
					},
				},
			} );
			fixture.sourceRowId = sourceRow.id;

			const rowTemplateResponse = await requestUtils.rest( {
				method: 'POST',
				path: '/cortext/v1/templates/from-document',
				data: {
					document_id: fixture.sourceRowId,
				},
			} );
			fixture.rowTemplateId = rowTemplateResponse.template.id;

			const rowResponse = await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/templates/${ fixture.rowTemplateId }/instantiate`,
				data: {
					field_values: {
						[ `field-${ fixture.fieldId }` ]: 'filter prefill',
					},
				},
			} );
			fixture.rowId = rowResponse.document.id;

			await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/templates/${ fixture.rowTemplateId }`,
				data: {
					content:
						'<!-- wp:paragraph --><p>Mutated row body</p><!-- /wp:paragraph -->',
					field_values: {
						[ `field-${ fixture.fieldId }` ]: 'mutated default',
					},
				},
			} );

			const row = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ fixture.rowId }`,
				params: { context: 'edit' },
			} );
			expect( row.content.raw ).toContain( 'Original row body' );
			expect( row.content.raw ).not.toContain( 'Mutated row body' );
			expect( row.meta[ `field-${ fixture.fieldId }` ] ).toBe(
				'filter prefill'
			);
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.rowId && `/wp/v2/crtxt_documents/${ fixture.rowId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.pageId && `/wp/v2/crtxt_documents/${ fixture.pageId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.sourceRowId &&
					`/wp/v2/crtxt_documents/${ fixture.sourceRowId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.sourcePageId &&
					`/wp/v2/crtxt_documents/${ fixture.sourcePageId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.rowTemplateId &&
					`/cortext/v1/templates/${ fixture.rowTemplateId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.pageTemplateId &&
					`/cortext/v1/templates/${ fixture.pageTemplateId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collectionId &&
					`/wp/v2/crtxt_documents/${ fixture.collectionId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.fieldId && `/wp/v2/crtxt_fields/${ fixture.fieldId }`
			);
		}
	} );
} );
