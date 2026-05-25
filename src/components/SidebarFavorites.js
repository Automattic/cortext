import { __, sprintf } from '@wordpress/i18n';
import { Button, Icon } from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { customPostType, starFilled } from '@wordpress/icons';
import {
	DndContext,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	arrayMove,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import PageIcon from './PageIcon';
import { SidebarListSkeleton } from './Skeleton';
import { documentTitle, favoriteKey } from '../documents';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { collectDescendants } from './pages-tree';
import {
	computeCollectionUri,
	computeDocumentUri,
} from '../router/useResolveEntity';
import { whenViewTransitionsSettled } from '../hooks/viewTransition';

const FAVORITE_ADD_ANIMATION_MS = 220;
const FAVORITE_REMOVE_ANIMATION_MS = 150;

function transformToString( transform ) {
	if ( ! transform ) {
		return undefined;
	}
	const { x = 0, y = 0, scaleX = 1, scaleY = 1 } = transform;
	return `translate3d(${ x }px, ${ y }px, 0) scaleX(${ scaleX }) scaleY(${ scaleY })`;
}

function favoriteTitle( favorite, fallback ) {
	return favorite.title?.trim?.() || fallback;
}

export function moveFavorite( favorites, activeId, overId ) {
	if ( ! overId || activeId === overId ) {
		return favorites;
	}

	const from = favorites.findIndex( ( favorite ) => {
		return favoriteKey( favorite ) === activeId;
	} );
	const to = favorites.findIndex( ( favorite ) => {
		return favoriteKey( favorite ) === overId;
	} );

	if ( from < 0 || to < 0 ) {
		return favorites;
	}

	return arrayMove( favorites, from, to );
}

export function filterFavoritesForTrashedPage(
	favorites,
	pageId,
	pages,
	collections = []
) {
	const trashedPageIds = new Set( [
		Number( pageId ),
		...collectDescendants( Number( pageId ), pages ),
	] );

	// The cascade also trashes full-page collections under these pages. Remove
	// those favorites here. Inline owners are server-only, so the controller
	// filters stale inline favorites on read.
	const trashedCollectionIds = new Set(
		( collections ?? [] )
			.filter( ( collection ) =>
				trashedPageIds.has( Number( collection.parent ?? 0 ) )
			)
			.map( ( collection ) => Number( collection.id ) )
	);

	return favorites.filter( ( favorite ) => {
		if ( favorite.kind === 'page' ) {
			return ! trashedPageIds.has( Number( favorite.id ) );
		}
		if ( favorite.kind === 'collection' ) {
			return ! trashedCollectionIds.has( Number( favorite.id ) );
		}
		if ( favorite.kind === 'row' ) {
			// Rows fall with their parent collection. The favorite carries the
			// owner inline (`collection.id`), set by `format_target` on read.
			return ! trashedCollectionIds.has(
				Number( favorite.collection?.id )
			);
		}
		return true;
	} );
}

export function filterFavoritesForTrashedCollection( favorites, collectionId ) {
	const target = Number( collectionId );
	return favorites.filter(
		( favorite ) =>
			! (
				( favorite.kind === 'collection' &&
					Number( favorite.id ) === target ) ||
				( favorite.kind === 'row' &&
					Number( favorite.collection?.id ) === target )
			)
	);
}

export function resolveFavoriteItems( favorites, pages, collections ) {
	const pagesById = new Map( pages.map( ( page ) => [ page.id, page ] ) );
	const collectionsById = new Map(
		( collections ?? [] ).map( ( collection ) => [
			collection.id,
			collection,
		] )
	);

	return favorites
		.map( ( favorite ) => {
			const id = Number( favorite.id );
			if ( favorite.kind === 'page' ) {
				const page = pagesById.get( id );
				if ( ! page && ! favorite.path ) {
					return null;
				}
				const key = favoriteKey( favorite );
				return {
					...favorite,
					id,
					key,
					sortableId: key,
					record: page,
					title: page
						? documentTitle( page )
						: favoriteTitle( favorite, __( 'Page', 'cortext' ) ),
					path: page ? computeDocumentUri( page ) : favorite.path,
					icon: page
						? page.meta?.cortext_document_icon ?? ''
						: favorite.icon ?? '',
				};
			}

			if ( favorite.kind === 'collection' ) {
				const collection = collectionsById.get( id );
				if ( ! collection && ! favorite.path ) {
					return null;
				}
				const key = favoriteKey( favorite );
				return {
					...favorite,
					id,
					key,
					sortableId: key,
					record: collection,
					title: collection
						? documentTitle( collection )
						: favoriteTitle(
								favorite,
								__( 'Collection', 'cortext' )
						  ),
					path: collection
						? computeCollectionUri( collection )
						: favorite.path,
				};
			}

			if ( favorite.kind === 'row' ) {
				// Rows come from the server, not the sidebar tree. Use the title
				// and path already returned with the favorite.
				if ( ! favorite.path ) {
					return null;
				}
				const key = favoriteKey( favorite );
				return {
					...favorite,
					id,
					key,
					sortableId: key,
					title: favoriteTitle( favorite, __( 'Row', 'cortext' ) ),
					path: favorite.path,
				};
			}

			return null;
		} )
		.filter( Boolean );
}

function mergeDisplayFavorites( currentDisplay, nextFavorites, removingKeys ) {
	const nextByKey = new Map(
		nextFavorites.map( ( favorite ) => [
			favoriteKey( favorite ),
			favorite,
		] )
	);
	const seen = new Set();
	const merged = [];

	currentDisplay.forEach( ( favorite ) => {
		const key = favoriteKey( favorite );
		if ( nextByKey.has( key ) ) {
			merged.push( nextByKey.get( key ) );
			seen.add( key );
		} else if ( removingKeys.has( key ) ) {
			merged.push( favorite );
			seen.add( key );
		}
	} );

	nextFavorites.forEach( ( favorite ) => {
		const key = favoriteKey( favorite );
		if ( ! seen.has( key ) ) {
			merged.push( favorite );
		}
	} );

	return merged;
}

function FavoriteIcon( { item } ) {
	if ( item.kind === 'page' ) {
		return <PageIcon icon={ item.icon ?? '' } size={ 16 } />;
	}

	return <Icon icon={ customPostType } size={ 16 } />;
}

function SortableFavoriteRow( { item, isDisabled, onSelect, onRemove } ) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable( { id: item.sortableId } );
	const rowRef = useRef( null );
	const wasDraggingRef = useRef( false );
	const setRowRef = useCallback(
		( node ) => {
			rowRef.current = node;
			setNodeRef( node );
		},
		[ setNodeRef ]
	);
	const rowClasses = [ 'cortext-sidebar__row' ];
	if ( isDragging ) {
		rowClasses.push( 'is-dragging' );
	}

	useEffect( () => {
		if ( wasDraggingRef.current && ! isDragging ) {
			const activeElement = rowRef.current?.ownerDocument?.activeElement;
			if (
				activeElement &&
				rowRef.current?.contains( activeElement ) &&
				typeof activeElement.blur === 'function'
			) {
				activeElement.blur();
			}
		}
		wasDraggingRef.current = isDragging;
	}, [ isDragging ] );

	return (
		<li
			className={
				'cortext-sidebar__node cortext-sidebar__favorite-row' +
				( item.isAdded ? ' is-added' : '' ) +
				( item.isRemoving ? ' is-removing' : '' )
			}
			data-favorite-key={ item.sortableId }
		>
			<div
				ref={ setRowRef }
				className={ rowClasses.join( ' ' ) }
				style={ {
					transform: transformToString( transform ),
					transition,
				} }
				{ ...attributes }
				{ ...listeners }
			>
				<span
					className="cortext-sidebar__favorite-icon"
					aria-hidden="true"
				>
					<FavoriteIcon item={ item } />
				</span>
				<button
					type="button"
					className="cortext-sidebar__favorite-title"
					onClick={ ( event ) => {
						const isMouseClick = event.detail > 0;
						if ( ! isMouseClick ) {
							onSelect( item );
							return;
						}
						const button = event.currentTarget;
						if ( onSelect( item ) ) {
							// Hold focus through the canvas view transition
							// so :focus-within keeps the row painted (the
							// ::view-transition overlay briefly suspends
							// :hover hit-testing on the sidebar, which would
							// otherwise flicker). Blur once the transition
							// finishes so the row doesn't stay highlighted.
							whenViewTransitionsSettled().then( () =>
								button.blur()
							);
						} else {
							// No navigation (clicked the active favorite).
							// Drop focus right away so the row doesn't sit
							// in :focus-within state.
							button.blur();
						}
					} }
				>
					{ item.title }
				</button>
				<Button
					className="cortext-sidebar__favorite-toggle is-favorite"
					icon={ starFilled }
					size="small"
					disabled={ isDisabled }
					label={ sprintf(
						/* translators: %s: favorite title */
						__( 'Remove %s from favorites', 'cortext' ),
						item.title
					) }
					onPointerDown={ ( event ) => event.stopPropagation() }
					onClick={ () => onRemove( item ) }
					aria-pressed
				/>
			</div>
		</li>
	);
}

