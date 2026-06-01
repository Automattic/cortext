import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	TextControl,
} from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import {
	chevronRight,
	home as homeIcon,
	moreVertical,
	plus,
	starEmpty,
	starFilled,
} from '@wordpress/icons';
import { useDraggable, useDroppable } from '@dnd-kit/core';

import { collectionIcon } from '../cortextIcons';
import { useDocumentActions, useDocumentRecord } from '../../documents';

/**
 * Sidebar row shared by pages and collections. The document layer tells it
 * which controls to show: tree controls, child rows, drop zones, and the
 * add-child button.
 *
 * `record` is the raw entity. `childNodes` comes from the page tree when the
 * row can have children; descendants render through this same component.
 *
 * `isFavorite`, `isHome`, and `isSelected` can be predicates. Sidebar owns
 * those checks, so the row does not need to know which list or route id to
 * inspect for each kind.
 *
 * @param {Object}                            props
 * @param {Object}                            props.record                    Raw document record.
 * @param {Array}                             [props.childNodes]              Child tree nodes (hierarchy only).
 * @param {number}                            [props.depth]                   Nesting depth, 0 at the root.
 * @param {Set<number>}                       props.expandedIds               Currently expanded row ids.
 * @param {?number}                           [props.draggedId]               Id of the row being dragged.
 * @param {?{zone: string, targetId: number}} [props.activeDrop]              Active drop target metadata.
 * @param {boolean}                           [props.isHidden]                True when an ancestor is collapsed.
 * @param {Function|boolean}                  props.isSelected                Selection predicate or flag.
 * @param {Function}                          props.onSelect                  Called with the record on title click.
 * @param {Function}                          props.onToggleExpand            Called with the record id on chevron click.
 * @param {Function}                          props.onCreateChild             Called with the parent id from the add-child button.
 * @param {Function}                          [props.onCreateChildCollection] Called with the parent id to create a child collection.
 * @param {Function|boolean}                  props.isFavorite                Favorite predicate or flag.
 * @param {boolean}                           [props.isFavoriteDisabled]      Disable favorite toggling.
 * @param {Function}                          props.onToggleFavorite          Called with the record from the menu.
 * @param {Function|boolean}                  props.isHome                    Home predicate or flag.
 * @param {Function}                          props.onSetHome                 Called with the record from the menu.
 * @param {boolean}                           [props.isHomeUpdating]          Disable set-as-home while a save is in flight.
 * @param {?number}                           [props.autoRenameId]            Row id that should immediately enter rename mode.
 * @param {Function}                          props.onAutoRenameConsumed      Called once rename mode has opened.
 */
