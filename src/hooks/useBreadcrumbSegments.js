import { __ } from '@wordpress/i18n';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo } from '@wordpress/element';

import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
} from '../components/page-queries';
import { COLLECTION_QUERY, DOCUMENT_POST_TYPE } from '../collections';
import { computeDocumentUri } from '../router/useResolveEntity';

const TRAIT_TAXONOMY = 'crtxt_trait';
const TRAIT_TERMS_QUERY = { per_page: 100, context: 'view' };

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

function traitTermIdOf( record ) {
	const terms = record?.crtxt_trait;
	return Array.isArray( terms ) && terms.length > 0
		? Number( terms[ 0 ] )
		: 0;
}

// Walks one step up the breadcrumb chain. A document's parent is the
// collection that owns its trait term (if any), then its `post_parent` (if
// any). Collections, pages, and rows all use the same rule; the difference is
// which slots are filled.
function parentOf( record, byId, collectionsByTerm ) {
	const traitTermId = traitTermIdOf( record );
	if ( traitTermId > 0 ) {
		return collectionsByTerm.get( traitTermId ) ?? null;
	}
	if ( record?.parent ) {
		return byId.get( record.parent ) ?? null;
	}
	return null;
}

// Returns the breadcrumb segments for the currently mounted document.
// Driven by `paintedDocumentId` (from EntityRoute) rather than the URL so the
// breadcrumb updates in lockstep with the document-actions Fill.
export default function useBreadcrumbSegments( paintedDocumentId ) {
	const navigate = useNavigate();
	const documentId = paintedDocumentId ?? null;

	const { record: document } = useEntityRecord(
		'postType',
		DOCUMENT_POST_TYPE,
		documentId ?? 0
	);

	// Sidebar lists already subscribe to these two queries, so they answer
	// most ancestor lookups from cache without per-id resolvers.
	const { records: activePages } = useEntityRecords(
		'postType',
		PAGE_POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const { records: allCollections } = useEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		COLLECTION_QUERY
	);
	// Pull the mirror terms separately so we can resolve a row's
	// `crtxt_trait` term IDs back to their owning collection. The taxonomy
	// uses the collection's post ID as the term slug, so the join is
	// deterministic: term.slug parses back to collection.id.
	const { records: traitTerms } = useEntityRecords(
		'taxonomy',
		TRAIT_TAXONOMY,
		TRAIT_TERMS_QUERY
	);

	const documentsById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		( allCollections ?? [] ).forEach( ( collection ) =>
			map.set( collection.id, collection )
		);
		return map;
	}, [ activePages, allCollections ] );

	const collectionsByTerm = useMemo( () => {
		const map = new Map();
		( traitTerms ?? [] ).forEach( ( term ) => {
			const collectionId = Number( term.slug );
			if ( ! Number.isFinite( collectionId ) || collectionId < 1 ) {
				return;
			}
			const collection = documentsById.get( collectionId );
			if ( collection ) {
				map.set( Number( term.id ), collection );
			}
		} );
		return map;
	}, [ traitTerms, documentsById ] );

	const goToDocument = useCallback(
		( target ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( target ) },
			} );
		},
		[ navigate ]
	);

	return useMemo( () => {
		if ( ! documentId || ! document ) {
			return [];
		}

		const chain = [];
		const seen = new Set();
		let cursor = documentsById.get( documentId ) ?? document;
		while ( cursor && ! seen.has( cursor.id ) ) {
			seen.add( cursor.id );
			chain.unshift( cursor );
			cursor = parentOf( cursor, documentsById, collectionsByTerm );
		}

		return chain.map( ( node, index ) => {
			const isCurrent = index === chain.length - 1;
			return {
				key: `document:${ node.id }`,
				label: titleOf( node ),
				onClick: isCurrent ? null : () => goToDocument( node ),
				isCurrent,
			};
		} );
	}, [
		documentId,
		document,
		documentsById,
		collectionsByTerm,
		goToDocument,
	] );
}
