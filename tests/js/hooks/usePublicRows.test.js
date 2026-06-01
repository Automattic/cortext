import { renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import usePublicRows, {
	buildQueryArgs,
	isPublicSortSupported,
} from '../../../src/hooks/usePublicRows';

const supportedFields = [
	[ 11, 'text' ],
	[ 12, 'email' ],
	[ 13, 'url' ],
	[ 14, 'number' ],
	[ 15, 'date' ],
	[ 16, 'datetime' ],
	[ 17, 'checkbox' ],
	[ 18, 'select' ],
];

const unsupportedFields = [
	[ 21, 'multiselect' ],
	[ 22, 'relation' ],
	[ 23, 'rollup' ],
];

const fieldDefs = [ ...supportedFields, ...unsupportedFields ].map(
	( [ id, type ] ) => ( { id, type } )
);

function requestParams( callIndex ) {
	const path = apiFetch.mock.calls[ callIndex ][ 0 ].path;
	return new URL( path, 'https://example.test' ).searchParams;
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'usePublicRows query args', () => {
	it( 'uses REST-valid public pagination args', () => {
		const args = buildQueryArgs( 7, {}, fieldDefs );

		expect( args.context ).toBe( 'view' );
		expect( args.page ).toBe( 1 );
		expect( args.per_page ).toBe( 100 );
	} );

	it.each( supportedFields )(
		'forwards supported saved field-%s sort to the public rows endpoint',
		( fieldId ) => {
			const args = buildQueryArgs(
				7,
				{ sort: { field: `field-${ fieldId }`, direction: 'desc' } },
				fieldDefs
			);

			expect( args[ 'sort[field]' ] ).toBe( `field-${ fieldId }` );
			expect( args[ 'sort[direction]' ] ).toBe( 'desc' );
		}
	);

	it( 'normalizes unsupported sort directions before forwarding', () => {
		const args = buildQueryArgs(
			7,
			{ sort: { field: 'field-14', direction: 'sideways' } },
			fieldDefs
		);

		expect( args[ 'sort[field]' ] ).toBe( 'field-14' );
		expect( args[ 'sort[direction]' ] ).toBe( 'asc' );
	} );

	it( 'does not forward manual sort because it is the default row order', () => {
		const args = buildQueryArgs(
			7,
			{ sort: { field: 'manual', direction: 'asc' } },
			fieldDefs
		);

		expect( args[ 'sort[field]' ] ).toBeUndefined();
		expect( args[ 'sort[direction]' ] ).toBeUndefined();
	} );

	it.each( unsupportedFields )(
		'does not forward unsupported saved field-%s sort',
		( fieldId ) => {
			const args = buildQueryArgs(
				7,
				{ sort: { field: `field-${ fieldId }`, direction: 'asc' } },
				fieldDefs
			);

			expect( args[ 'sort[field]' ] ).toBeUndefined();
			expect(
				isPublicSortSupported(
					{ field: `field-${ fieldId }`, direction: 'asc' },
					fieldDefs
				)
			).toBe( false );
		}
	);

	it( 'does not forward unresolved custom sort fields', () => {
		const unknownArgs = buildQueryArgs(
			7,
			{ sort: { field: 'field-99', direction: 'asc' } },
			fieldDefs
		);

		expect( unknownArgs[ 'sort[field]' ] ).toBeUndefined();
	} );

	it( 'forwards supported system sort fields', () => {
		const args = buildQueryArgs(
			7,
			{ sort: { field: 'title', direction: 'asc' } },
			fieldDefs
		);

		expect( args[ 'sort[field]' ] ).toBe( 'title' );
		expect( args[ 'sort[direction]' ] ).toBe( 'asc' );
	} );
} );

describe( 'usePublicRows', () => {
	it( 'loads every public rows page with valid REST pagination', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			const page = Number(
				new URL( path, 'https://example.test' ).searchParams.get(
					'page'
				)
			);

			return Promise.resolve( {
				rows: [ { id: page } ],
				fields: page === 1 ? fieldDefs : [],
				total: 2,
				totalPages: 2,
			} );
		} );

		const { result } = renderHook( () =>
			usePublicRows( 7, { filters: [] } )
		);

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( result.current.data.map( ( row ) => row.id ) ).toEqual( [
			1, 2,
		] );
		expect( result.current.fields ).toEqual( fieldDefs );

		expect( requestParams( 0 ).get( 'context' ) ).toBe( 'view' );
		expect( requestParams( 0 ).get( 'page' ) ).toBe( '1' );
		expect( requestParams( 0 ).get( 'per_page' ) ).toBe( '100' );
		expect( requestParams( 1 ).get( 'page' ) ).toBe( '2' );
		expect( requestParams( 1 ).get( 'per_page' ) ).toBe( '100' );
	} );
} );
