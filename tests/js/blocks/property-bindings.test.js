import { registerBlockBindingsSource } from '@wordpress/blocks';

import {
	PROPERTY_BINDINGS_SOURCE,
	propertyBindingsSource,
} from '../../../src/blocks/property-bindings';

jest.mock( '@wordpress/blocks', () => ( {
	...jest.requireActual( '@wordpress/blocks' ),
	registerBlockBindingsSource: jest.fn(),
} ) );

const ROW_ID = 7;
const COLLECTION_ID = 3;
const TERM_ID = 30;

const fieldRecords = [
	{ id: 11, title: { raw: 'Website' }, meta: { type: 'url' } },
	{
		id: 12,
		title: { raw: 'Pages' },
		meta: { type: 'number', number_format: '{"style":"comma"}' },
	},
];

function makeSelect( row ) {
	const store = {
		getEditedEntityRecord: ( kind, name, id ) =>
			id === ROW_ID ? row : undefined,
		getEntityRecord: ( kind, name, id ) => {
			if ( kind === 'taxonomy' && id === TERM_ID ) {
				return { id: TERM_ID, slug: String( COLLECTION_ID ) };
			}
			if ( kind === 'postType' && id === COLLECTION_ID ) {
				return {
					id: COLLECTION_ID,
					meta: { cortext_fields: [ 11, 12 ] },
				};
			}
			return undefined;
		},
		getEntityRecords: () => fieldRecords,
	};
	return () => store;
}

const context = { postId: ROW_ID, postType: 'crtxt_document' };

describe( 'cortext/property bindings source', () => {
	const row = {
		id: ROW_ID,
		crtxt_trait: [ TERM_ID ],
		meta: { 'field-11': 'https://example.com', 'field-12': 1200 },
		created_by: 'Ada',
	};

	it( 'registers itself', () => {
		expect( registerBlockBindingsSource ).toHaveBeenCalledWith(
			propertyBindingsSource
		);
		expect( propertyBindingsSource.name ).toBe( PROPERTY_BINDINGS_SOURCE );
	} );

	it( 'returns formatted text, and the stored value for link attributes', () => {
		const values = propertyBindingsSource.getValues( {
			select: makeSelect( row ),
			context,
			bindings: {
				content: { args: { key: '12' } },
				url: { args: { key: '11' } },
				text: { args: { key: 'created_by' } },
			},
		} );

		expect( values ).toEqual( {
			content: '1,200',
			url: 'https://example.com',
			text: 'Ada',
		} );
	} );

	it( 'leaves unknown properties empty', () => {
		const values = propertyBindingsSource.getValues( {
			select: makeSelect( row ),
			context,
			bindings: { content: { args: { key: '99' } } },
		} );

		expect( values ).toEqual( { content: '' } );
	} );

	it( 'lists the row properties, then the system fields', () => {
		const fields = propertyBindingsSource.getFieldsList( {
			select: makeSelect( row ),
			context,
		} );

		expect( fields.map( ( field ) => field.args.key ) ).toEqual( [
			'11',
			'12',
			'created_at',
			'created_by',
			'modified_at',
			'modified_by',
		] );
		expect( fields[ 0 ] ).toEqual( {
			label: 'Website',
			type: 'string',
			args: { key: '11' },
		} );
	} );

	it( 'lists nothing for pages', () => {
		expect(
			propertyBindingsSource.getFieldsList( {
				select: makeSelect( { id: ROW_ID, crtxt_trait: [] } ),
				context,
			} )
		).toEqual( [] );
	} );

	it( 'never lets a bound block edit the property', () => {
		expect( propertyBindingsSource.canUserEditValue() ).toBe( false );
	} );
} );
