import { __, sprintf } from '@wordpress/i18n';
import { Button, Icon, Spinner } from '@wordpress/components';
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
import { collectionTitle } from './CollectionRow';
import { collectDescendants } from './pages-tree';
import { computeUri } from '../router/useResolveEntity';
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

function pageTitle( page ) {
	return page.title?.rendered?.trim() || __( '(untitled)', 'cortext' );
}

export function favoriteKey( favorite ) {
	return `favorite:${ favorite.kind }:${ Number( favorite.id ) }`;
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

export function filterFavoritesForTrashedPage( favorites, pageId, pages ) {
	const trashedPageIds = new Set( [
		Number( pageId ),
		...collectDescendants( Number( pageId ), pages ),
	] );

	return favorites.filter(
		( favorite ) =>
			favorite.kind !== 'page' ||
			! trashedPageIds.has( Number( favorite.id ) )
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
					title: page ? pageTitle( page ) : __( 'Page', 'cortext' ),
					path: page ? computeUri( page, 'page' ) : favorite.path,
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
						? collectionTitle( collection )
						: __( 'Collection', 'cortext' ),
					path: collection
						? computeUri( collection, 'collection' )
						: favorite.path,
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
		return (
			<PageIcon
				icon={ item.record?.meta?.cortext_page_icon ?? '' }
				size={ 16 }
			/>
		);
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
	const timersRef = useRef( [] );

	useEffect( () => {
		latestFavoritesRef.current = favorites;
		const currentKeys = new Set(
			favorites.map( ( favorite ) => favoriteKey( favorite ) )
		);
		const previousKeys = previousKeysRef.current;
		previousKeysRef.current = currentKeys;

		if ( ! previousKeys ) {
			setDisplayFavorites( favorites );
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

		if ( nextAdded.size > 0 ) {
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
	}, [ favorites ] );

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

	if ( ! isResolving && displayFavorites.length === 0 ) {
		return null;
	}

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

	return (
		<div className="cortext-sidebar__favorites">
			<div className="cortext-sidebar__section-header">
				<h2 className="cortext-sidebar__section-title">
					{ __( 'Favorites', 'cortext' ) }
				</h2>
			</div>
			{ ( isResolving || isResolvingItems ) && items.length === 0 ? (
				<div className="cortext-sidebar__loading">
					<Spinner />
				</div>
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
