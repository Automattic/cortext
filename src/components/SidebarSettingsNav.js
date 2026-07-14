import { useNavigate, useParams } from '@tanstack/react-router';
import { Button, Icon } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { chevronLeft, globe, plugins, upload } from '@wordpress/icons';

import {
	SETTINGS_EXPERIMENTS_URI,
	SETTINGS_IMPORT_URI,
	SETTINGS_PUBLISHED_URI,
} from '../router/useResolveEntity';
import {
	canManageCortextSettings,
	isPublicWebAffordancesEnabled,
} from '../settings';

const NAV_ITEMS = [
	{
		key: 'import',
		uri: SETTINGS_IMPORT_URI,
		icon: upload,
		label: () => __( 'Import', 'cortext' ),
	},
	{
		key: 'published',
		uri: SETTINGS_PUBLISHED_URI,
		icon: globe,
		label: () => __( 'Published', 'cortext' ),
		isEnabled: isPublicWebAffordancesEnabled,
	},
	{
		key: 'experiments',
		uri: SETTINGS_EXPERIMENTS_URI,
		icon: plugins,
		label: () => __( 'Experiments', 'cortext' ),
		isEnabled: canManageCortextSettings,
	},
];

export default function SidebarSettingsNav( { collapsed, onBack } ) {
	const navigate = useNavigate();
	const params = useParams( { strict: false } );
	const activeUri = params._splat ?? '';
	const items = NAV_ITEMS.filter(
		( item ) => ! item.isEnabled || item.isEnabled()
	);

	return (
		<nav
			className="cortext-sidebar__quick-actions cortext-sidebar__settings-nav"
			aria-label={ __( 'Settings', 'cortext' ) }
		>
			<Button
				className="cortext-sidebar__quick-action cortext-sidebar__settings-back"
				label={ __( 'Back', 'cortext' ) }
				onClick={ onBack }
			>
				<Icon icon={ chevronLeft } size={ 16 } />
				{ ! collapsed && <span>{ __( 'Back', 'cortext' ) }</span> }
			</Button>
			{ ! collapsed && (
				<h2 className="cortext-sidebar__section-title cortext-sidebar__settings-title">
					{ __( 'Settings', 'cortext' ) }
				</h2>
			) }
			{ items.map( ( item ) => {
				const label = item.label();
				return (
					<Button
						key={ item.key }
						className="cortext-sidebar__quick-action cortext-sidebar__settings-item"
						label={ label }
						isPressed={ activeUri === item.uri }
						onClick={ () =>
							navigate( {
								to: '/$',
								params: { _splat: item.uri },
							} )
						}
					>
						<Icon icon={ item.icon } size={ 16 } />
						{ ! collapsed && <span>{ label }</span> }
					</Button>
				);
			} ) }
		</nav>
	);
}
