import { __ } from '@wordpress/i18n';
import { Button, Dropdown, MenuGroup, MenuItem } from '@wordpress/components';
import { desktop, Icon } from '@wordpress/icons';

import useColorScheme from '../hooks/useColorScheme';

// @wordpress/icons does not ship sun/moon glyphs, so inline them here.
const sunIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<circle cx="12" cy="12" r="4" />
		<path
			d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			fill="none"
		/>
	</svg>
);

const moonIcon = (
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
		<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
	</svg>
);

export default function ThemeToggle() {
	const { preference, resolved, setPreference } = useColorScheme();

	const triggerIcon = resolved === 'dark' ? moonIcon : sunIcon;

	return (
		<Dropdown
			popoverProps={ { placement: 'top-end' } }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					className="cortext-sidebar__theme-toggle"
					icon={ triggerIcon }
					label={ __( 'Color scheme', 'cortext' ) }
					onClick={ onToggle }
					isPressed={ isOpen }
					aria-expanded={ isOpen }
				/>
			) }
			renderContent={ ( { onClose } ) => (
				<MenuGroup>
					<MenuItem
						icon={ sunIcon }
						isSelected={ preference === 'light' }
						onClick={ () => {
							setPreference( 'light' );
							onClose();
						} }
					>
						{ __( 'Light', 'cortext' ) }
					</MenuItem>
					<MenuItem
						icon={ moonIcon }
						isSelected={ preference === 'dark' }
						onClick={ () => {
							setPreference( 'dark' );
							onClose();
						} }
					>
						{ __( 'Dark', 'cortext' ) }
					</MenuItem>
					<MenuItem
						icon={ <Icon icon={ desktop } /> }
						isSelected={ preference === 'auto' }
						onClick={ () => {
							setPreference( 'auto' );
							onClose();
						} }
					>
						{ __( 'Match system', 'cortext' ) }
					</MenuItem>
				</MenuGroup>
			) }
		/>
	);
}
