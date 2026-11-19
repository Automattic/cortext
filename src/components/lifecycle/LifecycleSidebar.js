import { __, sprintf } from '@wordpress/i18n';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { Button, Icon, SearchControl } from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { humanTimeDiff } from '@wordpress/date';
import { chevronLeft } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import './LifecycleView.scss';

import { SidebarListSkeleton } from '../Skeleton';
import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../page-queries';
import useLifecycleList, { EMPTY_COUNTS } from './useLifecycleList';
import {
	filterLifecycleItems,
	originalPath,
	typeFilters,
	useLifecycleByName,
} from './lifecycleItems';
import useLifecycleActions from './useLifecycleActions';
import {
	DocumentsProvider,
	documentTitle,
	useDocumentRecord,
} from '../../documents';

function LifecycleItem( {
	state,
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
		record[ state.atKey ] ? humanTimeDiff( record[ state.atKey ] ) : '',
	].filter( Boolean );

	// The listbox owns focus and keyboard input through
	// `aria-activedescendant`, so the options only need a click handler.
	return (
		// eslint-disable-next-line jsx-a11y/click-events-have-key-events
		<div
			ref={ optionRef }
			id={ `cortext-lifecycle-item-${ record.id }` }
			className="cortext-lifecycle__item"
			role="option"
			tabIndex={ -1 }
			aria-selected={ isSelected }
			data-cortext-document-id={ record.id }
			onClick={ () => onSelect( record.id ) }
		>
			<span className="cortext-lifecycle__item-icon">
				{ listIcon( 16 ) }
			</span>
			<span className="cortext-lifecycle__item-text">
				<span className="cortext-lifecycle__item-title">
					<span>{ title }</span>
					{ counts.total > 0 && (
						<span className="cortext-lifecycle__badge">
							{ sprintf(
								/* translators: %d: number of nested documents restored with this one */
								__( '+%d', 'cortext' ),
								counts.total
							) }
						</span>
					) }
				</span>
				{ match ? (
					<span className="cortext-lifecycle__item-meta">
						{ sprintf(
							/* translators: %s: title of a nested document that matches the search */
							__( 'Contains “%s”', 'cortext' ),
							documentTitle( match )
						) }
					</span>
				) : (
					<span className="cortext-lifecycle__item-meta">
						{ /* Where it hung from, as breadcrumbs. A long path gives way
						from its start, so the closest parent stays visible. */ }
						{ path.length > 0 && (
							<span className="cortext-lifecycle__item-path">
								<bdi>{ path.join( ' / ' ) }</bdi>
							</span>
						) }
						{ details.length > 0 && (
							<span className="cortext-lifecycle__item-details">
								{ path.length > 0 ? '\u00a0· ' : '' }
								{ details.join( ' · ' ) }
							</span>
						) }
					</span>
				) }
				{ error && (
					<span
						className="cortext-lifecycle__item-error"
						role="alert"
					>
						{ error.message }
					</span>
				) }
			</span>
		</div>
	);
}

