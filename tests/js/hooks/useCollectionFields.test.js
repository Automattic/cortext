import { renderHook } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn(),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '../../../src/hooks/fieldMapping', () => ( {
	mapField: ( field ) => ( {
		id: `field-${ field.id }`,
		recordId: field.id,
		label: field.title?.raw ?? String( field.id ),
		cortextType: field.meta?.type ?? 'text',
		editable: true,
	} ),
	systemFields: () => [
		{
			id: 'created_at',
			label: 'Created',
			cortextType: 'datetime',
			editable: false,
		},
	],
} ) );

import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import useCollectionFields from '../../../src/hooks/useCollectionFields';

const collectionRecord = {
	id: 5,
	meta: { fields: [ 10 ], slug: 'projects' },
};
const fieldRecords = [
	{
		id: 10,
		title: { raw: 'Status', rendered: 'Status' },
		meta: { type: 'text' },
	},
];

describe( 'useCollectionFields', () => {
	let collectionState;
	let fieldsState;

	beforeEach( () => {
		collectionState = {
			record: collectionRecord,
			isResolving: false,
			hasResolved: true,
		};
		fieldsState = {
			records: fieldRecords,
			isResolving: false,
			hasResolved: true,
		};
		useEntityRecord.mockImplementation( () => collectionState );
		useEntityRecords.mockImplementation( () => fieldsState );
	} );

	it( 'keeps stable fields visible while the collection record refetches', () => {
		const { result, rerender } = renderHook( () =>
			useCollectionFields( 5 )
		);

		expect( result.current.isResolving ).toBe( false );
		expect( result.current.fields.map( ( field ) => field.id ) ).toEqual( [
			'field-10',
			'created_at',
		] );

		collectionState = {
			record: collectionRecord,
			isResolving: true,
			hasResolved: false,
		};
		rerender();

		expect( result.current.isResolving ).toBe( false );
		expect( result.current.fields.map( ( field ) => field.id ) ).toEqual( [
			'field-10',
			'created_at',
		] );
	} );

	it( 'still reports resolving before the first collection record arrives', () => {
		collectionState = {
			record: null,
			isResolving: true,
			hasResolved: false,
		};
		fieldsState = {
			records: [],
			isResolving: false,
			hasResolved: false,
		};

		const { result } = renderHook( () => useCollectionFields( 5 ) );

		expect( result.current.isResolving ).toBe( true );
	} );
} );
