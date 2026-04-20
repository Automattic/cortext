import { useEntityRecords } from '@wordpress/core-data';

// TODO(types): phase 1 only resolves `page` records. When cortext_page, cortext_collection,
// cortext_collection_{slug}, and cortext_supertag land, this hook grows branches that pick
// the right CPT/taxonomy per segment.
const POST_TYPE = 'page';

export function useResolveEntity( uri ) {
	const { records, isResolving } = useEntityRecords(
		'postType',
		POST_TYPE,
		{
			per_page: 100,
			status: [ 'publish', 'private' ],
		}
	);

	if ( isResolving ) {
		return { entity: null, isResolving: true, notFound: false };
	}

	const segments = ( uri ?? '' ).split( '/' ).filter( Boolean );

	if ( segments.length === 0 ) {
		return { entity: null, isResolving: false, notFound: false };
	}

	if ( ! records ) {
		return { entity: null, isResolving: false, notFound: true };
	}

	let parent = 0;
	let match = null;
	for ( const slug of segments ) {
		match = records.find(
			( r ) => r.slug === slug && r.parent === parent
		);
		if ( ! match ) {
			return { entity: null, isResolving: false, notFound: true };
		}
		parent = match.id;
	}

	return { entity: match, isResolving: false, notFound: false };
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