function LifecycleSidebarList( { state, documentsState, selectedId } ) {
	const navigate = useNavigate();
	// Every active page, not the sidebar tree, which only holds the branches
	// someone expanded: an item's parent can sit in a collapsed one.
	const { records: activePages } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const byName = useLifecycleByName( state.byKey );
	const list = useLifecycleList(
		documentsState,
		activePages,
		state.markerKeys
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
	const { restore, requestSecondary, confirmDialog } = useLifecycleActions(
		state,
		list
	);
	const copy = state.copy();
	const { HeaderAction } = state;
	const [ search, setSearch ] = useState( '' );
	const [ typeFilter, setTypeFilter ] = useState( 'all' );

	const items = useMemo(
		() =>
			filterLifecycleItems( roots, descendantsById, search, typeFilter ),
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
	// reload, but it replaces the history entry: Back leaves the view instead
	// of stepping through items.
	const { uri } = state;
	const select = useCallback(
		( id ) =>
			navigate( {
				to: '/$',
				params: { _splat: uri( id ) },
				replace: true,
			} ),
		[ navigate, uri ]
	);
	const selectedItemId = selectedItem?.record.id ?? null;
	// Wait for the first response: before it, an empty list only means the
	// list hasn't loaded, and dropping the selection would lose the URL's item.
	const isListEmpty =
		documentsState.hasResolved && ! hasError && roots.length === 0;
	useEffect( () => {
		if ( isLoading ) {
			return;
		}
		if ( selectedItemId && selectedItemId !== selectedId ) {
			select( selectedItemId );
			return;
		}
		// Nothing left to show: let the canvas say the view is empty.
		if ( isListEmpty && selectedId ) {
			navigate( {
				to: '/$',
				params: { _splat: uri() },
				replace: true,
			} );
		}
	}, [
		isListEmpty,
		isLoading,
		navigate,
		select,
		selectedId,
		selectedItemId,
		uri,
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
					requestSecondary( selectedItem.record );
					return;
				default:
					return;
			}
			event.preventDefault();
			select( next.record.id );
		},
		[ busyId, items, requestSecondary, restore, select, selectedItem ]
	);

	let listContent;
	if ( isLoading ) {
		listContent = showSkeleton ? (
			<SidebarListSkeleton itemCount={ 6 } />
		) : null;
	} else if ( hasError ) {
		listContent = (
			<div className="cortext-lifecycle__message" role="alert">
				<p>{ copy.loadError }</p>
				<Button variant="secondary" onClick={ documentsState.refresh }>
					{ __( 'Retry', 'cortext' ) }
				</Button>
			</div>
		);
	} else if ( roots.length === 0 ) {
		listContent = (
			<p className="cortext-lifecycle__message">{ copy.emptyList }</p>
		);
	} else if ( items.length === 0 ) {
		listContent = (
			<p className="cortext-lifecycle__message">
				{ __( 'Nothing matches.', 'cortext' ) }
			</p>
		);
	} else {
		listContent = (
			<div
				ref={ listboxRef }
				className="cortext-lifecycle__items"
				role="listbox"
				tabIndex={ 0 }
				aria-label={ copy.listLabel }
				aria-activedescendant={
					selectedItemId
						? `cortext-lifecycle-item-${ selectedItemId }`
						: undefined
				}
				onKeyDown={ onListKeyDown }
			>
				{ items.map( ( item ) => (
					<LifecycleItem
						key={ item.record.id }
						state={ state }
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
						byName={ byName( item.record ) }
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
			<div className="cortext-sidebar__section-header cortext-lifecycle__header">
				<h2 className="cortext-sidebar__section-title">
					{ copy.title }
					{ roots.length > 0 && (
						<span className="cortext-lifecycle__count">
							{ roots.length }
						</span>
					) }
				</h2>
				{ HeaderAction && roots.length > 0 && (
					<div className="cortext-sidebar__section-actions">
						<HeaderAction count={ roots.length } />
					</div>
				) }
			</div>
			{ roots.length > 0 && (
				<div className="cortext-lifecycle__filters">
					<SearchControl
						__nextHasNoMarginBottom
						value={ search }
						onChange={ setSearch }
						label={ copy.searchLabel }
						placeholder={ copy.searchLabel }
						size="compact"
					/>
					<div
						className="cortext-lifecycle__type-filters"
						role="group"
						aria-label={ __( 'Type', 'cortext' ) }
					>
						{ typeFilters().map( ( filter ) => (
							<Button
								key={ filter.value }
								className="cortext-lifecycle__type-filter"
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
			<div ref={ scrollRef } className="cortext-lifecycle__list-scroll">
				{ listContent }
			</div>
			{ items.length > 0 && (
				<p className="cortext-lifecycle__shortcuts" aria-hidden="true">
					<span>
						<kbd>↵</kbd> { copy.primaryShortcut }
					</span>
					<span>
						<kbd>⌫</kbd> { copy.secondaryShortcut }
					</span>
					<span>
						<kbd>↑↓</kbd> { __( 'move', 'cortext' ) }
					</span>
				</p>
			) }
			{ confirmDialog }
		</>
	);
}

/**
 * The sidebar while a lifecycle view (Trash, Archived) is open: a way back,
 * how many items the view holds and its header action, then the items with
 * search, type filters, and keyboard shortcuts. The selected item opens in the
 * canvas.
 *
 * Only cascade roots are listed. Documents that went along with a parent or a
 * collection come back, or go away, with it.
 *
 * @param {Object}   props
 * @param {Object}   props.state          Lifecycle state from `lifecycleStates`.
 * @param {boolean}  props.collapsed      Whether the sidebar is collapsed.
 * @param {Function} props.onBack         Leaves the view.
 * @param {Object}   props.documentsState The state's document query state.
 * @param {?number}  props.selectedId     Item selected in the URL.
 */
export default function LifecycleSidebar( {
	state,
	collapsed,
	onBack,
	documentsState,
	selectedId,
} ) {
	return (
		<div className="cortext-sidebar__lifecycle">
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
					<LifecycleSidebarList
						// A fresh list per state, so search, filters and the
						// remembered position don't carry over.
						key={ state.name }
						state={ state }
						documentsState={ documentsState }
						selectedId={ selectedId }
					/>
				</DocumentsProvider>
			) }
		</div>
	);
}
