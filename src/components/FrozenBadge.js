import { __, sprintf } from '@wordpress/i18n';
import { Icon, Tooltip } from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { humanTimeDiff } from '@wordpress/date';
import { lock } from '@wordpress/icons';

import './FrozenBadge.scss';

function useFrozenLabel( frozen ) {
	const currentUserId = useSelect(
		( select ) => select( coreStore ).getCurrentUser()?.id ?? null,
		[]
	);
	if ( ! frozen?.frozen_at ) {
		return __( 'Locked', 'cortext' );
	}
	const ago = humanTimeDiff( frozen.frozen_at );
	const by = frozen.frozen_by;
	if ( ! by?.name ) {
		return sprintf(
			/* translators: %s: how long ago the document was locked, e.g. "2 hours ago" */
			__( 'Locked %s', 'cortext' ),
			ago
		);
	}
	if ( by.id === currentUserId ) {
		return sprintf(
			/* translators: %s: how long ago the document was locked, e.g. "2 hours ago" */
			__( 'Locked %s by you', 'cortext' ),
			ago
		);
	}
	return sprintf(
		/* translators: 1: how long ago the document was locked, e.g. "2 hours ago", 2: name of who locked it */
		__( 'Locked %1$s by %2$s', 'cortext' ),
		ago,
		by.name
	);
}

/**
 * "Locked" indicator for a frozen document, with who locked it and when in a
 * tooltip. Renders nothing for a document that isn't frozen.
 *
 * @param {Object}  props
 * @param {?Object} props.frozen    The document's `cortext_frozen` field.
 * @param {boolean} props.showLabel Show the "Locked" text next to the icon.
 */
export default function FrozenBadge( { frozen, showLabel = false } ) {
	const label = useFrozenLabel( frozen );
	if ( ! frozen ) {
		return null;
	}
	return (
		<Tooltip text={ label }>
			<span
				className={
					'cortext-frozen-badge' +
					( showLabel ? ' cortext-frozen-badge--labeled' : '' )
				}
				role="img"
				aria-label={ label }
				// Focusable so keyboard users can read who locked it.
				tabIndex={ showLabel ? 0 : undefined }
			>
				<Icon icon={ lock } size={ 16 } />
				{ showLabel && (
					<span aria-hidden="true">
						{ __( 'Locked', 'cortext' ) }
					</span>
				) }
			</span>
		</Tooltip>
	);
}
