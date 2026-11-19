jest.mock( '@wordpress/editor', () => ( {
	store: { name: 'core/editor' },
} ) );

import {
	READ_ONLY_ARCHIVED,
	READ_ONLY_TRASHED,
	getReadOnlyState,
	selectCurrentPostReadOnlyState,
} from '../../../src/documents/readOnly';

describe( 'getReadOnlyState', () => {
	it.each( [
		[ 'trash', READ_ONLY_TRASHED ],
		[ 'crtxt_archived', READ_ONLY_ARCHIVED ],
		[ 'publish', null ],
		[ 'private', null ],
		[ 'draft', null ],
	] )( 'returns the state for status %s', ( status, expected ) => {
		expect( getReadOnlyState( { status } ) ).toBe( expected );
	} );

	it( 'treats a missing record as editable', () => {
		expect( getReadOnlyState( undefined ) ).toBeNull();
	} );
} );

describe( 'selectCurrentPostReadOnlyState', () => {
	it( 'reads the status of the post loaded in the editor', () => {
		const getCurrentPostAttribute = jest.fn( () => 'trash' );
		const select = jest.fn( () => ( { getCurrentPostAttribute } ) );

		expect( selectCurrentPostReadOnlyState( select ) ).toBe(
			READ_ONLY_TRASHED
		);
		expect( getCurrentPostAttribute ).toHaveBeenCalledWith( 'status' );
	} );
} );
