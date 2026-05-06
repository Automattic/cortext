import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	InspectorControls,
	BlockControls,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import MediaPicker, { MediaUploadCheck } from '../../components/MediaPicker';
import { useEntityProp, useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { createBlock } from '@wordpress/blocks';
import {
	Button,
	PanelBody,
	ToolbarButton,
	ToolbarGroup,
} from '@wordpress/components';
import { replace, trash } from '@wordpress/icons';
import PageIdentityControls from '../../components/PageIdentityControls';

// Renders the featured image as a full-width banner with hover-revealed
// Replace/Remove controls in the top-right corner. We deliberately don't
// reuse <PostFeaturedImage> from @wordpress/editor — its built-in layout
// flanks a natural-size thumbnail with Replace/Remove buttons, which
// fights any attempt at a Notion-style cover. We keep the same plumbing
// underneath (MediaUpload + featured_media) so the WP media library and
// inspector continue to work.
export default function Edit( { context, clientId } ) {
	const postId = context?.postId;
	const postType = context?.postType ?? 'crtxt_page';
	const blockProps = useBlockProps( {
		className: 'cortext-page-cover-block',
	} );

	const [ featuredId, setFeaturedId ] = useEntityProp(
		'postType',
		postType,
		'featured_media',
		postId
	);
	const [ meta ] = useEntityProp( 'postType', postType, 'meta', postId );
	const iconMeta = meta?.cortext_page_icon ?? '';
	const { coverIndex, hasIconBlock } = useSelect(
		( select ) => {
			const store = select( blockEditorStore );
			return {
				coverIndex: clientId ? store.getBlockIndex( clientId ) : 0,
				hasIconBlock: store
					.getBlocks()
					.some( ( block ) => block.name === 'cortext/page-icon' ),
			};
		},
		[ clientId ]
	);
	const { record: media } = useEntityRecord(
		'root',
		'media',
		featuredId || 0
	);
	const { insertBlocks, removeBlock, updateBlockAttributes } =
		useDispatch( blockEditorStore );

	// `setFeaturedId(0)` clears the meta; `removeBlock` deletes this
	// block. Doing both in the same user-triggered handler keeps block
	// presence and value coupled without a reactive useEffect, which
	// previously misfired during page switches when useEntityProp was
	// briefly out of sync and removed the saved cover.
	const removeCover = () => {
		if ( clientId ) {
			updateBlockAttributes( clientId, { lock: {} } );
			removeBlock( clientId, false );
		}
		setFeaturedId( 0 );
	};

	const src =
		media?.media_details?.sizes?.large?.source_url ??
		media?.source_url ??
		null;

	const ensureIconBlock = () => {
		if ( hasIconBlock || ! clientId ) {
			return;
		}
		insertBlocks(
			createBlock( 'cortext/page-icon', {
				lock: { move: true },
			} ),
			coverIndex + 1,
			undefined,
			false
		);
	};

	return (
		<>
			<BlockControls group="other">
				<ToolbarGroup>
					<MediaUploadCheck>
						<MediaPicker
							allowedTypes={ [ 'image' ] }
							value={ featuredId }
							onSelect={ ( picked ) =>
								setFeaturedId( picked.id )
							}
							render={ ( { open } ) => (
								<ToolbarButton
									icon={ replace }
									label={ __( 'Replace cover', 'cortext' ) }
									onClick={ open }
								/>
							) }
						/>
					</MediaUploadCheck>
					{ featuredId > 0 && (
						<ToolbarButton
							icon={ trash }
							label={ __( 'Remove cover', 'cortext' ) }
							onClick={ removeCover }
						/>
					) }
				</ToolbarGroup>
			</BlockControls>
			<InspectorControls>
				<PanelBody title={ __( 'Cover', 'cortext' ) }>
					<MediaUploadCheck>
						<MediaPicker
							allowedTypes={ [ 'image' ] }
							value={ featuredId }
							onSelect={ ( picked ) =>
								setFeaturedId( picked.id )
							}
							render={ ( { open } ) => (
								<Button
									variant="secondary"
									onClick={ open }
									__next40pxDefaultSize
								>
									{ __( 'Replace cover', 'cortext' ) }
								</Button>
							) }
						/>
					</MediaUploadCheck>
					{ featuredId > 0 && (
						<Button
							variant="tertiary"
							isDestructive
							onClick={ removeCover }
							style={ { marginInlineStart: 8 } }
							__next40pxDefaultSize
						>
							{ __( 'Remove cover', 'cortext' ) }
						</Button>
					) }
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				{ src && (
					<img
						className="cortext-page-cover-block__image"
						src={ src }
						alt={ media?.alt_text ?? '' }
					/>
				) }
				<div className="cortext-page-cover-block__controls">
					{ ! iconMeta && (
						<PageIdentityControls
							pageId={ postId }
							currentIcon={ iconMeta }
							onAfterSave={ ensureIconBlock }
							renderToggle={ ( { onToggle } ) => (
								<Button
									variant="secondary"
									size="small"
									onClick={ onToggle }
								>
									{ __( 'Add icon', 'cortext' ) }
								</Button>
							) }
						/>
					) }
					<MediaUploadCheck>
						<MediaPicker
							allowedTypes={ [ 'image' ] }
							value={ featuredId }
							onSelect={ ( picked ) =>
								setFeaturedId( picked.id )
							}
							render={ ( { open } ) => (
								<Button
									variant="secondary"
									size="small"
									onClick={ open }
								>
									{ __( 'Replace', 'cortext' ) }
								</Button>
							) }
						/>
					</MediaUploadCheck>
					{ featuredId > 0 && (
						<Button
							variant="secondary"
							size="small"
							onClick={ removeCover }
						>
							{ __( 'Remove', 'cortext' ) }
						</Button>
					) }
				</div>
			</div>
		</>
	);
}
