import { useCallback, useState } from '@wordpress/element';
import { select, useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';

import { elementsFromOptions } from './optionElements';

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
		async ( { title, type, options, ...extra } ) => {
			setIsBusy( true );
			setError( null );
			try {
				const data = { title, type, ...extra };
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

// Rewrites a select/multiselect field's option list and, when migrations
// are supplied, applies them to row values in one server-side
// transaction. The hook intentionally stays write-only: pushing a fresh
// field record into core-data changes DataViews' `fields` prop and tears
// down active cell editors. Callers that need live repainting keep local
// option overrides until the editor closes and `useFlushFieldRecord`
// catches the entity store up.
export function useUpdateFieldOptions() {
	const { isBusy, setIsBusy, error, setError } = useMutationState();
	const run = useCallback(
		async ( recordId, options, migrations ) => {
			setIsBusy( true );
			setError( null );
			try {
				const data = { options };
				if ( Array.isArray( migrations ) && migrations.length > 0 ) {
					data.migrations = migrations;
				}
				const result = await apiFetch( {
					path: `/cortext/v1/fields/${ recordId }/options`,
					method: 'POST',
					data,
				} );
				return result;
			} catch ( apiError ) {
				setError( apiError );
				throw apiError;
			} finally {
				setIsBusy( false );
			}
		},
		[ setIsBusy, setError ]
	);
	return { run, isBusy, error };
}

// Refetches a single `crtxt_field` record and pushes it into the
// entity store, replacing whatever is there. Called by the option
// popover hosts when they unmount, so the row cells (which read
// through `useEntityRecords`) catch up with whatever the user changed
// while the popover was open. Kept separate from `useUpdateFieldOptions`
// so saves stay write-only and free of cascading re-renders.
export function useFlushFieldRecord() {
	const { receiveEntityRecords } = useDispatch( 'core' );
	return useCallback(
		async ( recordId ) => {
			if ( ! recordId ) {
				return;
			}
			try {
				const fresh = await apiFetch( {
					path: `/wp/v2/crtxt_fields/${ recordId }?context=edit`,
				} );
				receiveEntityRecords(
					'postType',
					'crtxt_field',
					[ fresh ],
					undefined,
					true
				);
			} catch {
				// Best-effort: if the refetch fails, the cell stays on
				// its previous chip set until the next read triggers a
				// natural refetch.
			}
		},
		[ receiveEntityRecords ]
	);
}

// Appends a new option to a field's existing list and saves. Used by the
// cell editors so users can create a chip on the fly while picking a
// value, matching the "Create [foo]" suggestion. Reads the
// freshest options from the entity store at call time (rather than
// subscribing through `useEntityRecord`) and generates a unique slug-style
// `value` from the label, deduping against existing option values.
export function useCreateFieldOption( recordId ) {
	const update = useUpdateFieldOptions();

	const run = useCallback(
		async ( label ) => {
			const trimmed = String( label ?? '' ).trim();
			if ( ! trimmed || ! recordId ) {
				return null;
			}
			const record = select( 'core' ).getEntityRecord(
				'postType',
				'crtxt_field',
				recordId
			);
			if ( ! record ) {
				// Field hasn't been resolved into the entity store yet.
				// Refusing to write avoids clobbering the existing
				// options with an empty list; the caller surfaces this
				// as a no-op (the new chip simply doesn't appear).
				return null;
			}
			const current = elementsFromOptions( record?.meta?.options ) || [];
			const taken = current.map( ( o ) => o.value );
			const value = uniqueSlug( trimmed, taken );
			const next = [ ...current, { value, label: trimmed } ];
			await update.run( recordId, next );
			return { value, label: trimmed };
		},
		[ recordId, update ]
	);

	return { run, isBusy: update.isBusy, error: update.error };
}

function uniqueSlug( label, taken ) {
	const base =
		String( label )
			.toLowerCase()
			.trim()
			.replace( /[^\p{L}\p{N}]+/gu, '-' )
			.replace( /^-+|-+$/g, '' ) || 'option';
	if ( ! taken.includes( base ) ) {
		return base;
	}
	let n = 2;
	while ( taken.includes( `${ base }-${ n }` ) ) {
		n++;
	}
	return `${ base }-${ n }`;
}

export function useOptionUsage() {
	const run = useCallback( async ( recordId, value ) => {
		const result = await apiFetch( {
			path: `/cortext/v1/fields/${ recordId }/options/${ encodeURIComponent(
				value
			) }/usage`,
		} );
		return Number( result?.count ?? 0 );
	}, [] );
	return { run };
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
