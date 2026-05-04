import { useCallback, useState } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';

// Field mutation hooks. Each hook returns `{ run, isBusy, error }`. UI
// callers always pass numeric record IDs; conversion from DataViews row
// keys (`field-<id>`) lives in `fieldIds.js` to keep ID handling honest.
//
// Create and duplicate go through atomic Cortext routes so the field post
// and its attachment to the collection succeed or fail together. Rename
// uses core-data's `saveEntityRecord` so the cached `useEntityRecords`
// resolver in `useCollectionFields` re-renders without manual list
// invalidation. Delete uses `deleteEntityRecord`; the server-side
// `before_delete_post` hook in `CollectionEntries` handles entry-meta
// cleanup, and the collection record is invalidated so its `meta.fields`
// refreshes.

function useMutationState() {
	const [ isBusy, setIsBusy ] = useState( false );
	const [ error, setError ] = useState( null );
	return { isBusy, setIsBusy, error, setError };
}

function useFieldListInvalidation() {
	const { invalidateResolution } = useDispatch( 'core' );
	return useCallback(
		( collectionId ) => {
			// Invalidate the collection record only. After it refetches,
			// `meta.fields` carries the new ID and `useCollectionFields`
			// passes a different `include` to `useEntityRecords`. That
			// new query is uncached, so the field list refetches without
			// us touching the (impossible-to-target) old resolver.
			invalidateResolution( 'getEntityRecord', [
				'postType',
				'crtxt_collection',
				collectionId,
			] );
		},
		[ invalidateResolution ]
	);
}

export function useCreateField( collectionId ) {
	const { isBusy, setIsBusy, error, setError } = useMutationState();
	const invalidate = useFieldListInvalidation();
	const run = useCallback(
		async ( { title, type, options } ) => {
			setIsBusy( true );
			setError( null );
			try {
				const data = { title, type };
				if ( options !== undefined ) {
					data.options = options;
				}
				const result = await apiFetch( {
					path: `/cortext/v1/collections/${ collectionId }/fields`,
					method: 'POST',
					data,
				} );
				invalidate( collectionId );
				return result;
			} catch ( apiError ) {
				setError( apiError );
				throw apiError;
			} finally {
				setIsBusy( false );
			}
		},
		[ collectionId, invalidate, setIsBusy, setError ]
	);
	return { run, isBusy, error };
}

export function useDuplicateField( collectionId ) {
	const { isBusy, setIsBusy, error, setError } = useMutationState();
	const invalidate = useFieldListInvalidation();
	const run = useCallback(
		async ( sourceRecordId ) => {
			setIsBusy( true );
			setError( null );
			try {
				const result = await apiFetch( {
					path: `/cortext/v1/collections/${ collectionId }/fields/${ sourceRecordId }/duplicate`,
					method: 'POST',
				} );
				invalidate( collectionId );
				return result;
			} catch ( apiError ) {
				setError( apiError );
				throw apiError;
			} finally {
				setIsBusy( false );
			}
		},
		[ collectionId, invalidate, setIsBusy, setError ]
	);
	return { run, isBusy, error };
}

export function useRenameField() {
	const { saveEntityRecord } = useDispatch( 'core' );
	const { isBusy, setIsBusy, error, setError } = useMutationState();
	const run = useCallback(
		async ( recordId, title ) => {
			setIsBusy( true );
			setError( null );
			try {
				const saved = await saveEntityRecord(
					'postType',
					'crtxt_field',
					{ id: recordId, title }
				);
				if ( ! saved ) {
					throw new Error( 'cortext_rename_failed' );
				}
				return saved;
			} catch ( apiError ) {
				setError( apiError );
				throw apiError;
			} finally {
				setIsBusy( false );
			}
		},
		[ saveEntityRecord, setIsBusy, setError ]
	);
	return { run, isBusy, error };
}

export function useDeleteField( collectionId ) {
	const { deleteEntityRecord, invalidateResolution } = useDispatch( 'core' );
	const { isBusy, setIsBusy, error, setError } = useMutationState();
	const run = useCallback(
		async ( recordId ) => {
			setIsBusy( true );
			setError( null );
			try {
				const result = await deleteEntityRecord(
					'postType',
					'crtxt_field',
					recordId,
					{ force: true }
				);
				if ( ! result ) {
					throw new Error( 'cortext_delete_failed' );
				}
				// The server `before_delete_post` hook removed the field's
				// string ID from the collection's `meta.fields`; refetch the
				// collection so the local view reflects that.
				invalidateResolution( 'getEntityRecord', [
					'postType',
					'crtxt_collection',
					collectionId,
				] );
				return result;
			} catch ( apiError ) {
				setError( apiError );
				throw apiError;
			} finally {
				setIsBusy( false );
			}
		},
		[
			collectionId,
			deleteEntityRecord,
			invalidateResolution,
			setIsBusy,
			setError,
		]
	);
	return { run, isBusy, error };
}
