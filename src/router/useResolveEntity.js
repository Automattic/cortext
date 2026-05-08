import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

// Resolves a document URI like `<slug>-<id>` or bare `<id>` to a post entity.
// Only the trailing id is authoritative; the slug is cosmetic, so renames
// don't break existing links and fresh drafts stay addressable as a bare id.
//
// Two REST round trips:
//   1. `/cortext/v1/documents/<id>` returns the post type (and rest_base).
//      Pages and row CPTs both opt into the `cortext-document` trait, so
//      one locator covers both.
//   2. `/wp/v2/<rest_base>/<id>` returns the record (slug, parent, meta).

// Pulls the trailing `<digits>`, optionally preceded by `-`, out of a URI.
// Matches `foo-42` and bare `42`. Returns null otherwise so callers can
// route to empty state instead of 404.
export function parseIdFromUri( uri ) {
	const match = ( uri ?? '' ).match( /(?:^|-)(\d+)$/ );
	return match ? parseInt( match[ 1 ], 10 ) : null;
}

export function useResolveDocument( uri ) {
	const id = parseIdFromUri( uri );
	const [ state, setState ] = useState( {
		entity: null,
		isResolving: true,
		notFound: false,
		id,
	} );

	// Once `id` is real, this collapses to the id so canonicalization rewrites
	// (`/42` → `/about-us-42`) don't re-fetch. When `id` is null, distinct
	// unparseable URIs each get their own key so empty → malformed (and
	// malformed-A → malformed-B) re-run the effect and flip notFound.
	const fetchKey = id !== null ? `id:${ id }` : `uri:${ uri ?? '' }`;

	useEffect( () => {
		if ( ! id ) {
			setState( {
				entity: null,
				isResolving: false,
				notFound: Boolean( uri ),
				id: null,
			} );
			return undefined;
		}

		let cancelled = false;
		setState( {
			entity: null,
			isResolving: true,
			notFound: false,
			id,
		} );

		apiFetch( { path: `/cortext/v1/documents/${ id }` } )
			.then( async ( locator ) => {
				if ( cancelled ) {
					return;
				}
				const restBase = locator?.rest_base ?? locator?.type;
				if ( ! restBase ) {
					setState( {
						entity: null,
						isResolving: false,
						notFound: true,
						id,
					} );
					return;
				}
				try {
					const entity = await apiFetch( {
						path: `/wp/v2/${ restBase }/${ id }?context=edit&_fields=id,slug,parent,type`,
					} );
					if ( ! cancelled ) {
						setState( {
							entity,
							isResolving: false,
							notFound: false,
							id,
						} );
					}
				} catch {
					if ( ! cancelled ) {
						setState( {
							entity: null,
							isResolving: false,
							notFound: true,
							id,
						} );
					}
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setState( {
						entity: null,
						isResolving: false,
						notFound: true,
						id,
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
		// `fetchKey` already encodes both id and (when id is null) uri.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ fetchKey ] );

	return state;
}

const COLLECTION_TYPE = 'crtxt_collection';

export function useResolveCollection( id ) {
	// Same id-tagging as useResolveDocument above.
	const [ state, setState ] = useState( {
		entity: null,
		isResolving: true,
		notFound: false,
		id,
	} );

	useEffect( () => {
		if ( ! id ) {
			setState( {
				entity: null,
				isResolving: false,
				notFound: true,
				id: null,
			} );
			return undefined;
		}

		let cancelled = false;
		setState( {
			entity: null,
			isResolving: true,
			notFound: false,
			id,
		} );

		apiFetch( {
			path: `/wp/v2/${ COLLECTION_TYPE }s/${ id }?context=edit&_fields=id,slug`,
		} )
			.then( ( entity ) => {
				if ( ! cancelled ) {
					setState( {
						entity,
						isResolving: false,
						notFound: false,
						id,
					} );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setState( {
						entity: null,
						isResolving: false,
						notFound: true,
						id,
					} );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ id ] );

	return state;
}

// Builds the URL segment: `<slug>-<id>` when a slug exists, or bare `<id>`
// for fresh drafts. parseIdFromUri only reads the trailing digits, so the
// slug part is purely cosmetic. No prefix; documents are the default kind
// in the splat.
export function computeDocumentUri( entity ) {
	const slug = typeof entity?.slug === 'string' ? entity.slug.trim() : '';
	return slug ? `${ slug }-${ entity.id }` : `${ entity.id }`;
}

// Builds a collection URL segment with the explicit `collection/` prefix.
// Collections aren't documents (they're schema containers), so the prefix
// is the routing discriminator that picks the table renderer instead of
// the document editor.
export function computeCollectionUri( entity ) {
	const slug = typeof entity?.slug === 'string' ? entity.slug.trim() : '';
	const tail = slug ? `${ slug }-${ entity.id }` : `${ entity.id }`;
	return `collection/${ tail }`;
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
