import { SnackbarList } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';

// Renders only Cortext-owned snackbars. The editor store also dispatches its
// own "Post updated" success notice on every save; in an autosave-silent UI
// those would fire constantly, so we filter to notices we tagged ourselves.
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

	return <SnackbarList notices={ notices } onRemove={ removeNotice } />;
}
