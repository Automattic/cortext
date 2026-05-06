export function relationIds( value ) {
	const list = Array.isArray( value ) ? value : [ value ];
	return list
		.map( ( entry ) => {
			if ( entry && typeof entry === 'object' && entry.id ) {
				return Number( entry.id );
			}
			return Number( entry );
		} )
		.filter( ( id, index, ids ) => id > 0 && ids.indexOf( id ) === index );
}

export function relationTitle( entry ) {
	if ( ! entry ) {
		return '';
	}
	return entry?.title?.raw || entry?.title?.rendered || `#${ entry?.id }`;
}

export function collectionRoute( ref ) {
	const collectionId = Number( ref?.collectionId );
	if ( ! collectionId ) {
		return '';
	}
	const slug = String( ref?.collectionSlug ?? '' ).trim();
	const tail = slug ? `${ slug }-${ collectionId }` : String( collectionId );
	return `collection/${ tail }`;
}

export function collectionHref( ref ) {
	const route = collectionRoute( ref );
	if ( ! route ) {
		return '#';
	}
	const adminUrl = window.cortextSettings?.adminUrl ?? '/wp-admin/';
	const menuSlug = window.cortextSettings?.menuSlug ?? 'cortext';
	const base = adminUrl.endsWith( '/' ) ? adminUrl : `${ adminUrl }/`;
	const params = new URLSearchParams();
	params.set( 'page', menuSlug );
	params.set( 'p', `/${ route }` );
	return `${ base }admin.php?${ params.toString() }`;
}

function topWindow() {
	try {
		if ( window.parent && window.parent !== window ) {
			return window.parent;
		}
	} catch {
		return window;
	}
	return window;
}

function shouldUseNativeLink( event ) {
	return (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		event.shiftKey
	);
}

export function navigateToCollection( event, ref ) {
	event.stopPropagation();
	if ( shouldUseNativeLink( event ) ) {
		return;
	}
	const route = collectionRoute( ref );
	if ( ! route ) {
		return;
	}
	const targetWindow = topWindow();
	const router = targetWindow?.cortextRouter;
	if ( router?.navigate ) {
		event.preventDefault();
		router.navigate( {
			to: '/$',
			params: { _splat: route },
		} );
		return;
	}
	if ( targetWindow && targetWindow !== window ) {
		event.preventDefault();
		targetWindow.location.href = collectionHref( ref );
	}
}
