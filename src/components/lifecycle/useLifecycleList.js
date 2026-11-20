import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';

import computeCascadeRoots from '../computeCascadeRoots';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../../hooks/useDelayedFlag';

export const EMPTY_COUNTS = Object.freeze( { total: 0 } );

export function optionalTitleText( title ) {
	if ( typeof title === 'string' && title.trim() ) {
		return title.trim();
	}
	return title?.rendered?.trim() || title?.raw?.trim() || '';
}

export function buildBreadcrumb( record, ancestorById ) {
	const ancestors = [];
	let current = record.parent ? ancestorById.get( record.parent ) : null;
	const seen = new Set( [ record.id ] );
	while ( current && ! seen.has( current.id ) ) {
		seen.add( current.id );
		const title = optionalTitleText( current.title );
		if ( title ) {
			ancestors.unshift( {
				id: current.id,
				title,
				icon: current.meta?.cortext_document_icon ?? '',
			} );
		}
		current = current.parent ? ancestorById.get( current.parent ) : null;
	}
	return ancestors;
}

/**
 * List state of a lifecycle view: the last good result, the cascade roots, and
 * the busy and error state of the item being acted on.
 *
 * @param {Object}   documentsState Lifecycle document query state.
 * @param {Array}    activePages    Active page records for breadcrumb lookup.
 * @param {string[]} markerKeys     Cascade marker meta keys. Pass a stable
 *                                  reference.
 */
export default function useLifecycleList(
	documentsState,
	activePages,
	markerKeys
) {
	const {
		documents,
		isLoading: isResolving,
		error,
		hasResolved,
	} = documentsState;
	const [ rowError, setRowError ] = useState( null );
	const [ busyId, setBusyId ] = useState( null );
	const [ cachedDocuments, setCachedDocuments ] = useState( [] );
	const [ hasCache, setHasCache ] = useState( false );

	useEffect( () => {
		if ( ! error && hasResolved && Array.isArray( documents ) ) {
			setCachedDocuments( documents );
			setHasCache( true );
		}
	}, [ documents, error, hasResolved ] );

	const visibleDocuments =
		hasResolved && Array.isArray( documents ) ? documents : cachedDocuments;

	const ancestorById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		// Prefer active records for pages that somehow appear in both lists.
		// Their title is fresher than the lifecycle snapshot.
		visibleDocuments.forEach( ( document ) => {
			if ( ! map.has( document.id ) ) {
				map.set( document.id, document );
			}
		} );
		return map;
	}, [ activePages, visibleDocuments ] );

	// Roots are documents with no marker, plus documents whose marker points
	// at a parent that's no longer in this list.
	const { roots, descendantCountById, descendantsById } = useMemo(
		() => computeCascadeRoots( visibleDocuments, markerKeys ),
		[ markerKeys, visibleDocuments ]
	);

	const runRowAction = useCallback(
		async ( record, action, fallbackMessage ) => {
			setRowError( null );
			setBusyId( record.id );
			try {
				await action();
			} catch ( nextError ) {
				setRowError( {
					id: record.id,
					message: nextError?.message ?? fallbackMessage,
				} );
			} finally {
				setBusyId( null );
			}
		},
		[]
	);

	const isLoading = isResolving && ! hasCache;
	const showSkeleton = useDelayedFlag(
		isLoading,
		120,
		SKELETON_MIN_VISIBLE_MS
	);

	return {
		ancestorById,
		busyId,
		descendantCountById,
		descendantsById,
		hasError: Boolean( error && ! hasCache ),
		isLoading,
		roots,
		rowError,
		runRowAction,
		showSkeleton,
	};
}
