import { __ } from '@wordpress/i18n';
import {
	useBlockProps,
	InspectorControls,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { Button, PanelBody } from '@wordpress/components';
import { useEntityProp, store as coreStore } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useEffect } from '@wordpress/element';

import PageIcon from '../../components/PageIcon';
import PageIdentityControls from '../../components/PageIdentityControls';

export default function Edit( { context, clientId } ) {
	const postId = context?.postId;
	const postType = context?.postType ?? 'crtxt_page';
	const blockProps = useBlockProps( {
		className: 'cortext-page-icon-block',
	} );

	const [ meta ] = useEntityProp( 'postType', postType, 'meta', postId );
	const iconMeta = meta?.cortext_page_icon ?? '';
	const hasIcon = !! iconMeta;
	const { removeBlock, updateBlockAttributes } =
		useDispatch( blockEditorStore );
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );

	const removeIcon = async () => {
		editEntityRecord( 'postType', postType, postId, {
			meta: { cortext_page_icon: '' },
		} );
		await saveEditedEntityRecord( 'postType', postType, postId );
	};

	// Drop the block when the picker clears the icon meta. Strip the lock
	// first so existing rows (created before we relaxed `lock.remove`) can
	// still be removed; otherwise removeBlock silently no-ops.
	useEffect( () => {
		if ( ! hasIcon && clientId ) {
			updateBlockAttributes( clientId, { lock: {} } );
			removeBlock( clientId, false );
		}
	}, [ hasIcon, clientId, removeBlock, updateBlockAttributes ] );

	if ( ! postId ) {
		return (
			<div { ...blockProps }>
				<span className="cortext-page-icon-block__hint">
					{ __( 'Page icon is unavailable here.', 'cortext' ) }
				</span>
			</div>
		);
	}

	return (
		<>
			<InspectorControls>
				<PanelBody title={ __( 'Icon', 'cortext' ) }>
					<PageIdentityControls
						pageId={ postId }
						currentIcon={ iconMeta }
						renderToggle={ ( { onToggle } ) => (
							<Button
								variant="secondary"
								onClick={ onToggle }
								__next40pxDefaultSize
							>
								{ hasIcon
									? __( 'Change icon', 'cortext' )
									: __( 'Add icon', 'cortext' ) }
							</Button>
						) }
					/>
					{ hasIcon && (
						<Button
							variant="tertiary"
							isDestructive
							onClick={ removeIcon }
							style={ { marginInlineStart: 8 } }
							__next40pxDefaultSize
						>
							{ __( 'Remove icon', 'cortext' ) }
						</Button>
					) }
				</PanelBody>
			</InspectorControls>
			<div { ...blockProps }>
				<PageIdentityControls
					pageId={ postId }
					currentIcon={ iconMeta }
					renderToggle={ ( { onToggle } ) =>
						hasIcon ? (
							<Button
								className="cortext-page-icon-block__button"
								onClick={ onToggle }
								label={ __( 'Change icon', 'cortext' ) }
							>
								<PageIcon icon={ iconMeta } size={ 56 } />
							</Button>
						) : (
							<Button
								className="cortext-page-icon-block__add"
								variant="tertiary"
								onClick={ onToggle }
							>
								{ __( 'Add icon', 'cortext' ) }
							</Button>
						)
					}
				/>
			</div>
		</>
	);
}
