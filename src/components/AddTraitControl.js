import { __ } from '@wordpress/i18n';
import { Button, Popover, SearchControl, Spinner } from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { plus } from '@wordpress/icons';

import DocumentIcon from './DocumentIcon';
import { COLLECTION_ICON } from '../documents';
import { COLLECTION_QUERY, DOCUMENT_POST_TYPE } from '../collections';

import './AddTraitControl.scss';

const COLLECTIONS_PER_PAGE = 20;

function mergeCollectionsById( previous, incoming ) {
	const merged = new Map();
	previous.forEach( ( collection ) =>
		merged.set( collection.id, collection )
	);
	incoming.forEach( ( collection ) =>
		merged.set( collection.id, collection )
	);
	return Array.from( merged.values() );
}

function sameCollectionSuggestions( previous, next ) {
	return (
		previous.length === next.length &&
		previous.every(
			( collection, index ) =>
				collection.id === next[ index ]?.id &&
				collectionTitle( collection ) ===
					collectionTitle( next[ index ] ) &&
				collection?.meta?.cortext_document_icon ===
					next[ index ]?.meta?.cortext_document_icon
		)
	);
}

function collectionTitle( record ) {
	return (
		record?.title?.raw?.trim() ||
		record?.title?.rendered?.trim() ||
		__( '(untitled)', 'cortext' )
	);
}

// The "Add trait" button after a row's property groups. It opens a search over
// the collections the row does not belong to yet and hands the pick to
// `onAdd`; the caller owns the write.
export default function AddTraitControl( {
	currentIds,
	error = null,
	isSaving = false,
	onAdd,
} ) {
	const [ isOpen, setIsOpen ] = useState( false );
	const [ search, setSearch ] = useState( '' );
	const [ page, setPage ] = useState( 1 );
	const [ loadedCollections, setLoadedCollections ] = useState( [] );
	const buttonRef = useRef( null );

	const trimmedSearch = search.trim();
	const collectionQuery = useMemo(
		() => ( {
			...COLLECTION_QUERY,
			per_page: COLLECTIONS_PER_PAGE,
			page,
			...( trimmedSearch ? { search: trimmedSearch } : {} ),
		} ),
		[ page, trimmedSearch ]
	);
	const {
		records: collectionPage,
		isResolving,
		totalPages = 1,
	} = useEntityRecords( 'postType', DOCUMENT_POST_TYPE, collectionQuery );

	useEffect( () => {
		if ( isResolving || ! Array.isArray( collectionPage ) ) {
			return;
		}
		setLoadedCollections( ( current ) => {
			const next =
				page === 1
					? collectionPage
					: mergeCollectionsById( current, collectionPage );
			return sameCollectionSuggestions( current, next ) ? current : next;
		} );
	}, [ collectionPage, isResolving, page ] );

	const suggestions = useMemo(
		() =>
			loadedCollections.filter(
				( record ) => ! currentIds.has( record.id )
			),
		[ currentIds, loadedCollections ]
	);
	const canLoadMore = page < Number( totalPages || 1 );

	const updateSearch = ( nextSearch ) => {
		setSearch( nextSearch );
		setPage( 1 );
		setLoadedCollections( [] );
	};

	const closePicker = () => {
		setIsOpen( false );
		setSearch( '' );
		setPage( 1 );
		setLoadedCollections( [] );
	};

	const pick = ( record ) => {
		closePicker();
		onAdd( record );
	};

	return (
		<div className="cortext-add-trait">
			<div className="cortext-add-trait__row">
				<Button
					ref={ buttonRef }
					className="cortext-add-trait__button"
					icon={ plus }
					size="small"
					variant="tertiary"
					disabled={ isSaving }
					aria-expanded={ isOpen }
					onClick={ () => setIsOpen( ( current ) => ! current ) }
				>
					{ __( 'Add trait', 'cortext' ) }
				</Button>
				{ isSaving ? <Spinner /> : null }
			</div>
			{ isOpen ? (
				<Popover
					className="cortext-add-trait__popover"
					anchor={ buttonRef.current }
					placement="bottom-start"
					onClose={ closePicker }
					focusOnMount
				>
					<SearchControl
						__nextHasNoMarginBottom
						value={ search }
						onChange={ updateSearch }
						placeholder={ __( 'Search traits', 'cortext' ) }
					/>
					<div className="cortext-add-trait__suggestions">
						{ isResolving ? <Spinner /> : null }
						{ suggestions.map( ( record ) => (
							<Button
								key={ record.id }
								className="cortext-add-trait__suggestion"
								onClick={ () => pick( record ) }
							>
								<DocumentIcon
									icon={
										record?.meta?.cortext_document_icon ||
										COLLECTION_ICON
									}
									size={ 18 }
								/>
								<span>{ collectionTitle( record ) }</span>
							</Button>
						) ) }
						{ ! isResolving && canLoadMore ? (
							<Button
								className="cortext-add-trait__load-more"
								variant="tertiary"
								onClick={ () =>
									setPage( ( current ) => current + 1 )
								}
							>
								{ __( 'Load more traits', 'cortext' ) }
							</Button>
						) : null }
						{ ! isResolving &&
						! canLoadMore &&
						suggestions.length === 0 ? (
							<p className="cortext-add-trait__empty">
								{ __( 'No more traits.', 'cortext' ) }
							</p>
						) : null }
					</div>
				</Popover>
			) : null }
			{ error ? (
				<p className="cortext-add-trait__error" role="alert">
					{ error }
				</p>
			) : null }
		</div>
	);
}
