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

export function shouldUseNativeLink( event ) {
	return (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.altKey ||
		event.shiftKey
	);
}

export function rowRoute( ref ) {
	const rowId = Number( ref?.id );
	if ( ! rowId ) {
		return '';
	}
	const slug = String( ref?.slug ?? '' ).trim();
	return slug ? `${ slug }-${ rowId }` : String( rowId );
}

export function rowHref( ref ) {
	const route = rowRoute( ref );
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
