import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button, Popover, SearchControl, Spinner } from '@wordpress/components';
import { store as coreStore, useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { Icon, closeSmall, plus } from '@wordpress/icons';

import DocumentIcon from './DocumentIcon';
import { collectionIcon } from './cortextIcons';
import { COLLECTION_QUERY, DOCUMENT_POST_TYPE } from '../collections';
import { visibleTraits } from '../documents/traits';
import { notifyDocumentLocatorChanged } from '../hooks/documentLocatorInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';

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

// Lets the user add or remove a row's traits (one per collection it belongs
// to) straight from the item detail. Changes write the new set through
// `PUT /cortext/v1/documents/<id>/traits`; the last active trait cannot be
// removed, so a row always belongs to at least one collection.
export default function TraitControl( {
	documentId,
	collections,
	beforeRemoveCollection,
	isReadOnly = false,
	onChange,
} ) {
	const [ isAdding, setIsAdding ] = useState( false );
	const [ search, setSearch ] = useState( '' );
	const [ page, setPage ] = useState( 1 );
	const [ loadedCollections, setLoadedCollections ] = useState( [] );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const addButtonRef = useRef( null );

	const { invalidateResolution } = useDispatch( coreStore );

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

	const currentIds = useMemo(
		() => new Set( collections.map( ( collection ) => collection.id ) ),
		[ collections ]
	);

	const suggestions = useMemo( () => {
		return loadedCollections.filter(
			( record ) => ! currentIds.has( record.id )
		);
	}, [ currentIds, loadedCollections ] );
	const canLoadMore = page < Number( totalPages || 1 );

	const updateSearch = ( nextSearch ) => {
		setSearch( nextSearch );
		setPage( 1 );
		setLoadedCollections( [] );
	};

	const closePicker = () => {
		setIsAdding( false );
		setSearch( '' );
		setPage( 1 );
		setLoadedCollections( [] );
	};

	const writeMemberships = async ( nextIds, beforeWrite = null ) => {
		setIsSaving( true );
		setError( null );
		let releaseWriteLock = null;
		try {
			const release = await beforeWrite?.();
			if ( typeof release === 'function' ) {
				releaseWriteLock = release;
			}
			const response = await apiFetch( {
				path: `/cortext/v1/documents/${ documentId }/traits`,
				method: 'PUT',
				data: { collection_ids: nextIds },
			} );
			const activeIds = Array.isArray( response?.collections )
				? response.collections
						.filter(
							( collection ) => collection?.active !== false
						)
						.map( ( collection ) => collection?.id )
				: null;
			notifyDocumentLocatorChanged( documentId, activeIds );
			// Membership changes can update reverse relations and rollups in
			// collections beyond the one directly added or removed.
			notifyCollectionRowsChanged();
			// The breadcrumb chips read `crtxt_trait` off the core-data document
			// record, which this custom-endpoint write does not touch. Invalidate
			// it so the membership change shows there too, not just in the local
			// traits hook this control refreshes via onChange.
			invalidateResolution( 'getEntityRecord', [
				'postType',
				'crtxt_document',
				documentId,
			] );
			onChange?.();
		} catch ( saveError ) {
			setError(
				saveError?.message ?? __( "Couldn't update traits.", 'cortext' )
			);
		} finally {
			releaseWriteLock?.();
			setIsSaving( false );
		}
	};

	const addCollection = ( record ) => {
		// Guard against writing before the current memberships are known: an
		// empty `collections` would replace the whole set with just this id.
		if ( collections.length === 0 ) {
			return;
		}
		closePicker();
		writeMemberships( [
			...collections.map( ( collection ) => collection.id ),
			record.id,
		] );
	};

	// Every trait stays in the writes, but only the visible ones get a chip.
	// The last live one of those cannot be removed.
	const shownCollections = visibleTraits( collections );
	const canRemoveLiveCollection =
		! isReadOnly &&
		shownCollections.filter( ( collection ) => collection.active !== false )
			.length > 1;

	const removeCollection = ( collection ) => {
		if ( ! canRemoveLiveCollection ) {
			return;
		}
		writeMemberships(
			collections
				.filter( ( current ) => current.id !== collection.id )
				.map( ( current ) => current.id ),
			() => beforeRemoveCollection?.( collection.id )
		);
	};

	return (
		<div className="cortext-traits">
			<div className="cortext-row-detail__property">
				<div className="cortext-row-detail__property-label">
					<span className="cortext-row-detail__property-label-icon-slot">
						<span
							className="cortext-field-type-icon cortext-row-detail__property-type-icon"
							aria-hidden="true"
						>
							<Icon icon={ collectionIcon } />
						</span>
					</span>
					<span className="cortext-row-detail__property-label-text">
						{ __( 'Traits', 'cortext' ) }
					</span>
				</div>
				<div className="cortext-row-detail__property-value cortext-traits__chips">
					{ shownCollections.map( ( collection ) => (
						<span
							key={ collection.id }
							className="cortext-traits__chip"
						>
							{ collection.icon ? (
								<DocumentIcon
									icon={ collection.icon }
									size={ 16 }
								/>
							) : null }
							<span className="cortext-traits__chip-title">
								{ collection.title }
							</span>
							{ canRemoveLiveCollection ? (
								<Button
									className="cortext-traits__chip-remove"
									icon={ closeSmall }
									size="small"
									label={ __( 'Remove trait', 'cortext' ) }
									disabled={ isSaving }
									onClick={ () =>
										removeCollection( collection )
									}
								/>
							) : null }
						</span>
					) ) }
					{ isReadOnly ? null : (
						<Button
							ref={ addButtonRef }
							className="cortext-traits__add"
							icon={ plus }
							size="small"
							variant="tertiary"
							label={ __( 'Add trait', 'cortext' ) }
							disabled={ isSaving }
							onClick={ () =>
								setIsAdding( ( current ) => ! current )
							}
						/>
					) }
					{ isSaving ? <Spinner /> : null }
					{ isAdding && ! isReadOnly ? (
						<Popover
							className="cortext-traits__popover"
							anchor={ addButtonRef.current }
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
							<div className="cortext-traits__suggestions">
								{ isResolving ? <Spinner /> : null }
								{ suggestions.map( ( record ) => (
									<Button
										key={ record.id }
										className="cortext-traits__suggestion"
										onClick={ () =>
											addCollection( record )
										}
									>
										<DocumentIcon
											icon={
												record?.meta
													?.cortext_document_icon ??
												''
											}
											size={ 18 }
										/>
										<span>
											{ collectionTitle( record ) }
										</span>
									</Button>
								) ) }
								{ ! isResolving && canLoadMore ? (
									<Button
										className="cortext-traits__load-more"
										variant="tertiary"
										onClick={ () =>
											setPage(
												( current ) => current + 1
											)
										}
									>
										{ __( 'Load more traits', 'cortext' ) }
									</Button>
								) : null }
								{ ! isResolving &&
								! canLoadMore &&
								suggestions.length === 0 ? (
									<p className="cortext-traits__empty">
										{ __( 'No more traits.', 'cortext' ) }
									</p>
								) : null }
							</div>
						</Popover>
					) : null }
				</div>
			</div>
			{ error ? (
				<p className="cortext-traits__error" role="alert">
					{ error }
				</p>
			) : null }
		</div>
	);
}
