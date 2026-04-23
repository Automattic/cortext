import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';

// Resolves a URI like "foo/bar/baz" to a page entity by walking the URL one
// segment at a time, issuing a filtered REST query per segment (slug + parent).
//
// Why segment-walking instead of fetching the full page list once:
// workspaces are expected to contain more than 100 pages, and the REST
// collection endpoint caps `per_page` at 100. A list-then-find approach
// silently 404s for pages past the cap. A filtered `?slug=X&parent=Y` query
// returns at most one row regardless of total page count, so it scales.
//
// Trade-off: cold navigation to a never-visited N-segment URL costs N serial
// round-trips (each is a tiny indexed lookup). In practice N is 1–3, and
// repeat visits ride the browser's HTTP cache. If depth cost becomes visible,
// replace this client walk with a single server-side resolver endpoint
// (`/cortext/v1/resolve?uri=...`) — which is also the natural shape for
// phase 2 below, where URL-shape-to-entity-type rules stop being trivial.
//
// TODO(types): phase 1 only resolves `cortext_page` records. When
// cortext_collection, cortext_collection_{slug}, and cortext_supertag land,
// this hook grows branches that pick the right CPT/taxonomy per segment — or
// is replaced by the server-side resolver described above.
const POST_TYPE = 'cortext_page';

export function useResolveEntity( uri ) {
	const [ state, setState ] = useState( {
		entity: null,
		isResolving: true,
		notFound: false,
	} );

	useEffect( () => {
		const segments = ( uri ?? '' ).split( '/' ).filter( Boolean );

		if ( segments.length === 0 ) {
			setState( { entity: null, isResolving: false, notFound: false } );
			return;
		}

		let cancelled = false;
		setState( { entity: null, isResolving: true, notFound: false } );

		( async () => {
			let parent = 0;
			let match = null;

			for ( const slug of segments ) {
				let results;
				try {
					results = await apiFetch( {
						path: addQueryArgs( `/wp/v2/${ POST_TYPE }s`, {
							slug,
							parent,
							status: 'publish,private',
							per_page: 1,
							_fields: 'id,slug,parent',
						} ),
					} );
				} catch ( _err ) {
					if ( ! cancelled ) {
						setState( {
							entity: null,
							isResolving: false,
							notFound: true,
						} );
					}
					return;
				}

				if ( cancelled ) {
					return;
				}

				if ( ! results || results.length === 0 ) {
					setState( {
						entity: null,
						isResolving: false,
						notFound: true,
					} );
					return;
				}

				match = results[ 0 ];
				parent = match.id;
			}

			if ( ! cancelled ) {
				setState( {
					entity: match,
					isResolving: false,
					notFound: false,
				} );
			}
		} )();

		return () => {
			cancelled = true;
		};
	}, [ uri ] );

	return state;
}

export function computeUri( page, allPages ) {
	const chain = [ page.slug ];
	let currentParent = page.parent;
	while ( currentParent ) {
		const parent = allPages.find( ( p ) => p.id === currentParent );
		if ( ! parent ) {
			break;
		}
		chain.unshift( parent.slug );
		currentParent = parent.parent;
	}
	return chain.join( '/' );
}
