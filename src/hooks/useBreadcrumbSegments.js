import { __ } from '@wordpress/i18n';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from '@wordpress/element';

import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
} from '../components/page-queries';
import { COLLECTION_QUERY } from '../collections';
import usePooledEntityRecord from './usePooledEntityRecord';
import {
	computeCollectionUri,
	computeDocumentUri,
} from '../router/useResolveEntity';

const COLLECTION_POST_TYPE = 'crtxt_collection';

// Prefer `title.raw` over `title.rendered`: WordPress runs rendered titles
// through its formatting pipeline, so `&` becomes `&#038;` etc. React would
// then show the literal entity text in the bar (we don't use
// `dangerouslySetInnerHTML`). Both fields are available under edit context.
function titleOf( entity ) {
	return (
		entity?.title?.raw?.trim() ||
		entity?.title?.rendered?.trim() ||
		__( '(untitled)', 'cortext' )
	);
}

// Returns the breadcrumb segments for the currently painted surface. Driven by
// `paintedRoute` (from EntityRoute) rather than the URL so the breadcrumb
// updates in lockstep with the document-actions Fill. During navigation, both
// sides of the top bar should still describe the same entity.
//
// Document targets carry a `postType`. Pages (`crtxt_page`) contribute the
// natural ancestor chain; rows (dynamic `crtxt_<slug>`) contribute their
// parent collection plus the row title. Collection targets are flat.
export default function useBreadcrumbSegments( paintedRoute ) {
	const navigate = useNavigate();
	const kind = paintedRoute?.kind ?? 'unresolved';
	const documentId = kind === 'document' ? paintedRoute.id : null;
	const documentPostType = kind === 'document' ? paintedRoute.postType : null;
	const isPageDocument = documentPostType === PAGE_POST_TYPE;
	const isRowDocument = Boolean( documentPostType ) && ! isPageDocument;
	const pageId = isPageDocument ? documentId : null;
	const rowId = isRowDocument ? documentId : null;
	const rowPostType = isRowDocument ? documentPostType : null;
	let collectionId = null;
	if ( kind === 'collection' ) {
		collectionId = paintedRoute.id;
	} else if ( isRowDocument ) {
		collectionId = paintedRoute.collectionId ?? null;
	}

	// Page breadcrumbs climb the parent chain, so they need the whole active
	// pages query. Building the parents map locally keeps the lookup-by-id
	// cost flat over the depth of the chain.
	const { records: activePages } = useEntityRecords(
		'postType',
		PAGE_POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const pagesById = useMemo(
		() =>
			new Map(
				( activePages ?? [] ).map( ( page ) => [ page.id, page ] )
			),
		[ activePages ]
	);

	// Current page and current collection share core-data's queried-data
	// cache with their sibling surfaces (sidebar, collection picker), so
	// these calls reuse those subscriptions without firing per-id resolvers
	// while the id is part of the query.
	const { record: currentPage } = usePooledEntityRecord(
		'postType',
		PAGE_POST_TYPE,
		ACTIVE_PAGES_QUERY,
		pageId
	);
	const { record: currentCollection } = usePooledEntityRecord(
		'postType',
		COLLECTION_POST_TYPE,
		COLLECTION_QUERY,
		collectionId
	);

	// Rows are behind per-collection endpoints, so the row title still needs
	// its own fetch.
	const { record: currentRow } = useEntityRecord(
		'postType',
		rowPostType ?? '',
		rowId ?? 0,
		{ enabled: Boolean( rowPostType && rowId ) }
	);

	const goToPage = useCallback(
		( page ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( page ) },
			} );
		},
		[ navigate ]
	);

	const goToCollection = useCallback(
		( collection ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeCollectionUri( collection ) },
			} );
		},
		[ navigate ]
	);

	return useMemo( () => {
		if ( pageId ) {
			if ( ! currentPage ) {
				return [];
			}

			const chain = [];
			let cursor = currentPage;
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
			if ( ! currentCollection ) {
				return [];
			}
			if ( rowId ) {
				return [
					{
						key: `collection:${ currentCollection.id }`,
						label: titleOf( currentCollection ),
						onClick: () => goToCollection( currentCollection ),
						isCurrent: false,
					},
					{
						key: `row:${ rowPostType }:${ rowId }`,
						label: titleOf( currentRow ),
						onClick: null,
						isCurrent: true,
					},
				];
			}
			return [
				{
					key: `collection:${ currentCollection.id }`,
					label: titleOf( currentCollection ),
					onClick: null,
					isCurrent: true,
				},
			];
		}

		return [];
	}, [
		pageId,
		collectionId,
		rowId,
		rowPostType,
		pagesById,
		currentPage,
		currentCollection,
		currentRow,
		goToPage,
		goToCollection,
	] );
}
