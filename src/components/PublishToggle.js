import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { Button } from '@wordpress/components';
import { useCallback, useState } from '@wordpress/element';
import { globe, lock } from '@wordpress/icons';

export default function PublishToggle() {
	const { editPost, savePost } = useDispatch( editorStore );
	const { status, link, isSaving } = useSelect( ( select ) => {
		const editor = select( editorStore );
		return {
			status: editor.getEditedPostAttribute( 'status' ),
			link: editor.getEditedPostAttribute( 'link' ),
			isSaving: editor.isSavingPost(),
		};
	}, [] );

	const [ copied, setCopied ] = useState( false );

	const isPublic = status === 'publish';

	const toggle = useCallback( async () => {
		editPost( { status: isPublic ? 'private' : 'publish' } );
		savePost();
	}, [ editPost, savePost, isPublic ] );

	const copyLink = useCallback( async () => {
		if ( link ) {
			await navigator.clipboard.writeText( link );
			setCopied( true );
			setTimeout( () => setCopied( false ), 2000 );
		}
	}, [ link ] );

	// Don't show the toggle for draft pages (no title yet).
	if ( status === 'draft' ) {
		return null;
	}

	return (
		<div className="cortext-publish-toggle">
			<Button
				icon={ isPublic ? globe : lock }
				onClick={ toggle }
				disabled={ isSaving }
				variant="tertiary"
				size="compact"
			>
				{ isPublic
					? __( 'Public', 'cortext' )
					: __( 'Publish', 'cortext' ) }
			</Button>
			{ isPublic && link ? (
				<Button
					variant="link"
					className="cortext-publish-toggle__copy"
					onClick={ copyLink }
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
