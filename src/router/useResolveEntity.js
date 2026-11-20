import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { useDocumentLocatorInvalidation } from '../hooks/documentLocatorInvalidation';

// Resolves a document URI like `<slug>-<id>` or bare `<id>` to a post entity.
// Only the trailing id is authoritative; the slug is cosmetic, so renames
// don't break existing links and fresh drafts stay addressable as a bare id.
//
// Two REST round trips:
//   1. `/cortext/v1/documents/<id>` returns the post type, rest_base, and
//      trait ids the document belongs to. A non-empty `trait_ids` means the
//      document is a row of those collections. Returned as a list so future
//      multi-trait UX can use the whole set; single-trait callers read `[0]`.
//   2. `/wp/v2/<rest_base>/<id>` returns the record (slug, parent, meta).

// Pulls the trailing `<digits>`, optionally preceded by `-`, out of a URI.
// Matches `foo-42` and bare `42`. Returns null otherwise so callers can
// route to empty state instead of 404.
export function parseIdFromUri( uri ) {
	const match = ( uri ?? '' ).match( /(?:^|-)(\d+)$/ );
	return match ? parseInt( match[ 1 ], 10 ) : null;
}

function normalizeTraitIds( raw ) {
	if ( ! Array.isArray( raw ) ) {
		return [];
	}
	return raw.map( ( id ) => Number( id ) ).filter( ( id ) => id > 0 );
}

export function useResolveDocument( uri ) {
	const id = parseIdFromUri( uri );
	const [ locatorRevision, setLocatorRevision ] = useState( 0 );
	const requestIdRef = useRef( 0 );
	const [ state, setState ] = useState( {
		entity: null,
		traitIds: [],
		isResolving: true,
		notFound: false,
		id,
	} );
	const invalidateLocator = useCallback(
		( { traitIds } ) => {
			// Mark the current request stale synchronously. Waiting for the next
			// effect cleanup leaves a small window where an older locator response
			// could overwrite the memberships returned by the successful PUT.
			requestIdRef.current += 1;
			if ( Array.isArray( traitIds ) ) {
				setState( ( current ) =>
					current.id === id
						? { ...current, traitIds, isResolving: true }
						: current
				);
			}
			setLocatorRevision( ( current ) => current + 1 );
		},
		[ id ]
	);
	useDocumentLocatorInvalidation( id, invalidateLocator );

	// Once `id` is real, this collapses to the id so canonicalization rewrites
	// (`/42` → `/about-us-42`) don't re-fetch. When `id` is null, distinct
	// unparseable URIs each get their own key so empty → malformed (and
	// malformed-A → malformed-B) re-run the effect and flip notFound.
	const fetchKey =
		id !== null
			? `id:${ id }:locator:${ locatorRevision }`
			: `uri:${ uri ?? '' }`;

	useEffect( () => {
		if ( ! id ) {
			setState( {
				entity: null,
				traitIds: [],
				isResolving: false,
				notFound: Boolean( uri ),
				id: null,
			} );
			return undefined;
		}

		let cancelled = false;
		const requestId = ++requestIdRef.current;
		const isCurrentRequest = () =>
			! cancelled && requestId === requestIdRef.current;
		const finishFailedResolution = () => {
			if ( ! isCurrentRequest() ) {
				return;
			}
			setState( ( current ) =>
				current.id === id && current.entity
					? { ...current, isResolving: false, notFound: false }
					: {
							entity: null,
							traitIds: [],
							isResolving: false,
							notFound: true,
							id,
					  }
			);
		};
		setState( ( current ) =>
			current.id === id && current.entity
				? { ...current, isResolving: true, notFound: false }
				: {
						entity: null,
						traitIds: [],
						isResolving: true,
						notFound: false,
						id,
				  }
		);

		apiFetch( { path: `/cortext/v1/documents/${ id }` } )
			.then( async ( locator ) => {
				if ( ! isCurrentRequest() ) {
					return;
				}
				const restBase = locator?.rest_base ?? locator?.type;
				if ( ! restBase ) {
					finishFailedResolution();
					return;
				}
				const traitIds = normalizeTraitIds( locator?.trait_ids );
				try {
					const entity = await apiFetch( {
						path: `/wp/v2/${ restBase }/${ id }?context=edit&_fields=id,slug,parent,type,created_at,created_by,modified_at,modified_by,cortext_hydrated_meta`,
					} );
					if ( isCurrentRequest() ) {
						setState( {
							entity,
							traitIds,
							isResolving: false,
							notFound: false,
							id,
						} );
					}
				} catch {
					finishFailedResolution();
				}
			} )
			.catch( finishFailedResolution );

		return () => {
			cancelled = true;
		};
		// `fetchKey` already encodes both id and (when id is null) uri.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ fetchKey ] );

	return state;
}

// Builds the URL segment: `<slug>-<id>` when a slug exists, or bare `<id>`
// for fresh drafts. `parseIdFromUri` only reads the trailing digits, so the
// slug part is purely cosmetic.
export function computeDocumentUri( entity ) {
	const slug = typeof entity?.slug === 'string' ? entity.slug.trim() : '';
	return slug ? `${ slug }-${ entity.id }` : `${ entity.id }`;
}

export const SETTINGS_URI = 'settings';
export const SETTINGS_EXPERIMENTS_URI = 'settings/experiments';
export const SETTINGS_IMPORT_URI = 'settings/import';
export const SETTINGS_PUBLISHED_URI = 'settings/published';
export const PUBLISHED_DOCUMENTS_URI = 'published';
export const IMPORT_URI = 'import';
export const TRASH_URI = 'trash';
export const ARCHIVED_URI = 'archived';

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

// `trash` opens the Trash view, `trash/<id>` with that item selected.
export function trashUri( id = null ) {
	return id ? `${ TRASH_URI }/${ id }` : TRASH_URI;
}

export function isTrashUri( uri ) {
	return uri === TRASH_URI || parseSplatUri( uri ).prefix === TRASH_URI;
}

// `archived` opens the Archived view, `archived/<id>` with that item selected.
export function archivedUri( id = null ) {
	return id ? `${ ARCHIVED_URI }/${ id }` : ARCHIVED_URI;
}

export function isArchivedUri( uri ) {
	return uri === ARCHIVED_URI || parseSplatUri( uri ).prefix === ARCHIVED_URI;
}

export function isSettingsUri( uri ) {
	return uri === SETTINGS_URI || parseSplatUri( uri ).prefix === SETTINGS_URI;
}
