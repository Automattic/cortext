import {
	detailFieldsFromEntries,
	detailLayoutMetaFromEntries,
	normalizeDetailLayout,
	reorderVisibleDetailEntries,
} from '../../../src/hooks/detailLayout';

const field = ( id, label = id ) => ( { id, label } );

describe( 'normalizeDetailLayout', () => {
	const fields = [
		field( 'title', 'Title' ),
		field( 'field-10', 'Author' ),
		field( 'field-20', 'Year' ),
		field( 'created_at', 'Created' ),
		field( 'modified_by', 'Modified by' ),
	];

	it( 'defaults to every property field in field order and excludes title', () => {
		const layout = normalizeDetailLayout( fields, null );

		expect( layout.entries ).toEqual( [
			{ field: 'field-10', visible: true },
			{ field: 'field-20', visible: true },
			{ field: 'created_at', visible: true },
			{ field: 'modified_by', visible: true },
		] );
		expect( layout.fields.map( ( item ) => item.id ) ).toEqual( [
			'field-10',
			'field-20',
			'created_at',
			'modified_by',
		] );
	} );

	it( 'uses saved order and hides invisible fields from detailFields', () => {
		const layout = normalizeDetailLayout( fields, {
			fields: [
				{ field: 'created_at', visible: true },
				{ field: 'field-20', visible: false },
			],
		} );

		expect( layout.entries ).toEqual( [
			{ field: 'created_at', visible: true },
			{ field: 'field-20', visible: false },
			{ field: 'field-10', visible: true },
			{ field: 'modified_by', visible: true },
		] );
		expect( layout.allFields.map( ( item ) => item.id ) ).toEqual( [
			'created_at',
			'field-20',
			'field-10',
			'modified_by',
		] );
		expect( layout.allFields[ 1 ].cortextDetailVisible ).toBe( false );
		expect( layout.fields.map( ( item ) => item.id ) ).toEqual( [
			'created_at',
			'field-10',
			'modified_by',
		] );
	} );

	it( 'appends fields missing from a saved layout as visible', () => {
		const layout = normalizeDetailLayout( fields, {
			fields: [ { field: 'field-20', visible: false } ],
		} );

		expect( layout.entries ).toEqual( [
			{ field: 'field-20', visible: false },
			{ field: 'field-10', visible: true },
			{ field: 'created_at', visible: true },
			{ field: 'modified_by', visible: true },
		] );
	} );

	it( 'drops stale, duplicate, malformed, and title entries', () => {
		const layout = normalizeDetailLayout( fields, {
			fields: [
				{ field: 'field-999', visible: false },
				{ field: 'field-10', visible: false },
				{ field: 'field-10', visible: true },
				{ field: 'title', visible: true },
				{ visible: true },
				null,
			],
		} );

		expect( layout.entries ).toEqual( [
			{ field: 'field-10', visible: false },
			{ field: 'field-20', visible: true },
			{ field: 'created_at', visible: true },
			{ field: 'modified_by', visible: true },
		] );
	} );
} );

describe( 'detailLayoutMetaFromEntries', () => {
	it( 'serializes the native detail_layout meta shape', () => {
		expect(
			detailLayoutMetaFromEntries( [
				{ field: 'field-10', visible: false },
				{ field: 'field-10', visible: true },
				{ field: 'created_at' },
				{ field: '' },
				null,
			] )
		).toEqual( {
			fields: [
				{ field: 'field-10', visible: false },
				{ field: 'created_at', visible: true },
			],
		} );
	} );
} );

describe( 'detailFieldsFromEntries', () => {
	it( 'returns visible fields in entry order and excludes title', () => {
		expect(
			detailFieldsFromEntries(
				[
					field( 'title', 'Title' ),
					field( 'field-10', 'Author' ),
					field( 'created_at', 'Created' ),
					field( 'field-20', 'Year' ),
				],
				[
					{ field: 'created_at', visible: true },
					{ field: 'title', visible: true },
					{ field: 'field-20', visible: false },
					{ field: 'field-10', visible: true },
				]
			).map( ( item ) => item.id )
		).toEqual( [ 'created_at', 'field-10' ] );
	} );
} );

describe( 'reorderVisibleDetailEntries', () => {
	it( 'reorders visible entries while hidden entries keep their slots', () => {
		expect(
			reorderVisibleDetailEntries(
				[
					{ field: 'field-10', visible: true },
					{ field: 'field-20', visible: false },
					{ field: 'created_at', visible: true },
				],
				'created_at',
				'field-10'
			)
		).toEqual( [
			{ field: 'created_at', visible: true },
			{ field: 'field-20', visible: false },
			{ field: 'field-10', visible: true },
		] );
	} );
} );