export default function DocumentRow( {
	record,
	childNodes = [],
	depth = 0,
	expandedIds,
	draggedId = null,
	activeDrop = null,
	isHidden = false,
	isSelected,
	onSelect,
	onToggleExpand,
	onCreateChild,
	onCreateChildCollection,
	isFavorite,
	isFavoriteDisabled = false,
	onToggleFavorite,
	isHome,
	onSetHome,
	isHomeUpdating = false,
	autoRenameId = null,
	onAutoRenameConsumed,
} ) {
	const { title, icon, features } = useDocumentRecord( record );
	const { rename, duplicate, trash } = useDocumentActions();

	const recordId = record.id;
	const hasChildren = features.hierarchy && childNodes.length > 0;
	const isExpanded = expandedIds?.has( recordId ) ?? false;
	const rowIsSelected =
		typeof isSelected === 'function' ? isSelected( record ) : !! isSelected;
	const rowIsFavorite =
		typeof isFavorite === 'function' ? isFavorite( record ) : !! isFavorite;
	const rowIsHome =
		typeof isHome === 'function' ? isHome( record ) : !! isHome;
	const isBeingDragged = draggedId === recordId;
	const isDropTarget = activeDrop && activeDrop.targetId === recordId;

	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ draftTitle, setDraftTitle ] = useState( '' );
	const renameInputRef = useRef( null );

	// The parent sets `autoRenameId` after create or duplicate so this row
	// opens its title editor as soon as it renders.
	useEffect( () => {
		if ( autoRenameId === recordId ) {
			setDraftTitle( record.title?.raw ?? record.title?.rendered ?? '' );
			setIsRenaming( true );
			onAutoRenameConsumed?.();
		}
	}, [
		autoRenameId,
		recordId,
		record.title?.raw,
		record.title?.rendered,
		onAutoRenameConsumed,
	] );

	// TextControl keeps the real input inside its wrapper; focus and select
	// that inner input when rename mode opens.
	useEffect( () => {
		if ( isRenaming && renameInputRef.current ) {
			const input = renameInputRef.current.querySelector( 'input' );
			input?.focus();
			input?.select();
		}
	}, [ isRenaming ] );

	function commitRename() {
		const next = draftTitle.trim();
		const previous = record.title?.raw ?? record.title?.rendered ?? '';
		if ( next && next !== previous ) {
			rename( record, next );
		}
		setIsRenaming( false );
	}

	function cancelRename() {
		setIsRenaming( false );
	}

	function startRename() {
		setDraftTitle( record.title?.raw ?? record.title?.rendered ?? '' );
		setIsRenaming( true );
	}

	// Drag source. The existing DnD hook still expects page:/collection:
	// prefixes, so keep that id shape while the row itself stays shared.
	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
	} = useDraggable( {
		id: `${ features.hierarchy ? 'page' : 'collection' }:${ recordId }`,
		data: { pageId: recordId },
	} );

	// Hierarchical rows accept before/inside/after drops. Leaves only accept
	// before/after, matching what the REST guard allows.
	const dropBefore = useDroppable( {
		id: `before:${ recordId }`,
		data: { zone: 'before', pageId: recordId },
		disabled: isHidden,
	} );
	const dropInside = useDroppable( {
		id: `inside:${ recordId }`,
		data: { zone: 'inside', pageId: recordId },
		disabled: isHidden || ! features.hierarchy,
	} );
	const dropAfter = useDroppable( {
		id: `after:${ recordId }`,
		data: { zone: 'after', pageId: recordId },
		disabled: isHidden,
	} );

	const rowClasses = [ 'cortext-sidebar__row' ];
	if ( rowIsSelected ) {
		rowClasses.push( 'is-selected' );
	}
	if ( isBeingDragged ) {
		rowClasses.push( 'is-dragging' );
	}
	if ( isDropTarget ) {
		rowClasses.push( `is-drop-${ activeDrop.zone }` );
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
								onToggleExpand( recordId );
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
						{ icon }
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
							onClick={ () => onSelect( record ) }
							isPressed={ rowIsSelected }
						>
							{ title }
						</Button>
					) }

					{ features.canCreateChild && (
						<Button
							className="cortext-sidebar__add-child"
							icon={ plus }
							size="small"
							label={ sprintf(
								/* translators: %s: parent document title */
								__( 'Add a document inside %s', 'cortext' ),
								title
							) }
							onClick={ ( e ) => {
								e.stopPropagation();
								onCreateChild( recordId );
							} }
							onPointerDown={ ( e ) => e.stopPropagation() }
						/>
					) }

					<Dropdown
						popoverProps={ { placement: 'bottom-end' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<Button
								className="cortext-sidebar__menu"
								icon={ moreVertical }
								size="small"
								label={ sprintf(
									/* translators: %s: document title */
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
							<>
								{ features.canCreateChild && (
									<MenuGroup>
										<MenuItem
											icon={ collectionIcon }
											onClick={ () => {
												onCreateChildCollection?.(
													recordId
												);
												onClose();
											} }
										>
											{ __(
												'Add collection inside',
												'cortext'
											) }
										</MenuItem>
									</MenuGroup>
								) }
								<MenuGroup>
									<MenuItem
										icon={
											rowIsFavorite
												? starFilled
												: starEmpty
										}
										disabled={ isFavoriteDisabled }
										onClick={ () => {
											onToggleFavorite?.( record );
											onClose();
										} }
									>
										{ rowIsFavorite
											? __(
													'Remove from favorites',
													'cortext'
											  )
											: __(
													'Add to favorites',
													'cortext'
											  ) }
									</MenuItem>
									<MenuItem
										icon={ homeIcon }
										disabled={ rowIsHome || isHomeUpdating }
										onClick={ () => {
											onSetHome( record );
											onClose();
										} }
									>
										{ rowIsHome
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
											duplicate( record );
											onClose();
										} }
									>
										{ __( 'Duplicate', 'cortext' ) }
									</MenuItem>
									<MenuItem
										icon="trash"
										isDestructive
										onClick={ () => {
											trash( record );
											onClose();
										} }
									>
										{ __( 'Move to Trash', 'cortext' ) }
									</MenuItem>
								</MenuGroup>
							</>
						) }
					/>

					{ /* Drop zones overlay the row. pointer-events are off
					     so they don't block clicks when idle. */ }
					<div
						ref={ dropBefore.setNodeRef }
						className={
							'cortext-sidebar__drop-zone cortext-sidebar__drop-zone--before' +
							( features.hierarchy
								? ''
								: ' cortext-sidebar__drop-zone--half' )
						}
						aria-hidden="true"
					/>
					{ features.hierarchy && (
						<div
							ref={ dropInside.setNodeRef }
							className="cortext-sidebar__drop-zone cortext-sidebar__drop-zone--inside"
							aria-hidden="true"
						/>
					) }
					<div
						ref={ dropAfter.setNodeRef }
						className={
							'cortext-sidebar__drop-zone cortext-sidebar__drop-zone--after' +
							( features.hierarchy
								? ''
								: ' cortext-sidebar__drop-zone--half' )
						}
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
						{ childNodes.map( ( childNode ) => (
							<DocumentRow
								key={ childNode.page.id }
								record={ childNode.page }
								childNodes={ childNode.children }
								depth={ depth + 1 }
								expandedIds={ expandedIds }
								draggedId={ draggedId }
								activeDrop={ activeDrop }
								isHidden={ isHidden || ! isExpanded }
								isSelected={ isSelected }
								onSelect={ onSelect }
								onToggleExpand={ onToggleExpand }
								onCreateChild={ onCreateChild }
								onCreateChildCollection={
									onCreateChildCollection
								}
								isFavorite={ isFavorite }
								isFavoriteDisabled={ isFavoriteDisabled }
								onToggleFavorite={ onToggleFavorite }
								isHome={ isHome }
								onSetHome={ onSetHome }
								isHomeUpdating={ isHomeUpdating }
								autoRenameId={ autoRenameId }
								onAutoRenameConsumed={ onAutoRenameConsumed }
							/>
						) ) }
					</ul>
				</div>
			) }
		</li>
	);
}
