jest.mock( '@wordpress/editor', () => ( {
	store: { name: 'core/editor' },
} ) );
jest.mock( '@wordpress/core-data', () => ( {
	store: { name: 'core' },
} ) );

import {
	READ_ONLY_ARCHIVED,
	READ_ONLY_FROZEN,
	READ_ONLY_TRASHED,
	getReadOnlyState,
} from '../../../src/documents/readOnly';
import { selectCurrentPostReadOnlyState } from '../../../src/documents/readOnlyStore';

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

	it( 'reports a frozen document as locked', () => {
		expect(
			getReadOnlyState( {
				status: 'publish',
				cortext_frozen: { frozen_at: '2026-11-19T10:00:00+00:00' },
			} )
		).toBe( READ_ONLY_FROZEN );
	} );

	it( 'puts Trash and Archive ahead of the lock', () => {
		const frozen = { frozen_at: '2026-11-19T10:00:00+00:00' };
		expect(
			getReadOnlyState( { status: 'trash', cortext_frozen: frozen } )
		).toBe( READ_ONLY_TRASHED );
		expect(
			getReadOnlyState( {
				status: 'crtxt_archived',
				cortext_frozen: frozen,
			} )
		).toBe( READ_ONLY_ARCHIVED );
	} );

	it( 'treats a missing record as editable', () => {
		expect( getReadOnlyState( undefined ) ).toBeNull();
	} );
} );

describe( 'selectCurrentPostReadOnlyState', () => {
	it( 'reads the status of the post loaded in the editor', () => {
		const getCurrentPostAttribute = jest.fn( ( name ) =>
			name === 'status' ? 'trash' : null
		);
		const select = jest.fn( () => ( { getCurrentPostAttribute } ) );

		expect( selectCurrentPostReadOnlyState( select ) ).toBe(
			READ_ONLY_TRASHED
		);
		expect( getCurrentPostAttribute ).toHaveBeenCalledWith( 'status' );
	} );
} );
