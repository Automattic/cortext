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
import { isExperimentEnabled, TRAITS_EXPERIMENT_ID } from '../settings';

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

function termIdsOf( record ) {
	return Array.isArray( record?.crtxt_trait ) ? record.crtxt_trait : [];
}

const RETIRED_STATUSES = [ 'trash', 'crtxt_archived' ];

// An archived or trashed collection keeps its rows' membership for restore,
// but it is not a place a live row lives in, so it shows as neither a parent
// nor a chip while the row has a live collection.
function liveCollectionForTerm( termId, lookup ) {
	const collection = lookup.collectionForTerm( Number( termId ) );
	return collection && ! RETIRED_STATUSES.includes( collection.status )
		? collection
		: null;
}

// Every live collection a row belongs to, deduplicated and in term order.
function collectionsOfRecord( record, lookup ) {
	const collections = [];
	const seen = new Set();
	termIdsOf( record ).forEach( ( termId ) => {
		const collection = liveCollectionForTerm( termId, lookup );
		if ( collection && ! seen.has( collection.id ) ) {
			seen.add( collection.id );
			collections.push( collection );
		}
	} );
	return collections;
}

// Walks one step up the breadcrumb chain. A document's parent is the first
// live collection among its trait terms, or the first collection at all when
// the row was retired together with them, then its `post_parent` (if any).
// Collections, pages, and rows all use the same rule; the difference is which
// slots are filled. `lookup` answers from the cached lists first and falls
// back to a single-record fetch for anything past their first page.
function parentOf( record, lookup ) {
	const termIds = termIdsOf( record );
	for ( const termId of termIds ) {
		const collection = liveCollectionForTerm( termId, lookup );
		if ( collection ) {
			return collection;
		}
	}
	for ( const termId of termIds ) {
		const collection = lookup.collectionForTerm( Number( termId ) );
		if ( collection ) {
			return collection;
		}
	}
	if ( record?.parent ) {
		return lookup.document( record.parent );
	}
	return null;
}

function createLookup( select, documentsById, termsById ) {
	const { getEntityRecord } = select( coreStore );
	const lookupDocument = ( id ) =>
		documentsById.get( id ) ??
		getEntityRecord( 'postType', DOCUMENT_POST_TYPE, id ) ??
		null;
	return {
		document: lookupDocument,
		collectionForTerm: ( termId ) => {
			const term =
				termsById.get( termId ) ??
				getEntityRecord( 'taxonomy', TRAIT_TAXONOMY, termId, {
					context: TRAIT_TERMS_QUERY.context,
				} );
			const collectionId = Number( term?.slug );
			return collectionId > 0 ? lookupDocument( collectionId ) : null;
		},
	};
}

// Returns the breadcrumb segments for the currently mounted document.
// Driven by `paintedDocumentId` (from EntityRoute) rather than the URL so the
// breadcrumb updates in lockstep with the document-actions Fill.
export default function useBreadcrumbSegments( paintedDocumentId ) {
	const navigate = useNavigate();
	const documentId = paintedDocumentId ?? null;
	const traitsEnabled = isExperimentEnabled( TRAITS_EXPERIMENT_ID );

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
	// Every live collection the current item belongs to. With traits on and
	// more than one, the item has no single owning collection: they render as
	// chips beside it instead of one of them heading the chain.
	const itemCollections = useSelect(
		( select ) => {
			if ( ! traitsEnabled || ! documentId || ! document ) {
				return [];
			}
			const collections = collectionsOfRecord(
				documentsById.get( documentId ) ?? document,
				createLookup( select, documentsById, termsById )
			);
			return collections.length > 1 ? collections : [];
		},
		[ traitsEnabled, documentId, document, documentsById, termsById ]
	);
	const isMultiCollection = itemCollections.length > 1;

	const chain = useSelect(
		( select ) => {
			if ( ! documentId || ! document ) {
				return [];
			}
			const lookup = createLookup( select, documentsById, termsById );

			const nodes = [];
			const seen = new Set();
			let cursor = documentsById.get( documentId ) ?? document;
			let isStart = true;
			while ( cursor && ! seen.has( cursor.id ) ) {
				seen.add( cursor.id );
				nodes.unshift( cursor );
				// A multi-collection item does not climb into an arbitrary
				// collection. Any page hierarchy above it (via `post_parent`)
				// still shows.
				if ( isStart && isMultiCollection ) {
					cursor = cursor?.parent
						? lookup.document( cursor.parent )
						: null;
				} else {
					cursor = parentOf( cursor, lookup );
				}
				isStart = false;
			}
			return nodes;
		},
		[ documentId, document, documentsById, termsById, isMultiCollection ]
	);

	return useMemo( () => {
		const segments = chain.map( ( node, index ) => {
			const isCurrent = index === chain.length - 1;
			return {
				key: `document:${ node.id }`,
				label: titleOf( node ),
				onClick: isCurrent ? null : () => goToDocument( node ),
				isCurrent,
			};
		} );
		const chips = itemCollections.map( ( collection ) => ( {
			key: `collection:${ collection.id }`,
			id: collection.id,
			label: titleOf( collection ),
			onClick: () => goToDocument( collection ),
		} ) );
		return { segments, chips };
	}, [ chain, goToDocument, itemCollections ] );
}
