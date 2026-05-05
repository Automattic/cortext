import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	TextControl,
} from '@wordpress/components';
import { chevronRight, moreVertical, plus } from '@wordpress/icons';
import { useDraggable, useDroppable } from '@dnd-kit/core';

const GRID_UNIT = 20; // matches $grid-unit-20 in index.scss

// A single page in the sidebar tree plus its rendered subtree.
//
// Three overlay strips per row (top 25% / middle 50% / bottom 25%) act as
// separate droppables. dnd-kit hit-tests their bounding boxes during a drag,
// so we can leave pointer-events off them and not interfere with normal
// clicks when nothing is being dragged.
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
	autoRenameId, // page id that should immediately enter rename mode
	onAutoRenameConsumed,
	// True when an ancestor is collapsed: this row and its subtree are
	// visually clipped but stay mounted for the expand/collapse animation.
	// Drop targets must be off so dnd-kit's pointerWithin doesn't hit
	// invisible descendants and route a drop to the wrong row.
	isHidden = false,
} ) {
	const { page, children } = node;
	const hasChildren = children.length > 0;
	const isExpanded = expandedIds.has( page.id );
	const isSelected = page.id === selectedId;
	const isBeingDragged = draggedId === page.id;

	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ draftTitle, setDraftTitle ] = useState( '' );
	const renameInputRef = useRef( null );

	// Start rename automatically if the parent asked for it (new page flow).
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

	// Focus the rename input whenever rename mode is entered. The ref sits on
	// the wrapper div (TextControl doesn't forward refs to its input), so we
	// have to reach in for the actual input element.
	useEffect( () => {
		if ( isRenaming && renameInputRef.current ) {
			const input = renameInputRef.current.querySelector( 'input' );
			input?.focus();
			input?.select();
		}
	}, [ isRenaming ] );

	// --- Drag source ---
	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
	} = useDraggable( {
		id: `page:${ page.id }`,
		data: { pageId: page.id },
	} );

	// --- Drop zones (three strips overlaying the row) ---
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

					{ isRenaming ? (
						<div
							ref={ renameInputRef }
							className="cortext-sidebar__rename"
						>
							<TextControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
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
								className={
									'cortext-sidebar__menu' +
									( isOpen ? ' is-opened' : '' )
								}
								icon={ moreVertical }
								size="small"
								label={ sprintf(
									/* translators: %s: page title */
									__( 'Actions for %s', 'cortext' ),
									title
								) }
								onClick={ onToggle }
								aria-expanded={ isOpen }
								onPointerDown={ ( e ) => e.stopPropagation() }
							/>
						) }
						renderContent={ ( { onClose } ) => (
							<MenuGroup>
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

					{ /* Drop zones overlay the row. pointer-events are off
					     so they don't block clicks when idle. */ }
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
						{ children.map( ( child ) => (
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
								autoRenameId={ autoRenameId }
								onAutoRenameConsumed={ onAutoRenameConsumed }
								isHidden={ isHidden || ! isExpanded }
							/>
						) ) }
					</ul>
				</div>
			) }
		</li>
	);
}
