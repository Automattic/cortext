import { __ } from '@wordpress/i18n';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useCallback, useMemo } from '@wordpress/element';

import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
} from '../components/page-queries';
import { COLLECTION_QUERY } from '../collections';
import {
	computeUri,
	parseIdFromUri,
	parseSplatUri,
} from '../router/useResolveEntity';

const COLLECTION_POST_TYPE = 'crtxt_collection';

function titleOf( entity ) {
	return (
		entity?.title?.rendered?.trim() ||
		entity?.title?.raw?.trim() ||
		__( '(untitled)', 'cortext' )
	);
}

// Returns the breadcrumb segments for the active route. Page routes contribute
// the natural ancestor chain; collection routes are flat (just the collection
// itself). Empty / not-found / loading routes return an empty list. There is
// no synthetic "workspace root" segment because there's no workspace home to
// navigate to — `/` only renders the empty state.
export default function useBreadcrumbSegments() {
	const params = useParams( { strict: false } );
	const navigate = useNavigate();
	const { prefix, tail } = parseSplatUri( params._splat ?? '' );
	const isCollection = prefix === 'collection';
	const id = parseIdFromUri( tail );
	const pageId = ! isCollection && id ? id : null;
	const collectionId = isCollection && id ? id : null;

	// Pulled from the same store the Sidebar populates, so no extra fetch.
	const { records: pages } = useEntityRecords(
		'postType',
		PAGE_POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const { records: collections } = useEntityRecords(
		'postType',
		COLLECTION_POST_TYPE,
		COLLECTION_QUERY
	);

	// Falls back to the single-record fetch when the list hasn't resolved yet
	// (or doesn't contain the active id, e.g. a freshly-created page).
	const { record: currentPage } = useEntityRecord(
		'postType',
		PAGE_POST_TYPE,
		pageId ?? 0
	);
	const { record: currentCollection } = useEntityRecord(
		'postType',
		COLLECTION_POST_TYPE,
		collectionId ?? 0
	);

	const goToPage = useCallback(
		( page ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeUri( page, 'page' ) },
			} );
		},
		[ navigate ]
	);

	return useMemo( () => {
		if ( pageId ) {
			const pagesById = new Map(
				( pages ?? [] ).map( ( p ) => [ p.id, p ] )
			);
			// `currentPage` may resolve before the active-pages list, or be
			// the only source for a freshly-created page that's not yet in
			// the cached query. Treat it as authoritative when it matches.
			const head =
				pagesById.get( pageId ) ??
				( currentPage?.id === pageId ? currentPage : null );
			if ( ! head ) {
				// Not yet resolved (loading) or 404. Suppress the breadcrumb
				// rather than render "(untitled)" for a record that may not
				// exist.
				return [];
			}
			if ( ! pagesById.has( pageId ) ) {
				pagesById.set( head.id, head );
			}

			const chain = [];
			let cursor = head;
			const seen = new Set();
			while ( cursor && ! seen.has( cursor.id ) ) {
				seen.add( cursor.id );
				chain.unshift( cursor );
				cursor = cursor.parent
					? pagesById.get( cursor.parent ) ?? null
					: null;
			}

			return chain.map( ( page, index ) => {
				const isCurrent = index === chain.length - 1;
				return {
					key: `page:${ page.id }`,
					label: titleOf( page ),
					onClick: isCurrent ? null : () => goToPage( page ),
					isCurrent,
				};
			} );
		}

		if ( collectionId ) {
			const fromList = ( collections ?? [] ).find(
				( c ) => c.id === collectionId
			);
			const collection =
				fromList ??
				( currentCollection?.id === collectionId
					? currentCollection
					: null );
			if ( ! collection ) {
				return [];
			}
			return [
				{
					key: `collection:${ collection.id }`,
					label: titleOf( collection ),
					onClick: null,
					isCurrent: true,
				},
			];
		}

		return [];
	}, [
		pageId,
		collectionId,
		pages,
		collections,
		currentPage,
		currentCollection,
		goToPage,
	] );
}
