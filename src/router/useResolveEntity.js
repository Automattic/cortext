import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

// Resolves a URI like "about-us-42" or "42" to a page entity by extracting the
// trailing numeric id and fetching that record directly. The slug prefix is
// cosmetic: it keeps the URL human-readable without being authoritative, so
// renaming a page can never break an existing link, and blank drafts (which
// have no slug yet) remain addressable via their id alone.
const POST_TYPE = 'crtxt_page';

// Pulls the trailing `<digits>` — optionally preceded by `-` — out of a URI.
// Matches both `foo-42` and bare `42`. Returns null for anything else so
// callers can treat a missing id as "route to empty state, not 404".
export function parseIdFromUri( uri ) {
	const match = ( uri ?? '' ).match( /(?:^|-)(\d+)$/ );
	return match ? parseInt( match[ 1 ], 10 ) : null;
}

export function useResolveEntity( uri ) {
	const id = parseIdFromUri( uri );
	const [ state, setState ] = useState( {
		entity: null,
		isResolving: true,
		notFound: false,
	} );

	// Keyed on `id` rather than `uri` so that canonicalization rewrites
	// (`/42` → `/about-us-42` for the same record) don't re-fetch and briefly
	// flip state to `{ entity: null, isResolving: true }`, which would unmount
	// the editor mid-typing.
	useEffect( () => {
		if ( ! id ) {
			setState( {
				entity: null,
				isResolving: false,
				notFound: Boolean( uri ),
			} );
			return undefined;
		}

		let cancelled = false;
		setState( { entity: null, isResolving: true, notFound: false } );

		apiFetch( {
			path: `/wp/v2/${ POST_TYPE }s/${ id }?context=edit&_fields=id,slug,parent`,
		} )
			.then( ( entity ) => {
				if ( ! cancelled ) {
					setState( {
						entity,
						isResolving: false,
						notFound: false,
					} );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setState( {
						entity: null,
						isResolving: false,
						notFound: true,
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
		// `uri` is only read in the no-id branch to distinguish empty from
		// malformed; we don't want a uri change with the same id to refetch.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ id ] );

	return state;
}

const COLLECTION_TYPE = 'crtxt_collection';

export function useResolveCollection( id ) {
	const [ state, setState ] = useState( {
		entity: null,
		isResolving: true,
		notFound: false,
	} );

	useEffect( () => {
		if ( ! id ) {
			setState( {
				entity: null,
				isResolving: false,
				notFound: true,
			} );
			return undefined;
		}

		let cancelled = false;
		setState( { entity: null, isResolving: true, notFound: false } );

		apiFetch( {
			path: `/wp/v2/${ COLLECTION_TYPE }s/${ id }?context=edit&_fields=id,slug`,
		} )
			.then( ( entity ) => {
				if ( ! cancelled ) {
					setState( {
						entity,
						isResolving: false,
						notFound: false,
					} );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setState( {
						entity: null,
						isResolving: false,
						notFound: true,
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ id ] );

	return state;
}

// Builds the URL segment: `<prefix>/<slug>-<id>` when a slug exists, or
// `<prefix>/<id>` for fresh drafts. The id is the authoritative part —
// parseIdFromUri only ever reads the trailing digits.
export function computeUri( entity, prefix = 'page' ) {
	const slug = typeof entity.slug === 'string' ? entity.slug.trim() : '';
	const tail = slug ? `${ slug }-${ entity.id }` : `${ entity.id }`;
	return `${ prefix }/${ tail }`;
}

// Strips the prefix from a splat URI and returns { prefix, tail }.
export function parseSplatUri( uri ) {
	const slash = ( uri ?? '' ).indexOf( '/' );
	if ( slash === -1 ) {
		return { prefix: null, tail: uri ?? '' };
	}
	return {
		prefix: uri.slice( 0, slash ),
		tail: uri.slice( slash + 1 ),
	};
}
