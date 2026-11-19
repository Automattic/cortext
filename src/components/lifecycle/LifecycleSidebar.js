import { __, _n, sprintf } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import {
	Button,
	Icon,
	SearchControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { humanTimeDiff } from '@wordpress/date';
import { chevronLeft, trash as trashIcon } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import './LifecycleView.scss';

import { SidebarListSkeleton } from '../Skeleton';
import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../page-queries';
import { EMPTY_COUNTS, useSidebarLifecycleList } from './useLifecycleList';
import {
	filterTrashItems,
	originalPath,
	typeFilters,
	useTrashedByName,
} from './lifecycleItems';
import { TRASH_MARKER_META_KEYS } from './trashRoots';
import useTrashActions from './useLifecycleActions';
import {
	DocumentsProvider,
	documentTitle,
	useDocumentActions,
	useDocumentRecord,
} from '../../documents';
import { trashUri } from '../../router/useResolveEntity';

function TrashItem( {
	item,
	counts,
	path,
	byName,
	isSelected,
	error,
	onSelect,
	optionRef,
} ) {
	const { record, match } = item;
	const { title, listIcon } = useDocumentRecord( record );
	const details = [
		byName,
		record.trashed_at ? humanTimeDiff( record.trashed_at ) : '',
	].filter( Boolean );

	// The listbox owns focus and keyboard input through
	// `aria-activedescendant`, so the options only need a click handler.
	return (
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events
		<div
			ref={ optionRef }
			id={ `cortext-trash-item-${ record.id }` }
			className="cortext-trash__item"
			role="option"
			tabIndex={ -1 }
			aria-selected={ isSelected }
			data-cortext-document-id={ record.id }
			onClick={ () => onSelect( record.id ) }
		>
			<span className="cortext-trash__item-icon">{ listIcon( 16 ) }</span>
			<span className="cortext-trash__item-text">
				<span className="cortext-trash__item-title">
					<span>{ title }</span>
					{ counts.total > 0 && (
						<span className="cortext-trash__badge">
							{ sprintf(
								/* translators: %d: number of nested documents restored with this one */
								__( '+%d', 'cortext' ),
								counts.total
							) }
						</span>
					) }
				</span>
				{ match ? (
					<span className="cortext-trash__item-meta">
						{ sprintf(
							/* translators: %s: title of a nested document that matches the search */
							__( 'Contains “%s”', 'cortext' ),
							documentTitle( match )
						) }
					</span>
				) : (
					<span className="cortext-trash__item-meta">
						{ /* Where it hung from, as breadcrumbs. A long path gives way
						from its start, so the closest parent stays visible. */ }
						{ path.length > 0 && (
							<span className="cortext-trash__item-path">
								<bdi>{ path.join( ' / ' ) }</bdi>
							</span>
						) }
						{ details.length > 0 && (
							<span className="cortext-trash__item-details">
								{ path.length > 0 ? '\u00a0· ' : '' }
								{ details.join( ' · ' ) }
							</span>
						) }
					</span>
				) }
				{ error && (
					<span className="cortext-trash__item-error" role="alert">
						{ error.message }
					</span>
				) }
			</span>
		</div>
	);
}

function TrashSidebarList( { trashedDocumentsState, selectedId } ) {
	const navigate = useNavigate();
	// Every active page, not the sidebar tree, which only holds the branches
	// someone expanded: an item's parent can sit in a collapsed one.
	const { records: activePages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const trashedByName = useTrashedByName();
	const list = useSidebarLifecycleList(
		trashedDocumentsState,
		activePages,
		TRASH_MARKER_META_KEYS
	);
	const {
		ancestorById,
		busyId,
		descendantCountById,
		descendantsById,
		hasError,
		isLoading,
		roots,
		rowError,
		showSkeleton,
	} = list;
	const { restore, requestDelete, confirmDialog } = useTrashActions( list );
	const { emptyTrash } = useDocumentActions();
	const { createErrorNotice, createSuccessNotice } =
		useDispatch( 'core/notices' );
	const [ search, setSearch ] = useState( '' );
	const [ typeFilter, setTypeFilter ] = useState( 'all' );
	const [ isConfirmingEmpty, setIsConfirmingEmpty ] = useState( false );
	const [ isEmptying, setIsEmptying ] = useState( false );

	const handleEmptyTrash = useCallback( async () => {
		setIsConfirmingEmpty( false );
		setIsEmptying( true );
		try {
			const response = await emptyTrash();
			const count = response?.deleted?.length ?? 0;
			createSuccessNotice(
				sprintf(
					/* translators: %d: number of documents deleted for good */
					_n(
						'%d document deleted permanently.',
						'%d documents deleted permanently.',
						count,
						'cortext'
					),
					count
				),
				{ id: 'cortext-trash-emptied', type: 'snackbar' }
			);
		} catch ( error ) {
			createErrorNotice(
				error?.message ?? __( 'Could not empty Trash.', 'cortext' ),
				{ id: 'cortext-trash-emptied', type: 'snackbar' }
			);
		} finally {
			setIsEmptying( false );
		}
	}, [ createErrorNotice, createSuccessNotice, emptyTrash ] );

	const items = useMemo(
		() => filterTrashItems( roots, descendantsById, search, typeFilter ),
		[ descendantsById, roots, search, typeFilter ]
	);

	// When the selected item leaves the list (restored, deleted, filtered
	// out), select the one that took its place instead of jumping to the top.
	const lastIndexRef = useRef( 0 );
	const selectedIndex = items.findIndex(
		( item ) => item.record.id === selectedId
	);
	const selectedItem =
		items[
			selectedIndex >= 0
				? selectedIndex
				: Math.min( lastIndexRef.current, items.length - 1 )
		] ?? null;
	useEffect( () => {
		if ( selectedIndex >= 0 ) {
			lastIndexRef.current = selectedIndex;
		}
	}, [ selectedIndex ] );

	// Selection lives in the URL so the canvas can show it and it survives a
	// reload, but it replaces the history entry: Back leaves Trash instead of
	// stepping through items.
	const select = useCallback(
		( id ) =>
			navigate( {
				to: '/$',
				params: { _splat: trashUri( id ) },
				replace: true,
			} ),
		[ navigate ]
	);
	const selectedItemId = selectedItem?.record.id ?? null;
	// Wait for the first response: before it, an empty list only means the
	// list hasn't loaded, and dropping the selection would lose the URL's item.
	const isTrashEmpty =
		trashedDocumentsState.hasResolved && ! hasError && roots.length === 0;
	useEffect( () => {
		if ( isLoading ) {
			return;
		}
		if ( selectedItemId && selectedItemId !== selectedId ) {
			select( selectedItemId );
			return;
		}
		// Nothing left to show: let the canvas say Trash is empty.
		if ( isTrashEmpty && selectedId ) {
			navigate( {
				to: '/$',
				params: { _splat: trashUri() },
				replace: true,
			} );
		}
	}, [
		isLoading,
		isTrashEmpty,
		navigate,
		select,
		selectedId,
		selectedItemId,
	] );

	// Clicking an item moves focus to the list, so the keyboard shortcuts
	// work right after.
	const listboxRef = useRef( null );
	const selectFromPointer = useCallback(
		( id ) => {
			listboxRef.current?.focus();
			select( id );
		},
		[ select ]
	);

	// Keep the selected item in view by scrolling the list alone.
	// `scrollIntoView` would also scroll the sidebar's clipped view container
	// while this view slides in, leaving the list shifted out of sight.
	const scrollRef = useRef( null );
	const optionRefs = useRef( new Map() );
	useEffect( () => {
		const container = scrollRef.current;
		const option = optionRefs.current.get( selectedItemId );
		if ( ! container || ! option ) {
			return;
		}
		// The scroll container is positioned, so offsets are relative to it.
		const top = option.offsetTop;
		const bottom = top + option.offsetHeight;
		if ( top < container.scrollTop ) {
			container.scrollTop = top;
		} else if ( bottom > container.scrollTop + container.clientHeight ) {
			container.scrollTop = bottom - container.clientHeight;
		}
	}, [ selectedItemId ] );

	const onListKeyDown = useCallback(
		( event ) => {
			if ( ! selectedItem || busyId ) {
				return;
			}
			const index = items.indexOf( selectedItem );
			let next = null;
			switch ( event.key ) {
				case 'ArrowDown':
					next = items[ Math.min( index + 1, items.length - 1 ) ];
					break;
				case 'ArrowUp':
					next = items[ Math.max( index - 1, 0 ) ];
					break;
				case 'Home':
					next = items[ 0 ];
					break;
				case 'End':
					next = items[ items.length - 1 ];
					break;
				case 'Enter':
					event.preventDefault();
					restore( selectedItem.record );
					return;
				case 'Backspace':
				case 'Delete':
					event.preventDefault();
					requestDelete( selectedItem.record );
					return;
				default:
					return;
			}
			event.preventDefault();
			select( next.record.id );
		},
		[ busyId, items, requestDelete, restore, select, selectedItem ]
	);

	let listContent;
	if ( isLoading ) {
		listContent = showSkeleton ? (
			<SidebarListSkeleton itemCount={ 6 } />
		) : null;
	} else if ( hasError ) {
		listContent = (
			<div className="cortext-trash__message" role="alert">
				<p>{ __( 'Could not load Trash.', 'cortext' ) }</p>
				<Button
					variant="secondary"
					onClick={ trashedDocumentsState.refresh }
				>
					{ __( 'Retry', 'cortext' ) }
				</Button>
			</div>
		);
	} else if ( roots.length === 0 ) {
		listContent = (
			<p className="cortext-trash__message">
				{ __( 'Trash is empty.', 'cortext' ) }
			</p>
		);
	} else if ( items.length === 0 ) {
		listContent = (
			<p className="cortext-trash__message">
				{ __( 'Nothing matches.', 'cortext' ) }
			</p>
		);
	} else {
		listContent = (
			<div
				ref={ listboxRef }
				className="cortext-trash__items"
				role="listbox"
				tabIndex={ 0 }
				aria-label={ __( 'Items in Trash', 'cortext' ) }
				aria-activedescendant={
					selectedItemId
						? `cortext-trash-item-${ selectedItemId }`
						: undefined
				}
				onKeyDown={ onListKeyDown }
			>
				{ items.map( ( item ) => (
					<TrashItem
						key={ item.record.id }
						optionRef={ ( node ) =>
							node
								? optionRefs.current.set( item.record.id, node )
								: optionRefs.current.delete( item.record.id )
						}
						item={ item }
						counts={
							descendantCountById.get( item.record.id ) ??
							EMPTY_COUNTS
						}
						path={ originalPath( item.record, ancestorById ) }
						byName={ trashedByName( item.record ) }
						isSelected={ item.record.id === selectedItemId }
						error={
							rowError?.id === item.record.id ? rowError : null
						}
						onSelect={ selectFromPointer }
					/>
				) ) }
			</div>
		);
	}

	return (
		<>
			<div className="cortext-sidebar__section-header cortext-trash__header">
				<h2 className="cortext-sidebar__section-title">
					{ __( 'Trash', 'cortext' ) }
					{ roots.length > 0 && (
						<span className="cortext-trash__count">
							{ roots.length }
						</span>
					) }
				</h2>
				{ roots.length > 0 && (
					<div className="cortext-sidebar__section-actions">
						<Button
							className="cortext-sidebar__section-action cortext-trash__empty-button"
							icon={ trashIcon }
							size="small"
							label={ __( 'Empty Trash…', 'cortext' ) }
							disabled={ isEmptying }
							onClick={ () => setIsConfirmingEmpty( true ) }
						/>
					</div>
				) }
			</div>
			{ roots.length > 0 && (
				<div className="cortext-trash__filters">
					<SearchControl
						__nextHasNoMarginBottom
						value={ search }
						onChange={ setSearch }
						label={ __( 'Search Trash', 'cortext' ) }
						placeholder={ __( 'Search Trash', 'cortext' ) }
						size="compact"
					/>
					<div
						className="cortext-trash__type-filters"
						role="group"
						aria-label={ __( 'Type', 'cortext' ) }
					>
						{ typeFilters().map( ( filter ) => (
							<Button
								key={ filter.value }
								className="cortext-trash__type-filter"
								size="small"
								isPressed={ typeFilter === filter.value }
								onClick={ () => setTypeFilter( filter.value ) }
							>
								{ filter.label }
							</Button>
						) ) }
					</div>
				</div>
			) }
			<div ref={ scrollRef } className="cortext-trash__list-scroll">
				{ listContent }
			</div>
			{ items.length > 0 && (
				<p className="cortext-trash__shortcuts" aria-hidden="true">
					<span>
						<kbd>↵</kbd> { __( 'restore', 'cortext' ) }
					</span>
					<span>
						<kbd>⌫</kbd> { __( 'delete', 'cortext' ) }
					</span>
					<span>
						<kbd>↑↓</kbd> { __( 'move', 'cortext' ) }
					</span>
				</p>
			) }
			{ confirmDialog }
			{ isConfirmingEmpty && (
				<ConfirmDialog
					onConfirm={ handleEmptyTrash }
					onCancel={ () => setIsConfirmingEmpty( false ) }
					confirmButtonText={ __( 'Empty Trash', 'cortext' ) }
				>
					{ sprintf(
						/* translators: %d: number of items in Trash */
						_n(
							"Delete %d item in Trash permanently? This can't be undone.",
							"Delete all %d items in Trash permanently? This can't be undone.",
							roots.length,
							'cortext'
						),
						roots.length
					) }
				</ConfirmDialog>
			) }
		</>
	);
}

/**
 * The sidebar while Trash is open: a way back, how much is in Trash and a way
 * to empty it, then the trashed items with search, type filters, and keyboard
 * shortcuts. The selected item opens in the canvas.
 *
 * Only cascade roots are listed. Documents trashed along with a parent or a
 * collection come back, or go away, with it.
 *
 * @param {Object}   props
 * @param {boolean}  props.collapsed             Whether the sidebar is collapsed.
 * @param {Function} props.onBack                Leaves Trash.
 * @param {Object}   props.trashedDocumentsState Trashed document query state.
 * @param {?number}  props.selectedId            Item selected in the URL.
 */
export default function TrashSidebar( {
	collapsed,
	onBack,
	trashedDocumentsState,
	selectedId,
} ) {
	return (
		<div className="cortext-sidebar__trash">
			<div className="cortext-sidebar__quick-actions cortext-sidebar__settings-nav">
				<Button
					className="cortext-sidebar__quick-action cortext-sidebar__settings-back"
					label={ __( 'Back', 'cortext' ) }
					onClick={ onBack }
				>
					<Icon icon={ chevronLeft } size={ 16 } />
					{ ! collapsed && <span>{ __( 'Back', 'cortext' ) }</span> }
				</Button>
			</div>
			{ ! collapsed && (
				<DocumentsProvider>
					<TrashSidebarList
						trashedDocumentsState={ trashedDocumentsState }
						selectedId={ selectedId }
					/>
				</DocumentsProvider>
			) }
		</div>
	);
}
