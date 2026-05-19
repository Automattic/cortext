import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from '@wordpress/element';

import { POST_TYPE as PAGE_POST_TYPE } from '../components/page-queries';
import { useActivePages, useCollections } from './useEntityBulks';
import {
	computeCollectionUri,
	computeDocumentUri,
} from '../router/useResolveEntity';

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
// updates in lockstep with the document-actions Fill, so both sides of the
// top bar describe the same entity even mid-navigation.
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

	// Pages and collections come from the shell's canonical bulks. The chain
	// traversal needs to walk parents by id, so we use `byId` directly
	// instead of the `get` accessor.
	const { byId: pagesById } = useActivePages();
	const { get: getCollection } = useCollections();

	// Rows are not part of any bulk this hook owns (they live behind
	// per-collection endpoints), so the row title still needs its own fetch.
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
			const head = pagesById.get( pageId );
			if ( ! head ) {
				return [];
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
			const collection = getCollection( collectionId );
			if ( ! collection ) {
				return [];
			}
			if ( rowId ) {
				return [
					{
						key: `collection:${ collection.id }`,
						label: titleOf( collection ),
						onClick: () => goToCollection( collection ),
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
		rowId,
		rowPostType,
		pagesById,
		getCollection,
		currentRow,
		goToPage,
		goToCollection,
	] );
}
