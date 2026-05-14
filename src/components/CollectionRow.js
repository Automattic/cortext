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
} ) {
	const title = collectionTitle( collection );
	const rowClasses = [ 'cortext-sidebar__row' ];
	if ( isSelected ) {
		rowClasses.push( 'is-selected' );
	}

	return (
		<li className="cortext-sidebar__node">
			<div className={ rowClasses.join( ' ' ) }>
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
									? __( 'Remove from favorites', 'cortext' )
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
			</div>
		</li>
	);
}
