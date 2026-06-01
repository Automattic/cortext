import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { useCallback, useState } from '@wordpress/element';
import { globe, lock } from '@wordpress/icons';

import './PublishToggle.scss';

/**
 * Presentational publish toggle. Source-agnostic so it can be reused for
 * pages (editor store) and collections (core-data) by thin wrappers.
 *
 * @param {Object}    props
 * @param {boolean}   props.isPublic           Current public state.
 * @param {boolean}   props.isSaving           Disables the toggle while saving.
 * @param {?string}   props.link               Public link, when applicable.
 * @param {Function}  props.onToggle           Called to flip public state.
 * @param {?Function} props.onRequestUnpublish When set, clicking while public
 *                                             calls this instead of onToggle so
 *                                             the wrapper can interpose a
 *                                             confirmation dialog.
 * @param {boolean}   props.disabled           Disables write actions.
 */
export default function PublishToggle( {
	disabled = false,
	isPublic,
	isSaving,
	link = null,
	onToggle,
	onRequestUnpublish = null,
} ) {
	const [ copied, setCopied ] = useState( false );

	const handleClick = useCallback( () => {
		if ( disabled ) {
			return;
		}
		if ( isPublic && onRequestUnpublish ) {
			onRequestUnpublish();
			return;
		}
		onToggle();
	}, [ disabled, isPublic, onRequestUnpublish, onToggle ] );

	const copyLink = useCallback( async () => {
		if ( link && ! disabled ) {
			await navigator.clipboard.writeText( link );
			setCopied( true );
			setTimeout( () => setCopied( false ), 2000 );
		}
	}, [ disabled, link ] );

	return (
		<div className="cortext-publish-toggle">
			<Button
				icon={ isPublic ? globe : lock }
				onClick={ handleClick }
				disabled={ isSaving || disabled }
				variant="tertiary"
				size="compact"
				isPressed={ isPublic }
			>
				{ isPublic
					? __( 'Public', 'cortext' )
					: __( 'Publish', 'cortext' ) }
			</Button>
			{ isPublic && link ? (
				<Button
					className="cortext-publish-toggle__copy"
					onClick={ copyLink }
					disabled={ disabled }
					size="compact"
				>
					{ copied
						? __( 'Copied!', 'cortext' )
						: __( 'Copy link', 'cortext' ) }
				</Button>
			) : null }
		</div>
	);
}
