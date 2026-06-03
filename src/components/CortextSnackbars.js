import { SnackbarList } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';

import './CortextSnackbars.scss';

// Show only snackbars created by Cortext. Core also emits its own "Post updated"
// notice after saves, which would be noisy here, so we keep notices with our ids.
export default function CortextSnackbars() {
	const notices = useSelect(
		( select ) =>
			select( noticesStore )
				.getNotices()
				.filter(
					( n ) =>
						n.type === 'snackbar' &&
						typeof n.id === 'string' &&
						n.id.startsWith( 'cortext-' )
				),
		[]
	);
	const { removeNotice } = useDispatch( noticesStore );

	return (
		<div className="cortext-snackbars">
			<SnackbarList notices={ notices } onRemove={ removeNotice } />
		</div>
	);
}
