import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

// Resolves a URI like "about-us-42" or "42" to a page entity by extracting the
// trailing numeric id and fetching that record directly. The slug prefix is
// cosmetic: it keeps the URL human-readable without being authoritative, so
// renaming a page can never break an existing link, and blank drafts (which
// have no slug yet) remain addressable via their id alone.
const POST_TYPE = 'cortext_page';

// Pulls the trailing `<digits>` — optionally preceded by `-` — out of a URI.
// Matches both `foo-42` and bare `42`. Returns null for anything else so
// callers can treat a missing id as "route to empty state, not 404".
export function parseIdFromUri( uri ) {
	const match = ( uri ?? '' ).match( /(?:^|-)(\d+)$/ );
	return match ? parseInt( match[ 1 ], 10 ) : null;
}

export function useResolveEntity( uri ) {
	const [ state, setState ] = useState( {
		entity: null,
		isResolving: true,
		notFound: false,
	} );

	useEffect( () => {
		const id = parseIdFromUri( uri );

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
	}, [ uri ] );

	return state;
}

// Builds the URL segment for a page: `<slug>-<id>` when a slug exists, bare
// `<id>` for fresh drafts. The id is the authoritative part — parseIdFromUri
// only ever reads the trailing digits.
export function computeUri( page ) {
	const slug = typeof page.slug === 'string' ? page.slug.trim() : '';
	return slug ? `${ slug }-${ page.id }` : `${ page.id }`;
}
