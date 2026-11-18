import { __ } from '@wordpress/i18n';
import {
	store as coreStore,
	useEntityRecord,
	useEntityRecords,
} from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
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
// which slots are filled. `lookup` answers from the cached lists first and
// falls back to a single-record fetch for anything past their first page.
function parentOf( record, lookup ) {
	const traitTermId = traitTermIdOf( record );
	if ( traitTermId > 0 ) {
		return lookup.collectionForTerm( traitTermId );
	}
	if ( record?.parent ) {
		return lookup.document( record.parent );
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

	const termsById = useMemo(
		() =>
			new Map(
				( traitTerms ?? [] ).map( ( term ) => [ term.id, term ] )
			),
		[ traitTerms ]
	);

	const goToDocument = useCallback(
		( target ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( target ) },
			} );
		},
		[ navigate ]
	);

	// Walk the chain inside `useSelect` so a hop missing from the cached lists
	// (more than 100 collections, terms, or documents) resolves by id. Those
	// single-record fetches are not invalidated by document saves, unlike the
	// lists, so they stay cached once loaded.
	const chain = useSelect(
		( select ) => {
			if ( ! documentId || ! document ) {
				return [];
			}
			const { getEntityRecord } = select( coreStore );
			const lookupDocument = ( id ) =>
				documentsById.get( id ) ??
				getEntityRecord( 'postType', DOCUMENT_POST_TYPE, id ) ??
				null;
			const lookup = {
				document: lookupDocument,
				collectionForTerm: ( termId ) => {
					const term =
						termsById.get( termId ) ??
						getEntityRecord( 'taxonomy', TRAIT_TAXONOMY, termId, {
							context: TRAIT_TERMS_QUERY.context,
						} );
					const collectionId = Number( term?.slug );
					return collectionId > 0
						? lookupDocument( collectionId )
						: null;
				},
			};

			const nodes = [];
			const seen = new Set();
			let cursor = documentsById.get( documentId ) ?? document;
			while ( cursor && ! seen.has( cursor.id ) ) {
				seen.add( cursor.id );
				nodes.unshift( cursor );
				cursor = parentOf( cursor, lookup );
			}
			return nodes;
		},
		[ documentId, document, documentsById, termsById ]
	);

	return useMemo(
		() =>
			chain.map( ( node, index ) => {
				const isCurrent = index === chain.length - 1;
				return {
					key: `document:${ node.id }`,
					label: titleOf( node ),
					onClick: isCurrent ? null : () => goToDocument( node ),
					isCurrent,
				};
			} ),
		[ chain, goToDocument ]
	);
}
