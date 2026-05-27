import apiFetch from '@wordpress/api-fetch';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';

import {
	createDefaultViewConfig,
	normalizeViewConfig,
} from '../components/collectionViewConfig';

export default function useCollectionViews( collectionId ) {
	const [ state, setState ] = useState( {
		viewConfig: createDefaultViewConfig(),
		isLoading: Boolean( collectionId ),
		hasResolved: false,
		error: null,
		saveError: null,
	} );
	const requestIdRef = useRef( 0 );
	const collectionIdRef = useRef( collectionId );
	const saveQueueRef = useRef( { isSaving: false, pending: null } );

	useEffect( () => {
		collectionIdRef.current = collectionId;
		saveQueueRef.current = { isSaving: false, pending: null };

		if ( ! collectionId ) {
			setState( {
				viewConfig: createDefaultViewConfig(),
				isLoading: false,
				hasResolved: false,
				error: null,
				saveError: null,
			} );
			return undefined;
		}

		const requestId = ++requestIdRef.current;
		setState( ( current ) => ( {
			...current,
			isLoading: true,
			hasResolved: false,
			error: null,
		} ) );

		apiFetch( {
			path: `/cortext/v1/collections/${ collectionId }/views`,
		} )
			.then( ( body ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					viewConfig: normalizeViewConfig( body ),
					isLoading: false,
					hasResolved: true,
					error: null,
					saveError: null,
				} );
			} )
			.catch( ( error ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					viewConfig: createDefaultViewConfig(),
					isLoading: false,
					hasResolved: true,
					error,
					saveError: null,
				} );
			} );

		return undefined;
	}, [ collectionId ] );

	const flushSaveQueue = useCallback( async () => {
		const queue = saveQueueRef.current;
		if ( queue.isSaving || ! collectionId ) {
			return;
		}

		queue.isSaving = true;
		try {
			while ( queue.pending ) {
				const nextViewConfig = queue.pending;
				queue.pending = null;

				try {
					const saved = await apiFetch( {
						path: `/cortext/v1/collections/${ collectionId }/views`,
						method: 'PUT',
						data: nextViewConfig,
					} );
					if (
						! queue.pending &&
						collectionIdRef.current === collectionId
					) {
						const savedViewConfig = normalizeViewConfig( saved );
						setState( ( current ) => ( {
							...current,
							viewConfig: savedViewConfig,
							saveError: null,
						} ) );
					}
				} catch ( error ) {
					if (
						! queue.pending &&
						collectionIdRef.current === collectionId
					) {
						setState( ( current ) => ( {
							...current,
							saveError: error,
						} ) );
					}
				}
			}
		} finally {
			queue.isSaving = false;
		}
	}, [ collectionId ] );

	const saveViewConfig = useCallback(
		async ( nextViewConfig ) => {
			const normalized = normalizeViewConfig( nextViewConfig );
			setState( ( current ) => ( {
				...current,
				viewConfig: normalized,
				saveError: null,
			} ) );

			if ( ! collectionId ) {
				return normalized;
			}

			saveQueueRef.current.pending = normalized;
			void flushSaveQueue();

			return normalized;
		},
		[ collectionId, flushSaveQueue ]
	);

	return { ...state, saveViewConfig };
}
