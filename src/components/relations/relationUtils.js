import { __, sprintf } from '@wordpress/i18n';

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

export function isArchivedRelationRef( entry ) {
	return entry?.status === 'crtxt_archived';
}

function isRelationRef( entry ) {
	return (
		Boolean( entry ) &&
		typeof entry === 'object' &&
		Number( entry.id ) > 0 &&
		typeof entry.status === 'string'
	);
}

/**
 * Collects `{ targetId: status }` from hydrated meta, covering relation
 * fields and rollups that show relation targets.
 *
 * @param {Object} hydratedMeta Hydrated values keyed by `field-<id>`.
 * @return {Object<number,string>} Target statuses keyed by target ID.
 */
export function relationTargetStatuses( hydratedMeta ) {
	const statuses = {};
	Object.values( hydratedMeta ?? {} ).forEach( ( value ) => {
		if ( ! Array.isArray( value ) ) {
			return;
		}
		value.filter( isRelationRef ).forEach( ( ref ) => {
			statuses[ Number( ref.id ) ] = ref.status;
		} );
	} );
	return statuses;
}

/**
 * Returns hydrated meta with each relation reference's status replaced by the
 * matching entry in `statuses`. Values and references without a match are
 * kept as they are.
 *
 * @param {Object}                hydratedMeta Hydrated values keyed by `field-<id>`.
 * @param {Object<number,string>} statuses     Target statuses keyed by target ID.
 * @return {Object} Hydrated meta with updated statuses.
 */
export function withRelationTargetStatuses( hydratedMeta, statuses ) {
	if ( Object.keys( statuses ?? {} ).length === 0 ) {
		return hydratedMeta;
	}
	const next = {};
	Object.entries( hydratedMeta ?? {} ).forEach( ( [ key, value ] ) => {
		next[ key ] = Array.isArray( value )
			? value.map( ( entry ) => {
					const status = isRelationRef( entry )
						? statuses[ Number( entry.id ) ]
						: undefined;
					return status && status !== entry.status
						? { ...entry, status }
						: entry;
			  } )
			: value;
	} );
	return next;
}

export function archivedRelationLabel( title ) {
	return sprintf(
		/* translators: %s: title of an archived related document */
		__( '%s (archived)', 'cortext' ),
		title
	);
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
