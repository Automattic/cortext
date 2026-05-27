import { Button, Dropdown, PanelBody } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { pencil, plus, seen, unseen } from '@wordpress/icons';

import AddFieldPopover from './fields/AddFieldPopover';
import { CollectionFieldsProvider } from './CollectionFieldsContext';
import { useDocumentPropertiesContext } from './DocumentPropertiesContext';

// Row-property actions shown in both the Row inspector tab and the block
// inspector. Values are edited in the document block; this panel handles
// visibility and field creation.
export default function DocumentPropertiesActions() {
	const ctx = useDocumentPropertiesContext();
	if ( ! ctx ) {
		return null;
	}
	const {
		collectionId,
		fields,
		isLayoutEditing,
		isResolving,
		isVisible,
		onRequestLayoutEdit,
		onToggleVisible,
	} = ctx;
	if ( isResolving ) {
		return null;
	}
	const hasFields = Array.isArray( fields ) && fields.length > 0;
	if ( ! collectionId && ! hasFields && ! onToggleVisible ) {
		return null;
	}
	return (
		<PanelBody title={ __( 'Properties', 'cortext' ) }>
			<div className="cortext-document-properties-actions">
				{ onToggleVisible && hasFields && (
					<Button
						variant="secondary"
						icon={ isVisible ? unseen : seen }
						onClick={ onToggleVisible }
						__next40pxDefaultSize
					>
						{ isVisible
							? __( 'Collapse properties', 'cortext' )
							: __( 'Expand properties', 'cortext' ) }
					</Button>
				) }
				{ onRequestLayoutEdit && hasFields && (
					<Button
						variant="secondary"
						icon={ pencil }
						isPressed={ isLayoutEditing }
						onClick={ onRequestLayoutEdit }
						__next40pxDefaultSize
					>
						{ isLayoutEditing
							? __( 'Done editing properties', 'cortext' )
							: __( 'Edit properties', 'cortext' ) }
					</Button>
				) }
				{ collectionId && (
					<Dropdown
						popoverProps={ { placement: 'bottom-start' } }
						renderToggle={ ( { isOpen, onToggle } ) => (
							<Button
								variant="secondary"
								icon={ plus }
								onClick={ onToggle }
								aria-expanded={ isOpen }
								__next40pxDefaultSize
							>
								{ __( 'Add field', 'cortext' ) }
							</Button>
						) }
						renderContent={ ( { onClose } ) => (
							// The row editor does not mount the collection field
							// context, but AddFieldPopover needs it for relation
							// and rollup targets.
							<CollectionFieldsProvider
								collectionId={ collectionId }
							>
								<AddFieldPopover
									collectionId={ collectionId }
									onCreate={ onClose }
								/>
							</CollectionFieldsProvider>
						) }
					/>
				) }
			</div>
		</PanelBody>
	);
}
