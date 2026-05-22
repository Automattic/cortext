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
	Icon,
	customPostType,
	home as homeIcon,
	moreVertical,
	starEmpty,
	starFilled,
} from '@wordpress/icons';
import { useDraggable, useDroppable } from '@dnd-kit/core';

const GRID_UNIT = 20; // Matches $grid-unit-20 in index.scss.

export function collectionTitle( collection ) {
	return (
		collection.title?.rendered?.trim() ||
		collection.title?.raw?.trim() ||
		collection.title?.trim?.() ||
		__( '(untitled)', 'cortext' )
	);
}

export default function CollectionRow( {
	collection,
	isSelected,
	isFavorite = false,
	isFavoriteDisabled = false,
	isHome,
	isHomeUpdating,
	onSelect,
	onToggleFavorite,
	onSetHome,
	onRename,
	onDuplicate,
	onTrash,
	autoRenameId = null,
	onAutoRenameConsumed,
	depth = 0,
	draggedId = null,
	activeDrop = null,
	isHidden = false,
} ) {
	const title = collectionTitle( collection );
	const isBeingDragged = draggedId === collection.id;

	const [ isRenaming, setIsRenaming ] = useState( false );
	const [ draftTitle, setDraftTitle ] = useState( '' );
	const renameInputRef = useRef( null );

	// New and duplicated collections enter rename mode as soon as their row
	// renders.
	useEffect( () => {
		if ( autoRenameId === collection.id ) {
			setDraftTitle(
				collection.title?.raw ?? collection.title?.rendered ?? ''
			);
			setIsRenaming( true );
			onAutoRenameConsumed?.();
		}
	}, [
		autoRenameId,
		collection.id,
		collection.title?.raw,
		collection.title?.rendered,
		onAutoRenameConsumed,
	] );

	// TextControl keeps the input inside its wrapper, so reach in once rename
	// mode opens.
	useEffect( () => {
		if ( isRenaming && renameInputRef.current ) {
			const input = renameInputRef.current.querySelector( 'input' );
			input?.focus();
			input?.select();
		}
	}, [ isRenaming ] );

	function commitRename() {
		const next = draftTitle.trim();
		if (
			next &&
			next !== ( collection.title?.raw ?? collection.title?.rendered )
		) {
			onRename?.( collection.id, next );
		}
		setIsRenaming( false );
	}

	function cancelRename() {
		setIsRenaming( false );
	}

	function startRename() {
		setDraftTitle(
			collection.title?.raw ?? collection.title?.rendered ?? ''
		);
		setIsRenaming( true );
	}

	// Full-page collections move like pages. Sidebar resolves the dragged
	// record later and PATCHes the right post type.
	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
	} = useDraggable( {
		id: `collection:${ collection.id }`,
		data: { pageId: collection.id },
	} );

	// Collections are leaves, so the row only offers before/after drop zones.
	// The REST guard rejects inside drops as well.
	const dropBefore = useDroppable( {
		id: `before:${ collection.id }`,
		data: { zone: 'before', pageId: collection.id },
		disabled: isHidden,
	} );
	const dropAfter = useDroppable( {
		id: `after:${ collection.id }`,
		data: { zone: 'after', pageId: collection.id },
		disabled: isHidden,
	} );

	const isDropTarget = activeDrop && activeDrop.targetId === collection.id;

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

	return (
		<li className="cortext-sidebar__node">
			<div
				className="cortext-sidebar__row-wrapper"
				style={ { '--cortext-depth': depth } }
			>
				<div
					ref={ setDragRef }
					className={ rowClasses.join( ' ' ) }
					style={
						depth > 0
							? {
									paddingInlineStart: `${
										depth * GRID_UNIT
									}px`,
							  }
							: undefined
					}
					{ ...attributes }
					{ ...listeners }
				>
					<span
						className="cortext-sidebar__chevron cortext-sidebar__chevron--placeholder"
						aria-hidden="true"
					/>
					<span className="cortext-sidebar__icon" aria-hidden="true">
						<Icon icon={ customPostType } size={ 16 } />
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
							variant="tertiary"
							onClick={ onSelect }
							isPressed={ isSelected }
						>
							{ title }
						</Button>
					) }

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
									/* translators: %s: collection title */
									__( 'Actions for %s', 'cortext' ),
									title
								) }
								onClick={ onToggle }
								onPointerDown={ ( e ) => e.stopPropagation() }
								aria-expanded={ isOpen }
							/>
						) }
						renderContent={ ( { onClose } ) => (
							<MenuGroup>
								<MenuItem
									icon={ isFavorite ? starFilled : starEmpty }
									disabled={ isFavoriteDisabled }
									onClick={ () => {
										onToggleFavorite?.( collection.id );
										onClose();
									} }
								>
									{ isFavorite
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
										onSetHome( collection.id );
										onClose();
									} }
								>
									{ isHome
										? __( 'Home', 'cortext' )
										: __( 'Set as home', 'cortext' ) }
								</MenuItem>
								{ onRename && (
									<MenuItem
										icon="edit"
										onClick={ () => {
											startRename();
											onClose();
										} }
									>
										{ __( 'Rename', 'cortext' ) }
									</MenuItem>
								) }
								{ onDuplicate && (
									<MenuItem
										icon="admin-page"
										onClick={ () => {
											onDuplicate( collection.id );
											onClose();
										} }
									>
										{ __( 'Duplicate', 'cortext' ) }
									</MenuItem>
								) }
								{ onTrash && (
									<MenuItem
										icon="trash"
										isDestructive
										onClick={ () => {
											onTrash( collection.id );
											onClose();
										} }
									>
										{ __( 'Move to Trash', 'cortext' ) }
									</MenuItem>
								) }
							</MenuGroup>
						) }
					/>

					{ /* Before/after drop targets share the row height. */ }
					<div
						ref={ dropBefore.setNodeRef }
						className="cortext-sidebar__drop-zone cortext-sidebar__drop-zone--before cortext-sidebar__drop-zone--half"
						aria-hidden="true"
					/>
					<div
						ref={ dropAfter.setNodeRef }
						className="cortext-sidebar__drop-zone cortext-sidebar__drop-zone--after cortext-sidebar__drop-zone--half"
						aria-hidden="true"
					/>
				</div>
			</div>
		</li>
	);
}
