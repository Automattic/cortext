import { __ } from '@wordpress/i18n';
import {
	Button,
	DropdownMenu,
	MenuGroup,
	MenuItem,
} from '@wordpress/components';
import { useEntityRecord, store as coreStore } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { MediaUploadCheck } from '@wordpress/block-editor';
import { MediaUpload } from '@wordpress/media-utils';

import { POST_TYPE } from './page-queries';

function CoverImage( { mediaId } ) {
	const { record } = useEntityRecord( 'root', 'media', mediaId );
	const src =
		record?.media_details?.sizes?.large?.source_url ??
		record?.source_url ??
		null;

	if ( ! src ) {
		return null;
	}

	return (
		<img
			className="cortext-page-cover__image"
			src={ src }
			alt={ record?.alt_text ?? '' }
		/>
	);
}

function useCoverPersist( pageId ) {
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );

	return async ( nextId ) => {
		editEntityRecord( 'postType', POST_TYPE, pageId, {
			featured_media: nextId,
		} );
		await saveEditedEntityRecord( 'postType', POST_TYPE, pageId );
	};
}

export function AddCoverButton( { pageId, className, variant = 'tertiary' } ) {
	const persist = useCoverPersist( pageId );

	return (
		<MediaUploadCheck>
			<MediaUpload
				allowedTypes={ [ 'image' ] }
				onSelect={ ( media ) => persist( media.id ) }
				render={ ( { open } ) => (
					<Button
						className={ className }
						variant={ variant }
						onClick={ open }
					>
						{ __( 'Add cover', 'cortext' ) }
					</Button>
				) }
			/>
		</MediaUploadCheck>
	);
}

export default function PageCover( { pageId, featuredMedia } ) {
	const persist = useCoverPersist( pageId );

	if ( featuredMedia <= 0 ) {
		return null;
	}

	return (
		<div className="cortext-page-cover">
			<CoverImage mediaId={ featuredMedia } />
			<div className="cortext-page-cover__controls">
				<MediaUploadCheck>
					<MediaUpload
						allowedTypes={ [ 'image' ] }
						value={ featuredMedia }
						onSelect={ ( media ) => persist( media.id ) }
						render={ ( { open } ) => (
							<DropdownMenu
								className="cortext-page-cover__menu"
								icon="ellipsis"
								label={ __( 'Cover options', 'cortext' ) }
								popoverProps={ { placement: 'bottom-end' } }
							>
								{ ( { onClose } ) => (
									<MenuGroup>
										<MenuItem
											onClick={ () => {
												open();
												onClose();
											} }
										>
											{ __( 'Replace cover', 'cortext' ) }
										</MenuItem>
										<MenuItem
											isDestructive
											onClick={ () => {
												persist( 0 );
												onClose();
											} }
										>
											{ __( 'Remove cover', 'cortext' ) }
										</MenuItem>
									</MenuGroup>
								) }
							</DropdownMenu>
						) }
					/>
				</MediaUploadCheck>
			</div>
		</div>
	);
}
