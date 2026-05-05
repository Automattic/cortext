/**
 * Tests for `src/hooks/useFieldMutations.js`. Mocks `@wordpress/api-fetch`
 * and the `core` data store so each test asserts the dispatched action
 * shape and the cache-invalidation calls without going to a real REST
 * endpoint.
 */

import { act, renderHook } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockDispatch = {
	invalidateResolution: jest.fn(),
	saveEntityRecord: jest.fn(),
	deleteEntityRecord: jest.fn(),
	receiveEntityRecords: jest.fn(),
};

const mockSelectGetEntityRecord = jest.fn().mockReturnValue( null );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn( () => mockDispatch ),
	select: jest.fn( () => ( {
		getEntityRecord: mockSelectGetEntityRecord,
	} ) ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	useCreateField,
	useDuplicateField,
	useRenameField,
	useDeleteField,
	useUpdateFieldOptions,
	useOptionUsage,
	useCreateFieldOption,
	useFlushFieldRecord,
} from '../../../src/hooks/useFieldMutations';

beforeEach( () => {
	jest.clearAllMocks();
} );

describe( 'useCreateField', () => {
	it( 'POSTs to the atomic create-and-attach route and invalidates resolvers', async () => {
		apiFetch.mockResolvedValueOnce( {
			id: 99,
			title: 'Status',
			type: 'text',
		} );

		const { result } = renderHook( () => useCreateField( 5 ) );
		let returned;
		await act( async () => {
			returned = await result.current.run( {
				title: 'Status',
				type: 'text',
			} );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/5/fields',
			method: 'POST',
			data: { title: 'Status', type: 'text' },
		} );
		expect( returned ).toEqual( {
			id: 99,
			title: 'Status',
			type: 'text',
		} );
		expect( mockDispatch.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_collection', 5 ]
		);
	} );

	it( 'forwards options on the request body when present', async () => {
		apiFetch.mockResolvedValueOnce( { id: 100 } );
		const { result } = renderHook( () => useCreateField( 5 ) );
		await act( async () => {
			await result.current.run( {
				title: 'Priority',
				type: 'select',
				options: [ { value: 'high', label: 'High' } ],
			} );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/5/fields',
			method: 'POST',
			data: {
				title: 'Priority',
				type: 'select',
				options: [ { value: 'high', label: 'High' } ],
			},
		} );
	} );

	it( 'forwards relation and rollup config fields on the request body', async () => {
		apiFetch.mockResolvedValueOnce( { id: 101 } );
		const { result } = renderHook( () => useCreateField( 5 ) );
		await act( async () => {
			await result.current.run( {
				title: 'Invoices',
				type: 'relation',
				related_collection_id: 9,
				relation_multiple: true,
				reverse_title: 'Projects',
				reverse_multiple: false,
			} );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/5/fields',
			method: 'POST',
			data: {
				title: 'Invoices',
				type: 'relation',
				related_collection_id: 9,
				relation_multiple: true,
				reverse_title: 'Projects',
				reverse_multiple: false,
			},
		} );

		apiFetch.mockResolvedValueOnce( { id: 102 } );
		await act( async () => {
			await result.current.run( {
				title: 'Total',
				type: 'rollup',
				rollup_relation_field_id: 77,
				rollup_target_field_id: 88,
				rollup_aggregator: 'sum',
			} );
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/cortext/v1/collections/5/fields',
			method: 'POST',
			data: {
				title: 'Total',
				type: 'rollup',
				rollup_relation_field_id: 77,
				rollup_target_field_id: 88,
				rollup_aggregator: 'sum',
			},
		} );
	} );

	it( 'surfaces errors via `error` and rethrows', async () => {
		const apiError = new Error( 'boom' );
		apiFetch.mockRejectedValueOnce( apiError );

		const { result } = renderHook( () => useCreateField( 5 ) );
		await act( async () => {
			await expect(
				result.current.run( { title: 'X', type: 'text' } )
			).rejects.toThrow( 'boom' );
		} );

		expect( result.current.error ).toBe( apiError );
		expect( mockDispatch.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useDuplicateField', () => {
	it( 'POSTs to the atomic duplicate route and invalidates resolvers', async () => {
		apiFetch.mockResolvedValueOnce( { id: 50 } );
		const { result } = renderHook( () => useDuplicateField( 7 ) );
		await act( async () => {
			await result.current.run( 42 );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/collections/7/fields/42/duplicate',
			method: 'POST',
		} );
		expect( mockDispatch.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_collection', 7 ]
		);
	} );
} );

describe( 'useRenameField', () => {
	it( 'dispatches saveEntityRecord with the new title', async () => {
		mockDispatch.saveEntityRecord.mockResolvedValueOnce( {
			id: 42,
			title: { raw: 'Renamed', rendered: 'Renamed' },
		} );

		const { result } = renderHook( () => useRenameField() );
		await act( async () => {
			await result.current.run( 42, 'Renamed' );
		} );

		expect( mockDispatch.saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_field',
			{ id: 42, title: 'Renamed' }
		);
	} );

	it( 'surfaces a rename failure when saveEntityRecord returns falsy', async () => {
		mockDispatch.saveEntityRecord.mockResolvedValueOnce( undefined );

		const { result } = renderHook( () => useRenameField() );
		await act( async () => {
			await expect( result.current.run( 42, 'X' ) ).rejects.toThrow(
				'cortext_rename_failed'
			);
		} );

		expect( result.current.error ).toEqual(
			new Error( 'cortext_rename_failed' )
		);
	} );
} );

describe( 'useDeleteField', () => {
	it( 'dispatches deleteEntityRecord with force: true and invalidates the collection', async () => {
		mockDispatch.deleteEntityRecord.mockResolvedValueOnce( {
			previous: { id: 42 },
		} );

		const { result } = renderHook( () => useDeleteField( 5 ) );
		await act( async () => {
			await result.current.run( 42 );
		} );

		expect( mockDispatch.deleteEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_field',
			42,
			{ force: true }
		);
		expect( mockDispatch.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_collection', 5 ]
		);
	} );

	it( 'surfaces a delete failure when deleteEntityRecord returns falsy', async () => {
		mockDispatch.deleteEntityRecord.mockResolvedValueOnce( undefined );

		const { result } = renderHook( () => useDeleteField( 5 ) );
		await act( async () => {
			await expect( result.current.run( 42 ) ).rejects.toThrow(
				'cortext_delete_failed'
			);
		} );

		expect( result.current.error ).toEqual(
			new Error( 'cortext_delete_failed' )
		);
		expect( mockDispatch.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useUpdateFieldOptions', () => {
	it( 'POSTs the new option list and does not push into the store', async () => {
		// `useUpdateFieldOptions` stays write-only; callers that need live
		// repainting use local option overrides while the popover is open.
		// Pushing into core-data here changes DataViews' `fields` prop and
		// tears down active cell editors.
		const options = [
			{ value: 'a', label: 'A', color: 'blue' },
			{ value: 'b', label: 'B' },
		];
		apiFetch.mockResolvedValueOnce( { id: 42, options } );

		const { result } = renderHook( () => useUpdateFieldOptions() );
		await act( async () => {
			await result.current.run( 42, options );
		} );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/fields/42/options',
			method: 'POST',
			data: { options },
		} );
		expect( mockDispatch.receiveEntityRecords ).not.toHaveBeenCalled();
	} );

	it( 'forwards migrations on the request body when provided', async () => {
		apiFetch.mockResolvedValueOnce( { id: 42 } );
		const migrations = [ { from: 'b', action: 'clear' } ];

		const { result } = renderHook( () => useUpdateFieldOptions() );
		await act( async () => {
			await result.current.run(
				42,
				[ { value: 'a', label: 'A' } ],
				migrations
			);
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/fields/42/options',
			method: 'POST',
			data: {
				options: [ { value: 'a', label: 'A' } ],
				migrations,
			},
		} );
	} );

	it( 'omits migrations key when the array is empty', async () => {
		apiFetch.mockResolvedValueOnce( { id: 42 } );

		const { result } = renderHook( () => useUpdateFieldOptions() );
		await act( async () => {
			await result.current.run( 42, [], [] );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/fields/42/options',
			method: 'POST',
			data: { options: [] },
		} );
	} );

	it( 'surfaces errors via `error` and skips invalidation', async () => {
		const apiError = new Error( 'nope' );
		apiFetch.mockRejectedValueOnce( apiError );

		const { result } = renderHook( () => useUpdateFieldOptions() );
		await act( async () => {
			await expect(
				result.current.run( 42, [ { value: 'a', label: 'A' } ] )
			).rejects.toThrow( 'nope' );
		} );

		expect( result.current.error ).toBe( apiError );
		expect( mockDispatch.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useCreateFieldOption', () => {
	beforeEach( () => {
		mockSelectGetEntityRecord.mockReset();
	} );

	it( 'appends a unique option and POSTs the merged list', async () => {
		mockSelectGetEntityRecord.mockReturnValue( {
			meta: {
				options: JSON.stringify( [
					{ value: 'todo', label: 'To do' },
				] ),
			},
		} );
		apiFetch.mockResolvedValueOnce( { id: 42 } );

		const { result } = renderHook( () => useCreateFieldOption( 42 ) );
		let created;
		await act( async () => {
			created = await result.current.run( 'In progress' );
		} );

		expect( created ).toEqual( {
			value: 'in-progress',
			label: 'In progress',
		} );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/fields/42/options',
			method: 'POST',
			data: {
				options: [
					{ value: 'todo', label: 'To do' },
					{ value: 'in-progress', label: 'In progress' },
				],
			},
		} );
	} );

	it( 'dedupes the slug when the base value is already taken', async () => {
		mockSelectGetEntityRecord.mockReturnValue( {
			meta: {
				options: JSON.stringify( [
					{ value: 'in-progress', label: 'In progress' },
					{ value: 'in-progress-2', label: 'Other in progress' },
				] ),
			},
		} );
		apiFetch.mockResolvedValueOnce( { id: 42 } );

		const { result } = renderHook( () => useCreateFieldOption( 42 ) );
		let created;
		await act( async () => {
			created = await result.current.run( 'In progress' );
		} );

		expect( created.value ).toBe( 'in-progress-3' );
	} );

	it( 'refuses to write when the field record is not in the store', async () => {
		mockSelectGetEntityRecord.mockReturnValue( null );
		const { result } = renderHook( () => useCreateFieldOption( 42 ) );
		let created;
		await act( async () => {
			created = await result.current.run( 'New' );
		} );
		expect( created ).toBeNull();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'is a no-op for empty labels', async () => {
		const { result } = renderHook( () => useCreateFieldOption( 42 ) );
		let created;
		await act( async () => {
			created = await result.current.run( '   ' );
		} );
		expect( created ).toBeNull();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );
} );

describe( 'useFlushFieldRecord', () => {
	it( 'refetches the field record and pushes it into the entity store', async () => {
		const fresh = { id: 42, meta: { options: '[]' } };
		apiFetch.mockResolvedValueOnce( fresh );

		const { result } = renderHook( () => useFlushFieldRecord() );
		await act( async () => {
			await result.current( 42 );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/wp/v2/crtxt_fields/42?context=edit',
		} );
		expect( mockDispatch.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			'crtxt_field',
			[ fresh ],
			undefined,
			true
		);
	} );

	it( 'is a no-op when no record id is supplied', async () => {
		const { result } = renderHook( () => useFlushFieldRecord() );
		await act( async () => {
			await result.current( null );
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
		expect( mockDispatch.receiveEntityRecords ).not.toHaveBeenCalled();
	} );

	it( 'swallows refetch errors so a failed flush never throws', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'nope' ) );
		const { result } = renderHook( () => useFlushFieldRecord() );
		await act( async () => {
			await result.current( 42 );
		} );
		expect( mockDispatch.receiveEntityRecords ).not.toHaveBeenCalled();
	} );
} );

describe( 'useOptionUsage', () => {
	it( 'GETs the per-value usage endpoint with the value URL-encoded', async () => {
		apiFetch.mockResolvedValueOnce( { count: 3 } );

		const { result } = renderHook( () => useOptionUsage() );
		let count;
		await act( async () => {
			count = await result.current.run( 42, 'has spaces & ampersand' );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: `/cortext/v1/fields/42/options/${ encodeURIComponent(
				'has spaces & ampersand'
			) }/usage`,
		} );
		expect( count ).toBe( 3 );
	} );

	it( 'normalizes a missing count to zero', async () => {
		apiFetch.mockResolvedValueOnce( {} );
		const { result } = renderHook( () => useOptionUsage() );
		let count;
		await act( async () => {
			count = await result.current.run( 42, 'x' );
		} );
		expect( count ).toBe( 0 );
	} );
} );
