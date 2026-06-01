import {
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

describe( 'usePublicRows query args', () => {
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
