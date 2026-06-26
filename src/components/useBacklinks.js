import apiFetch from '@wordpress/api-fetch';
import { useEffect, useState } from '@wordpress/element';

function uniqueSources( sources ) {
	const seen = new Set();
	return sources.filter( ( source ) => {
		if ( ! source?.id || seen.has( source.id ) ) {
			return false;
		}
		seen.add( source.id );
		return true;
	} );
}

function sourcesFromResponse( data ) {
	if ( Array.isArray( data?.sources ) ) {
		return uniqueSources( data.sources );
	}
	if ( ! Array.isArray( data?.groups ) ) {
		return [];
	}
	return uniqueSources(
		data.groups.flatMap( ( group ) =>
			Array.isArray( group?.sources ) ? group.sources : []
		)
	);
}

// Fetches the documents that mention `documentId`. Returns the deduped sources
// and their count; callers decide how to surface them (panel, popover, etc.).
export function useBacklinks( documentId ) {
	const [ data, setData ] = useState( null );

	useEffect( () => {
		if ( ! documentId ) {
			setData( null );
			return undefined;
		}

		let cancelled = false;
		apiFetch( {
			path: `/cortext/v1/documents/${ documentId }/backlinks`,
		} )
			.then( ( response ) => {
				if ( ! cancelled ) {
					setData( response );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setData( null );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ documentId ] );

	const sources = sourcesFromResponse( data );
	// A single source can mention the target more than once; the total counts
	// every mention, while the list shows each source once with its own count.
	const total = sources.reduce(
		( sum, source ) => sum + ( Number( source.mentions ) || 1 ),
		0
	);
	return { sources, total };
}
