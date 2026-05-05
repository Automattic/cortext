import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	store as blockEditorStore,
	MediaUploadCheck,
} from '@wordpress/block-editor';
import { Button } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { createBlock } from '@wordpress/blocks';

import MediaPicker from '../../components/MediaPicker';
import PageIdentityControls from '../../components/PageIdentityControls';

// Hover-revealed entry points for the cover and icon. Lives as a block
// so it can sit between the cover/icon (locked at top) and the title
// in the BlockList — that way clicking "Add cover" puts the cover at
// the very top of the canvas, next to the editor toolbar, instead of
// below an out-of-flow toolbar above BlockList.
export default function Edit( { context } ) {
	const postId = context?.postId;
	const postType = context?.postType ?? 'crtxt_page';

	const blockProps = useBlockProps( {
		className: 'cortext-page-header-actions',
	} );

	const { hasIcon, hasCover, coverIndex } = useSelect( ( select ) => {
		const blocks = select( blockEditorStore ).getBlocks();
		const cover = blocks.findIndex(
			( b ) => b.name === 'cortext/page-cover'
		);
		return {
			hasCover: cover >= 0,
			hasIcon: blocks.some( ( b ) => b.name === 'cortext/page-icon' ),
			coverIndex: cover,
		};
	}, [] );
	const { insertBlocks } = useDispatch( blockEditorStore );
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );

	// `move: true` only — locking remove would make our block-removal
	// effects (when the user clears the icon meta or the featured image)
	// silent no-ops because `canRemoveBlocks` returns false.
	const lock = { move: true };

	const ensureIconBlock = () => {
		if ( hasIcon ) {
			return;
		}
		const block = createBlock( 'cortext/page-icon', { lock } );
		const index = coverIndex >= 0 ? coverIndex + 1 : 0;
		insertBlocks( block, index, undefined, false );
	};

	const insertCover = async ( mediaId ) => {
		if ( ! postId ) {
			return;
		}
		editEntityRecord( 'postType', postType, postId, {
			featured_media: mediaId,
		} );
		await saveEditedEntityRecord( 'postType', postType, postId );
		if ( hasCover ) {
			return;
		}
		const block = createBlock( 'cortext/page-cover', {
			align: 'full',
			lock,
		} );
		insertBlocks( block, 0, undefined, false );
	};

	// Until the post id is available the picker can't bind to a record;
	// render an empty wrapper so the block still mounts cleanly. Without
	// this guard PageIdentityControls would receive `pageId={undefined}`
	// and the Dropdown's child fetches blow up the first render.
	if ( ! postId ) {
		return <div { ...blockProps } />;
	}

	return (
		<div { ...blockProps }>
			{ ! hasIcon && (
				<PageIdentityControls
					pageId={ postId }
					currentIcon=""
					onAfterSave={ ensureIconBlock }
					renderToggle={ ( { onToggle } ) => (
						<Button variant="tertiary" onClick={ onToggle }>
							{ __( 'Add icon', 'cortext' ) }
						</Button>
					) }
				/>
			) }
			{ ! hasCover && (
				<MediaUploadCheck>
					<MediaPicker
						allowedTypes={ [ 'image' ] }
						onSelect={ ( media ) => insertCover( media.id ) }
						render={ ( { open } ) => (
							<Button variant="tertiary" onClick={ open }>
								{ __( 'Add cover', 'cortext' ) }
							</Button>
						) }
					/>
				</MediaUploadCheck>
			) }
		</div>
	);
}
