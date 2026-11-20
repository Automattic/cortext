/**
 * Tests for `src/components/notionImport.js`: the start, tick and finish
 * loop that drives a Notion import.
 */

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import { runImport } from '../../src/components/notionImport';

function job( overrides ) {
	return {
		job_id: 'job-1',
		collection_id: 7,
		processed: 0,
		status: 'running',
		has_more: true,
		message: null,
		...overrides,
	};
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'runImport', () => {
	it( 'rejects with the server message when a tick stops the job', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.endsWith( '/start' ) ) {
				return Promise.resolve( job() );
			}
			if ( path.endsWith( '/tick' ) ) {
				return Promise.resolve(
					job( {
						processed: 50,
						status: 'error',
						has_more: false,
						message:
							'The collection was archived, so the import stopped.',
					} )
				);
			}
			return Promise.resolve( { finished: true } );
		} );
		const onProgress = jest.fn();

		await expect( runImport( 'key', 'ds-1', onProgress ) ).rejects.toThrow(
			'The collection was archived, so the import stopped.'
		);

		expect( onProgress ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch.mock.calls.at( -1 )[ 0 ].path ).toBe(
			'/cortext/v1/notion/import/job-1/finish'
		);
	} );

	it( 'resolves with the final state when the import completes', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			if ( path.endsWith( '/start' ) ) {
				return Promise.resolve( job() );
			}
			if ( path.endsWith( '/tick' ) ) {
				return Promise.resolve(
					job( { processed: 3, status: 'done', has_more: false } )
				);
			}
			return Promise.resolve( { finished: true } );
		} );

		await expect( runImport( 'key', 'ds-1' ) ).resolves.toMatchObject( {
			status: 'done',
			processed: 3,
		} );
	} );
} );
