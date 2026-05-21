/**
 * Installs the wrapper that renders row properties under the post title.
 *
 * This uses `editor.BlockEdit` rather than `editor.BlockListBlock` because the
 * slot must live inside the title wrapper. Padding the title then extends its
 * block rect below the properties, which keeps Gutenberg's `+` inserter in the
 * gap between the properties and the next body block.
 *
 * `src/components/InDocumentRowProperties.js` owns the slot and padding update.
 * It renders only when Canvas or RowEditor provides fields in context.
 */

import { addFilter } from '@wordpress/hooks';
import { useSelect } from '@wordpress/data';
import { createHigherOrderComponent } from '@wordpress/compose';
import { store as blockEditorStore } from '@wordpress/block-editor';

import InDocumentRowProperties, {
	HOST_CLASS,
} from '../../components/InDocumentRowProperties';

const POST_TITLE_BLOCK = 'core/post-title';
const FILTER_NAMESPACE = 'cortext/document-properties-slot';

const wrapBlockEdit = createHigherOrderComponent(
	( BlockEdit ) =>
		function CortextDocumentPropertiesHost( props ) {
			// Keep hook order stable. Non-title blocks short-circuit before
			// doing any store work.
			const isRootPostTitle = useSelect(
				( select_ ) => {
					if ( props.name !== POST_TITLE_BLOCK ) {
						return false;
					}
					return (
						select_( blockEditorStore ).getBlockRootClientId(
							props.clientId
						) === ''
					);
				},
				[ props.name, props.clientId ]
			);

			if ( ! isRootPostTitle ) {
				return <BlockEdit key="edit" { ...props } />;
			}

			return (
				<div
					className={ HOST_CLASS }
					style={ { position: 'relative' } }
				>
					<BlockEdit key="edit" { ...props } />
					<InDocumentRowProperties />
				</div>
			);
		},
	'withCortextDocumentPropertiesHost'
);

addFilter( 'editor.BlockEdit', FILTER_NAMESPACE, wrapBlockEdit );
