import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from '@wordpress/element';

/**
 * Fetches the pages whose blocks reference this collection. Re-fetches on
 * every enable transition; no caching. Cancels in-flight requests when the
 * caller disables or the collection changes so a stale response can't
 * overwrite a fresh one.
 *
 * @param {?number} collectionId    The collection to look up.
 * @param {Object}  options
 * @param {boolean} options.enabled Whether to issue the request.
 * @return {{ isLoading: boolean, dependentPages: ?Array, error: ?Error }} Fetch state.
 */
export default function useCollectionDependentPages(
	collectionId,
	{ enabled }
) {
	const [ state, setState ] = useState( {
		isLoading: false,
		dependentPages: null,
		error: null,
	} );

	useEffect( () => {
		if ( ! enabled || ! collectionId ) {
			setState( {
				isLoading: false,
				dependentPages: null,
				error: null,
			} );
			return undefined;
		}

		let cancelled = false;
		setState( {
			isLoading: true,
			dependentPages: null,
			error: null,
		} );

		apiFetch( {
			path: `/cortext/v1/documents/${ collectionId }/dependent-pages`,
		} )
			.then( ( dependentPages ) => {
				if ( cancelled ) {
					return;
				}
				setState( {
					isLoading: false,
					dependentPages,
					error: null,
				} );
			} )
			.catch( ( error ) => {
				if ( cancelled ) {
					return;
				}
				setState( {
					isLoading: false,
					dependentPages: null,
					error,
				} );
			} );

		return () => {
			cancelled = true;
		};
	}, [ collectionId, enabled ] );

	return state;
}
