/**
 * E2E coverage for server-backed row query behavior.
 */

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
		// Best-effort cleanup; failures here should not mask the test result.
	}
}

function rowsPath( params ) {
	const query = new URLSearchParams();
	for ( const [ key, value ] of Object.entries( params ) ) {
		query.append( key, String( value ) );
	}
	return `/cortext/v1/rows?${ query.toString() }`;
}

async function queryRows( requestUtils, collectionId, params = {} ) {
	return requestUtils.rest( {
		path: rowsPath( {
			collection: collectionId,
			per_page: 100,
			...params,
		} ),
	} );
}

function rowIds( response ) {
	return response.rows.map( ( row ) => row.id );
}

async function createField( requestUtils, title, type ) {
	return requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_fields',
		data: {
			title,
			status: 'private',
			meta: { type },
		},
	} );
}

async function createRowsQueryFixture( requestUtils ) {
	const suffix = `${ Date.now().toString( 36 ).slice( -5 ) }${ Math.random()
		.toString( 36 )
		.slice( 2, 4 ) }`;
	const slug = `rows${ suffix }`;

	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_traits',
		data: {
			title: `E2E Rows ${ suffix }`,
			status: 'private',
			meta: { slug },
		},
	} );

	const fields = {
		status: await createField( requestUtils, 'Status', 'text' ),
		notes: await createField( requestUtils, 'Notes', 'text' ),
		score: await createField( requestUtils, 'Score', 'number' ),
		due: await createField( requestUtils, 'Due', 'date' ),
		phase: await createField( requestUtils, 'Phase', 'select' ),
	};

	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_traits/${ collection.id }`,
		data: {
			meta: {
				fields: Object.values( fields ).map( ( field ) =>
					String( field.id )
				),
			},
		},
	} );

	const rows = {};
	for ( const spec of [
		{
			key: 'alpha',
			title: 'Alpha',
			status: 'red',
			notes: 'ordinary note',
			score: '9',
			due: '2026-02-01',
			phase: 'beta',
		},
		{
			key: 'bravo',
			title: 'Bravo',
			status: 'blue',
			notes: 'needle in the meta field',
			score: '10',
			due: '2026-03-01',
			phase: 'gamma',
		},
		{
			key: 'charlie',
			title: 'Charlie',
			status: 'blue',
			notes: 'ordinary note',
			score: '2',
			due: '2026-01-01',
			phase: 'alpha',
		},
	] ) {
		rows[ spec.key ] = await requestUtils.rest( {
			method: 'POST',
			path: `/wp/v2/crtxt_${ slug }`,
			data: {
				title: spec.title,
				status: 'private',
				meta: {
					[ `field-${ fields.status.id }` ]: spec.status,
					[ `field-${ fields.notes.id }` ]: spec.notes,
					[ `field-${ fields.score.id }` ]: spec.score,
					[ `field-${ fields.due.id }` ]: spec.due,
					[ `field-${ fields.phase.id }` ]: spec.phase,
				},
			},
		} );
	}

	return { collection, fields, rows, slug };
}

test.describe( 'rows endpoint server query', () => {
	test( 'searches meta, applies grouped filters, and sorts supported fields', async ( {
		requestUtils,
	} ) => {
		let fixture;
		try {
			fixture = await createRowsQueryFixture( requestUtils );
			const { collection, fields, rows } = fixture;

			const search = await queryRows( requestUtils, collection.id, {
				search: 'needle',
			} );
			expect( rowIds( search ) ).toEqual( [ rows.bravo.id ] );

			const grouped = await queryRows( requestUtils, collection.id, {
				'sort[field]': 'title',
				'sort[direction]': 'asc',
				'filters[0][relation]': 'AND',
				'filters[0][filters][0][field]': 'title',
				'filters[0][filters][0][operator]': 'notContains',
				'filters[0][filters][0][value]': 'Charlie',
				'filters[0][filters][1][relation]': 'OR',
				'filters[0][filters][1][filters][0][field]': `field-${ fields.status.id }`,
				'filters[0][filters][1][filters][0][operator]': 'is',
				'filters[0][filters][1][filters][0][value]': 'red',
				'filters[0][filters][1][filters][1][field]': `field-${ fields.score.id }`,
				'filters[0][filters][1][filters][1][operator]': 'greaterThan',
				'filters[0][filters][1][filters][1][value]': 9,
			} );
			expect( rowIds( grouped ) ).toEqual( [
				rows.alpha.id,
				rows.bravo.id,
			] );

			const titleSort = await queryRows( requestUtils, collection.id, {
				'sort[field]': 'title',
				'sort[direction]': 'asc',
			} );
			expect( rowIds( titleSort ) ).toEqual( [
				rows.alpha.id,
				rows.bravo.id,
				rows.charlie.id,
			] );

			const numberSort = await queryRows( requestUtils, collection.id, {
				'sort[field]': `field-${ fields.score.id }`,
				'sort[direction]': 'asc',
			} );
			expect( rowIds( numberSort ) ).toEqual( [
				rows.charlie.id,
				rows.alpha.id,
				rows.bravo.id,
			] );

			const dateSort = await queryRows( requestUtils, collection.id, {
				'sort[field]': `field-${ fields.due.id }`,
				'sort[direction]': 'asc',
			} );
			expect( rowIds( dateSort ) ).toEqual( [
				rows.charlie.id,
				rows.alpha.id,
				rows.bravo.id,
			] );

			const selectSort = await queryRows( requestUtils, collection.id, {
				'sort[field]': `field-${ fields.phase.id }`,
				'sort[direction]': 'asc',
			} );
			expect( rowIds( selectSort ) ).toEqual( [
				rows.charlie.id,
				rows.alpha.id,
				rows.bravo.id,
			] );
		} finally {
			if ( fixture ) {
				for ( const row of Object.values( fixture.rows ) ) {
					await deleteIfCreated(
						requestUtils,
						`/wp/v2/crtxt_${ fixture.slug }/${ row.id }`
					);
				}
				for ( const field of Object.values( fixture.fields ) ) {
					await deleteIfCreated(
						requestUtils,
						`/wp/v2/crtxt_fields/${ field.id }`
					);
				}
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_traits/${ fixture.collection.id }`
				);
			}
		}
	} );
} );
