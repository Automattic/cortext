import { __ } from '@wordpress/i18n';
import { Button, Dropdown, TabPanel, Spinner } from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import { store as coreStore } from '@wordpress/core-data';
import { lazy, Suspense, useState } from '@wordpress/element';
import { MediaUploadCheck } from '@wordpress/block-editor';
import { MediaUpload } from '@wordpress/media-utils';

import PageIcon from './PageIcon';
import { POST_TYPE } from './page-queries';

// The picker carries ~150KB of emoji data, so defer it until the popover
// actually opens. The first interaction pays the load cost; subsequent
// opens are instant.
const EmojiPicker = lazy( async () => {
	const [ pickerModule, dataModule ] = await Promise.all( [
		import( '@emoji-mart/react' ),
		import( '@emoji-mart/data' ),
	] );

	const Picker = pickerModule.default;
	const data = dataModule.default;

	return {
		default: function LoadedEmojiPicker( { onSelect } ) {
			return (
				<Picker
					data={ data }
					onEmojiSelect={ ( emoji ) => onSelect( emoji.native ) }
					theme="auto"
					previewPosition="none"
					skinTonePosition="search"
				/>
			);
		},
	};
} );

function encodeEmoji( value ) {
	return JSON.stringify( { type: 'emoji', value } );
}

function encodeImage( id ) {
	return JSON.stringify( { type: 'image', id } );
}

function PickerBody( { pageId, onClose, allowRemove } ) {
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );
	const [ working, setWorking ] = useState( false );

	const persist = async ( nextMetaValue ) => {
		setWorking( true );
		try {
			editEntityRecord( 'postType', POST_TYPE, pageId, {
				meta: { cortext_page_icon: nextMetaValue },
			} );
			await saveEditedEntityRecord( 'postType', POST_TYPE, pageId );
			onClose();
		} finally {
			setWorking( false );
		}
	};

	const tabs = [
		{ name: 'emoji', title: __( 'Emoji', 'cortext' ) },
		{ name: 'upload', title: __( 'Upload', 'cortext' ) },
	];

	return (
		<div className="cortext-page-identity-popover">
			{ working && (
				<div
					className="cortext-page-identity-popover__busy"
					aria-hidden="true"
				>
					<Spinner />
				</div>
			) }
			<TabPanel
				className="cortext-page-identity-popover__tabs"
				tabs={ tabs }
			>
				{ ( tab ) =>
					tab.name === 'emoji' ? (
						<Suspense
							fallback={
								<div className="cortext-page-identity-popover__loading">
									<Spinner />
								</div>
							}
						>
							<EmojiPicker
								onSelect={ ( native ) =>
									persist( encodeEmoji( native ) )
								}
							/>
						</Suspense>
					) : (
						<MediaUploadCheck>
							<MediaUpload
								allowedTypes={ [ 'image' ] }
								onSelect={ ( media ) =>
									persist( encodeImage( media.id ) )
								}
								render={ ( { open } ) => (
									<div className="cortext-page-identity-popover__upload">
										<Button
											variant="primary"
											onClick={ open }
											__next40pxDefaultSize
										>
											{ __(
												'Open media library',
												'cortext'
											) }
										</Button>
										<p className="cortext-page-identity-popover__hint">
											{ __(
												'Pick or upload an image to use as this page’s icon.',
												'cortext'
											) }
										</p>
									</div>
								) }
							/>
						</MediaUploadCheck>
					)
				}
			</TabPanel>
			{ allowRemove && (
				<div className="cortext-page-identity-popover__footer">
					<Button
						variant="tertiary"
						isDestructive
						onClick={ () => persist( '' ) }
					>
						{ __( 'Remove icon', 'cortext' ) }
					</Button>
				</div>
			) }
		</div>
	);
}

// Render-prop API: caller controls the trigger element so the picker can
// open from a sidebar row, the page header, or a toolbar button without
// each surface duplicating Dropdown plumbing.
export default function PageIdentityControls( {
	pageId,
	currentIcon,
	renderToggle,
	popoverPlacement = 'bottom-start',
} ) {
	const hasIcon = !! currentIcon;

	return (
		<Dropdown
			popoverProps={ { placement: popoverPlacement } }
			contentClassName="cortext-page-identity-popover-content"
			renderToggle={ ( { isOpen, onToggle } ) =>
				renderToggle( {
					isOpen,
					onToggle,
					currentIconNode: (
						<PageIcon icon={ currentIcon } size={ 16 } />
					),
				} )
			}
			renderContent={ ( { onClose } ) => (
				<PickerBody
					pageId={ pageId }
					onClose={ onClose }
					allowRemove={ hasIcon }
				/>
			) }
		/>
	);
}
