import { useEffect } from '@wordpress/element';

// tech-debt.md#2: rows live outside core-data, so row mutations need a
// lightweight cross-surface invalidation signal until the entity store owns
// row caching and dependency refresh.
export const COLLECTION_ROWS_CHANGED_EVENT = 'cortext:collection-rows-changed';

function normalizeCollectionId( collectionId ) {
	const number = Number( collectionId );
	return Number.isFinite( number ) && number > 0 ? number : null;
}

export function notifyCollectionRowsChanged( collectionId = null ) {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent( COLLECTION_ROWS_CHANGED_EVENT, {
			detail: {
				collectionId: normalizeCollectionId( collectionId ),
			},
		} )
	);
}

export function useCollectionRowsInvalidation( collectionId, onInvalidate ) {
	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}

		const targetCollectionId = normalizeCollectionId( collectionId );
		const onRowsChanged = ( event ) => {
			const changedCollectionId = normalizeCollectionId(
				event?.detail?.collectionId
			);
			if (
				targetCollectionId === null ||
				changedCollectionId === null ||
				changedCollectionId === targetCollectionId
			) {
				onInvalidate?.();
			}
		};

		window.addEventListener( COLLECTION_ROWS_CHANGED_EVENT, onRowsChanged );
		return () =>
			window.removeEventListener(
				COLLECTION_ROWS_CHANGED_EVENT,
				onRowsChanged
			);
	}, [ collectionId, onInvalidate ] );
}
