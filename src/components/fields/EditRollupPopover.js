import { __ } from '@wordpress/i18n';
import { Popover } from '@wordpress/components';
import { useState } from '@wordpress/element';

import { useMappedField } from '../CollectionFieldsContext';
import { useUpdateRollup } from '../../hooks/useFieldMutations';
import { notifyCollectionRowsChanged } from '../../hooks/rowInvalidation';
import RollupConfig from './RollupConfig';

// Changes an existing rollup's relation, target field and calculation. Opened
// from the field menu and from the hint a flagged rollup shows in its cells.
export default function EditRollupPopover( {
	recordId,
	collectionId,
	anchor,
	onClose,
	onSaved,
} ) {
	const field = useMappedField( recordId );
	const update = useUpdateRollup();
	const [ errorMessage, setErrorMessage ] = useState( '' );

	if ( ! field ) {
		return null;
	}

	return (
		<Popover
			anchor={ anchor }
			placement="bottom-start"
			onClose={ onClose }
			focusOnMount="firstElement"
			className="cortext-rollup-popover-host"
		>
			<div className="cortext-data-view-toolbar-popover__content">
				<RollupConfig
					initialRelationFieldId={ field.rollupRelationFieldId }
					initialTargetFieldId={ field.rollupTargetFieldId || '' }
					initialAggregator={ field.rollupAggregator ?? 'count' }
					isEditing
					isBusy={ update.isBusy }
					errorMessage={ errorMessage }
					submitLabel={ __( 'Save rollup', 'cortext' ) }
					backLabel={ __( 'Cancel', 'cortext' ) }
					onBack={ onClose }
					onError={ setErrorMessage }
					onSubmit={ async ( config ) => {
						setErrorMessage( '' );
						await update.run( recordId, config );
						notifyCollectionRowsChanged( collectionId );
						onSaved?.();
						onClose();
					} }
				/>
			</div>
		</Popover>
	);
}
