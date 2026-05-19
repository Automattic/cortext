import { __, sprintf } from '@wordpress/i18n';
import { Button, Dropdown, MenuGroup, MenuItem } from '@wordpress/components';
import {
	Icon,
	customPostType,
	home as homeIcon,
	moreVertical,
	starEmpty,
	starFilled,
} from '@wordpress/icons';
import { useDraggable, useDroppable } from '@dnd-kit/core';

const GRID_UNIT = 20; // matches $grid-unit-20 in index.scss

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
	depth = 0,
	draggedId = null,
	activeDrop = null,
	isHidden = false,
} ) {
	const title = collectionTitle( collection );
	const isBeingDragged = draggedId === collection.id;

	// Full-page collections move like pages. Sidebar looks up the dragged
	// record later so it can PATCH the right post type.
	const {
		attributes,
		listeners,
		setNodeRef: setDragRef,
	} = useDraggable( {
		id: `collection:${ collection.id }`,
		data: { pageId: collection.id },
	} );

	// Collections are leaves in the sidebar, so only before/after drops are
	// offered. The REST guard would reject inside drops too.
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
					<Button
						className="cortext-sidebar__title"
						size="compact"
						variant="tertiary"
						onClick={ onSelect }
						isPressed={ isSelected }
					>
						{ title }
					</Button>
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
							</MenuGroup>
						) }
					/>

					{ /* Two row overlays handle before/after drops. */ }
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
