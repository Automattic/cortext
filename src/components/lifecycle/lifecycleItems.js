import { __, _n, sprintf } from '@wordpress/i18n';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { humanTimeDiff } from '@wordpress/date';

import { buildBreadcrumb, optionalTitleText } from './useLifecycleList';
import { documentTitle } from '../../documents';
import { definesTrait, hasTrait } from '../../documents/capabilities';

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function typeFilters() {
	return [
		{ value: 'all', label: __( 'All', 'cortext' ) },
		{ value: 'documents', label: __( 'Documents', 'cortext' ) },
		{ value: 'collections', label: __( 'Collections', 'cortext' ) },
		{ value: 'rows', label: __( 'Rows', 'cortext' ) },
	];
}

function typeFilterValue( record ) {
	if ( definesTrait( record ) ) {
		return 'collections';
	}
	if ( hasTrait( record ) ) {
		return 'rows';
	}
	return 'documents';
}

function matchesSearch( record, query ) {
	return documentTitle( record ).toLowerCase().includes( query );
}

/**
 * Roots of the selected type whose title matches the search, plus roots that
 * bring back a matching nested document. Actions always apply to the root,
 * since nested documents come back with it.
 *
 * @param {Array}  roots           Cascade roots in Trash.
 * @param {Map}    descendantsById Nested documents of each root.
 * @param {string} search          Search text.
 * @param {string} typeFilter      One of the `typeFilters()` values.
 * @return {Array<{record: Object, match: ?Object}>} Items to list.
 */
export function filterTrashItems( roots, descendantsById, search, typeFilter ) {
	const query = search.trim().toLowerCase();
	return roots
		.filter(
			( record ) =>
				typeFilter === 'all' || typeFilterValue( record ) === typeFilter
		)
		.map( ( record ) => {
			if ( ! query || matchesSearch( record, query ) ) {
				return { record, match: null };
			}
			const match = ( descendantsById.get( record.id ) ?? [] ).find(
				( descendant ) => matchesSearch( descendant, query )
			);
			return match ? { record, match } : null;
		} )
		.filter( Boolean );
}

// Titles of the documents a trashed one hung from, outermost first: its
// collection for rows, its parent pages otherwise. Empty at the top level.
export function originalPath( record, ancestorById ) {
	if ( record.collection?.id ) {
		return [ optionalTitleText( record.collection.title ) ];
	}
	return buildBreadcrumb( record, ancestorById ).map(
		( crumb ) => crumb.title
	);
}

function daysUntilPurge( record ) {
	if ( ! record.purge_at ) {
		return null;
	}
	const remaining = new Date( record.purge_at ).getTime() - Date.now();
	return Math.max( 0, Math.ceil( remaining / DAY_IN_MS ) );
}

function deletedAgoLabel( record, byName ) {
	const ago = humanTimeDiff( record.trashed_at );
	return byName
		? sprintf(
				/* translators: 1: how long ago the document was deleted, e.g. "2 hours ago", 2: name of who deleted it */
				__( 'Deleted %1$s by %2$s', 'cortext' ),
				ago,
				byName
		  )
		: sprintf(
				/* translators: %s: how long ago the document was deleted, e.g. "2 hours ago" */
				__( 'Deleted %s', 'cortext' ),
				ago
		  );
}

function purgeLabel( record ) {
	const days = daysUntilPurge( record );
	if ( days === null ) {
		return '';
	}
	if ( days === 0 ) {
		return __( 'permanently within a day', 'cortext' );
	}
	return sprintf(
		/* translators: %d: days left before a trashed document is deleted permanently */
		_n(
			'permanently in %d day',
			'permanently in %d days',
			days,
			'cortext'
		),
		days
	);
}

/**
 * When a trashed document was deleted and when it goes away for good, e.g.
 * "Deleted 2 hours ago by maria, permanently in 28 days".
 *
 * @param {Object} record Trashed document from the Trash list.
 * @param {string} byName Who deleted it, or empty to leave it out.
 * @return {string} The label, or empty when the deletion time is unknown.
 */
export function deletionLabel( record, byName ) {
	if ( ! record.trashed_at ) {
		return '';
	}
	const deleted = deletedAgoLabel( record, byName );
	const purge = purgeLabel( record );
	return purge
		? sprintf(
				/* translators: 1: when the document was deleted, e.g. "Deleted 2 hours ago", 2: when it is deleted permanently, e.g. "permanently in 28 days" */
				__( '%1$s, %2$s', 'cortext' ),
				deleted,
				purge
		  )
		: deleted;
}

/**
 * Name of whoever trashed each document, unless it was the current user: in a
 * workspace of one, "Deleted by you" on every item is noise.
 *
 * @return {Function} `( record ) => string`, empty when there is nobody to name.
 */
export function useTrashedByName() {
	const currentUserId = useSelect(
		( select ) => select( coreStore ).getCurrentUser()?.id ?? null,
		[]
	);
	return ( record ) => {
		const trashedBy = record.trashed_by;
		if ( ! trashedBy?.name || trashedBy.id === currentUserId ) {
			return '';
		}
		return trashedBy.name;
	};
}