export default function SidebarFavorites( {
	favorites,
	pages,
	collections,
	isResolving,
	isResolvingItems,
	isDisabled,
	onSelect,
	onRemove,
	onReorder,
} ) {
	const [ displayFavorites, setDisplayFavorites ] = useState( favorites );
	const [ addedKeys, setAddedKeys ] = useState( () => new Set() );
	const [ removingKeys, setRemovingKeys ] = useState( () => new Set() );
	const previousKeysRef = useRef( null );
	const latestFavoritesRef = useRef( favorites );
	const removingKeysRef = useRef( new Set() );
	const hasCompletedInitialLoadRef = useRef( ! isResolving );
	const timersRef = useRef( [] );

	useEffect( () => {
		latestFavoritesRef.current = favorites;
		const currentKeys = new Set(
			favorites.map( ( favorite ) => favoriteKey( favorite ) )
		);
		const previousKeys = previousKeysRef.current;
		previousKeysRef.current = currentKeys;
		const canAnimateChanges = hasCompletedInitialLoadRef.current;

		if ( ! previousKeys ) {
			setDisplayFavorites( favorites );
			if ( ! isResolving ) {
				hasCompletedInitialLoadRef.current = true;
			}
			return;
		}

		const nextAdded = new Set(
			[ ...currentKeys ].filter( ( key ) => ! previousKeys.has( key ) )
		);
		const nextRemoved = new Set(
			[ ...previousKeys ].filter( ( key ) => ! currentKeys.has( key ) )
		);
		const nextRemovingKeys = new Set( removingKeysRef.current );
		nextAdded.forEach( ( key ) => nextRemovingKeys.delete( key ) );
		nextRemoved.forEach( ( key ) => nextRemovingKeys.add( key ) );

		if ( canAnimateChanges && nextAdded.size > 0 ) {
			setAddedKeys( nextAdded );
			const timer = setTimeout( () => {
				setAddedKeys( ( keys ) => {
					const next = new Set( keys );
					nextAdded.forEach( ( key ) => next.delete( key ) );
					return next;
				} );
			}, FAVORITE_ADD_ANIMATION_MS );
			timersRef.current.push( timer );
		}

		if ( nextAdded.size > 0 || nextRemoved.size > 0 ) {
			removingKeysRef.current = nextRemovingKeys;
			setRemovingKeys( nextRemovingKeys );
			setDisplayFavorites( ( current ) =>
				mergeDisplayFavorites( current, favorites, nextRemovingKeys )
			);
		} else {
			setDisplayFavorites( favorites );
		}

		if ( nextRemoved.size > 0 ) {
			const timer = setTimeout( () => {
				const next = new Set( removingKeysRef.current );
				nextRemoved.forEach( ( key ) => next.delete( key ) );
				removingKeysRef.current = next;
				setRemovingKeys( next );
				setDisplayFavorites( ( current ) =>
					mergeDisplayFavorites(
						current,
						latestFavoritesRef.current,
						next
					)
				);
			}, FAVORITE_REMOVE_ANIMATION_MS );
			timersRef.current.push( timer );
		}

		if ( ! isResolving ) {
			hasCompletedInitialLoadRef.current = true;
		}
	}, [ favorites, isResolving ] );

	const items = useMemo(
		() => resolveFavoriteItems( displayFavorites, pages, collections ),
		[ displayFavorites, pages, collections ]
	);
	const sortableIds = useMemo(
		() => items.map( ( item ) => item.sortableId ),
		[ items ]
	);
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 5 } } )
	);

	useEffect( () => {
		return () => {
			timersRef.current.forEach( clearTimeout );
			timersRef.current = [];
		};
	}, [] );

	const handleDragEnd = ( { active, over } ) => {
		if ( isDisabled ) {
			return;
		}
		const activeId = String( active.id );
		const next = moveFavorite(
			favorites,
			activeId,
			over ? String( over.id ) : null
		);
		if ( next !== favorites ) {
			onReorder( next );
		}
	};

	const requestRemove = ( item ) => {
		if ( isDisabled ) {
			return;
		}
		onRemove( item );
	};
	const hasFavorites = favorites.length > 0;
	const isLoading =
		isResolving ||
		( hasFavorites && isResolvingItems && items.length === 0 );
	const showSkeleton = useDelayedFlag(
		isLoading,
		120,
		SKELETON_MIN_VISIBLE_MS
	);
	const isEmpty = ! isLoading && ! hasFavorites;

	return (
		<div className="cortext-sidebar__favorites">
			{ isLoading && showSkeleton ? (
				<SidebarListSkeleton itemCount={ favorites.length || 3 } />
			) : null }
			{ isEmpty ? (
				<p className="cortext-sidebar__empty cortext-sidebar__empty--inline">
					{ __(
						'Star a page from its title menu to pin it here.',
						'cortext'
					) }
				</p>
			) : null }
			{ items.length > 0 ? (
				<DndContext
					sensors={ sensors }
					collisionDetection={ closestCenter }
					onDragEnd={ handleDragEnd }
				>
					<SortableContext
						items={ sortableIds }
						strategy={ verticalListSortingStrategy }
					>
						<ul className="cortext-sidebar__list">
							{ items.map( ( item ) => (
								<SortableFavoriteRow
									key={ item.key }
									item={ {
										...item,
										isAdded: addedKeys.has(
											item.sortableId
										),
										isRemoving: removingKeys.has(
											item.sortableId
										),
									} }
									isDisabled={ isDisabled }
									onSelect={ onSelect }
									onRemove={ requestRemove }
								/>
							) ) }
						</ul>
					</SortableContext>
				</DndContext>
			) : null }
		</div>
	);
}
