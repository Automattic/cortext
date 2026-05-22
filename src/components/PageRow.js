import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	TextControl,
} from '@wordpress/components';
import {
	chevronRight,
	home as homeIcon,
	moreVertical,
	plus,
	starEmpty,
	starFilled,
} from '@wordpress/icons';
import { useDraggable, useDroppable } from '@dnd-kit/core';

import PageIcon from './PageIcon';

const GRID_UNIT = 20; // Matches $grid-unit-20 in index.scss.

// A page row in the sidebar tree, including its rendered children.
//
// Three overlay strips per row act as separate drop targets. dnd-kit checks
// their boxes during a drag, while pointer-events stay off for normal clicks.
export default function PageRow( {
	node,
	depth,
	selectedId,
	expandedIds,
	draggedId,
	activeDrop, // { zone, targetId } | null
	onSelect,
	onToggleExpand,
	onCreateChild,
	onRename,
	onDuplicate,
	onDelete,
	isFavorite = false,
	isFavoriteDisabled = false,
	onToggleFavorite,
	onSetHome,
	home,
	isHomeUpdating = false,
	autoRenameId, // page id that should immediately enter rename mode
	onAutoRenameConsumed,
	// Ancestor is collapsed: keep the row mounted for animation, but disable
	// drop targets so pointerWithin does not hit invisible descendants.
	isHidden = false,
	// tech-debt.md#53: Sidebar owns collection actions, so nested collection
	// rows are rendered by a callback from the parent.
	renderCollectionRow,
} ) {
	const { page, children } = node;
	const hasChildren = children.length > 0;
	const isExpanded = expandedIds.has( page.id );
	const isSelected = page.id === selectedId;
	const pageIsFavorite =
		typeof isFavorite === 'function' ? isFavorite( page.id ) : isFavorite;
	const isHome = home?.kind === 'page' && home.id === page.id;
	const isBeingDragged = draggedId === page.id;

	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ draftTitle, setDraftTitle ] = useState( '' );
	const renameInputRef = useRef( null );
	const iconMeta = page.meta?.cortext_document_icon ?? '';

	// New pages enter rename mode as soon as their row renders.
	useEffect( () => {
		if ( autoRenameId === page.id ) {
			setDraftTitle( page.title?.raw ?? page.title?.rendered ?? '' );
			setIsRenaming( true );
			onAutoRenameConsumed?.();
		}
	}, [
		autoRenameId,
		page.id,
		page.title?.raw,
		page.title?.rendered,
		onAutoRenameConsumed,
	] );

	// TextControl does not forward refs to its input, so focus the inner input
	// after rename mode opens.
	useEffect( () => {
		if ( isRenaming && renameInputRef.current ) {
			const input = renameInputRef.current.querySelector( 'input' );
			input?.focus();
			input?.select();
		}
	}, [ isRenaming ] );

	// Drag source.
	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
	} = useDraggable( {
		id: `page:${ page.id }`,
		data: { pageId: page.id },
	} );

	// Drop zones.
	const dropBefore = useDroppable( {
		id: `before:${ page.id }`,
		data: { zone: 'before', pageId: page.id },
		disabled: isHidden,
	} );
	const dropInside = useDroppable( {
		id: `inside:${ page.id }`,
		data: { zone: 'inside', pageId: page.id },
		disabled: isHidden,
	} );
	const dropAfter = useDroppable( {
		id: `after:${ page.id }`,
		data: { zone: 'after', pageId: page.id },
		disabled: isHidden,
	} );

	const isDropTarget = activeDrop && activeDrop.targetId === page.id;

	const rowClasses = [ 'cortext-sidebar__row' ];
	if ( isSelected ) {
		rowClasses.push( 'is-selected' );
	}
	if ( isBeingDragged ) {
		rowClasses.push( 'is-dragging' );
	}
	if ( isDropTarget ) {
		rowClasses.push( `is-drop-${ activeDrop.zone }` );
	}

	const title = page.title?.rendered?.trim() || __( '(untitled)', 'cortext' );
	function commitRename() {
		const next = draftTitle.trim();
		if ( next && next !== ( page.title?.raw ?? page.title?.rendered ) ) {
			onRename( page.id, next );
		}
		setIsRenaming( false );
	}

	function cancelRename() {
		setIsRenaming( false );
	}

	function startRename() {
		setDraftTitle( page.title?.raw ?? page.title?.rendered ?? '' );
		setIsRenaming( true );
	}

	return (
		<li className="cortext-sidebar__node">
			<div
				className="cortext-sidebar__row-wrapper"
				style={ { '--cortext-depth': depth } }
			>
				<div
					ref={ setDragRef }
					className={ rowClasses.join( ' ' ) }
					style={ {
						paddingInlineStart: `${ depth * GRID_UNIT }px`,
					} }
					{ ...attributes }
					{ ...listeners }
				>
					{ hasChildren ? (
						<Button
							className={
								'cortext-sidebar__chevron' +
								( isExpanded ? ' is-expanded' : '' )
							}
							icon={ chevronRight }
							size="small"
							label={
								isExpanded
									? __( 'Collapse', 'cortext' )
									: __( 'Expand', 'cortext' )
							}
							onClick={ ( e ) => {
								e.stopPropagation();
								onToggleExpand( page.id );
							} }
							onPointerDown={ ( e ) => e.stopPropagation() }
						/>
					) : (
						<span
							className="cortext-sidebar__chevron cortext-sidebar__chevron--placeholder"
							aria-hidden="true"
						/>
					) }

					<span className="cortext-sidebar__icon" aria-hidden="true">
						<PageIcon icon={ iconMeta } size={ 16 } />
					</span>

					{ isRenaming ? (
						<div
							ref={ renameInputRef }
							className="cortext-sidebar__rename"
						>
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								size="compact"
								value={ draftTitle }
								onChange={ setDraftTitle }
								onBlur={ commitRename }
								onKeyDown={ ( e ) => {
									e.stopPropagation();
									if ( e.key === 'Enter' ) {
										e.preventDefault();
										commitRename();
									} else if ( e.key === 'Escape' ) {
										e.preventDefault();
										cancelRename();
									}
								} }
								onPointerDown={ ( e ) => e.stopPropagation() }
							/>
						</div>
					) : (
						<Button
							className="cortext-sidebar__title"
							size="compact"
							onClick={ () => onSelect( page.id ) }
							isPressed={ isSelected }
						>
							{ title }
						</Button>
					) }

					<Button
						className="cortext-sidebar__add-child"
						icon={ plus }
						size="small"
						label={ sprintf(
							/* translators: %s: parent page title */
							__( 'Add a page inside %s', 'cortext' ),
							title
						) }
						onClick={ ( e ) => {
							e.stopPropagation();
							onCreateChild( page.id );
						} }
						onPointerDown={ ( e ) => e.stopPropagation() }
					/>

					<Dropdown
						popoverProps={ { placement: 'bottom-end' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<Button
								className="cortext-sidebar__menu"
								icon={ moreVertical }
								size="small"
								label={ sprintf(
									/* translators: %s: page title */
									__( 'Actions for %s', 'cortext' ),
									title
								) }
								onClick={ onToggle }
								isPressed={ isOpen }
								aria-expanded={ isOpen }
								onPointerDown={ ( e ) => e.stopPropagation() }
							/>
						) }
						renderContent={ ( { onClose } ) => (
							<MenuGroup>
								<MenuItem
									icon={
										pageIsFavorite ? starFilled : starEmpty
									}
									disabled={ isFavoriteDisabled }
									onClick={ () => {
										onToggleFavorite?.( page.id );
										onClose();
									} }
								>
									{ pageIsFavorite
										? __(
												'Remove from favorites',
												'cortext'
										  )
										: __( 'Add to favorites', 'cortext' ) }
								</MenuItem>
								<MenuItem
									icon={ homeIcon }
									disabled={ isHome || isHomeUpdating }
									onClick={ () => {
										onSetHome( page.id );
										onClose();
									} }
								>
									{ isHome
										? __( 'Home', 'cortext' )
										: __( 'Set as home', 'cortext' ) }
								</MenuItem>
								<MenuItem
									icon="edit"
									onClick={ () => {
										startRename();
										onClose();
									} }
								>
									{ __( 'Rename', 'cortext' ) }
								</MenuItem>
								<MenuItem
									icon="admin-page"
									onClick={ () => {
										onDuplicate( page.id );
										onClose();
									} }
								>
									{ __( 'Duplicate', 'cortext' ) }
								</MenuItem>
								<MenuItem
									icon="trash"
									isDestructive
									onClick={ () => {
										onDelete( page.id );
										onClose();
									} }
								>
									{ __( 'Trash', 'cortext' ) }
								</MenuItem>
							</MenuGroup>
						) }
					/>

					{ /* Drop zones cover the row but stay click-through. */ }
					<div
						ref={ dropBefore.setNodeRef }
						className="cortext-sidebar__drop-zone cortext-sidebar__drop-zone--before"
						aria-hidden="true"
					/>
					<div
						ref={ dropInside.setNodeRef }
						className="cortext-sidebar__drop-zone cortext-sidebar__drop-zone--inside"
						aria-hidden="true"
					/>
					<div
						ref={ dropAfter.setNodeRef }
						className="cortext-sidebar__drop-zone cortext-sidebar__drop-zone--after"
						aria-hidden="true"
					/>
				</div>
			</div>

			{ hasChildren && (
				<div
					className={
						'cortext-sidebar__children-wrapper' +
						( isExpanded ? ' is-expanded' : '' )
					}
					{ ...( isExpanded ? {} : { inert: '' } ) }
				>
					<ul className="cortext-sidebar__children">
						{ children.map( ( child ) => {
							if (
								renderCollectionRow &&
								child.page.type === 'crtxt_collection'
							) {
								return renderCollectionRow(
									child.page,
									depth + 1
								);
							}
							return (
								<PageRow
									key={ child.page.id }
									node={ child }
									depth={ depth + 1 }
									selectedId={ selectedId }
									expandedIds={ expandedIds }
									draggedId={ draggedId }
									activeDrop={ activeDrop }
									onSelect={ onSelect }
									onToggleExpand={ onToggleExpand }
									onCreateChild={ onCreateChild }
									onRename={ onRename }
									onDuplicate={ onDuplicate }
									onDelete={ onDelete }
									isFavorite={ isFavorite }
									isFavoriteDisabled={ isFavoriteDisabled }
									onToggleFavorite={ onToggleFavorite }
									onSetHome={ onSetHome }
									home={ home }
									isHomeUpdating={ isHomeUpdating }
									autoRenameId={ autoRenameId }
									onAutoRenameConsumed={
										onAutoRenameConsumed
									}
									isHidden={ isHidden || ! isExpanded }
									renderCollectionRow={ renderCollectionRow }
								/>
							);
						} ) }
					</ul>
				</div>
			) }
		</li>
	);
}
