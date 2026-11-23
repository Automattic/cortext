import { __ } from '@wordpress/i18n';
import { useContext, useState } from '@wordpress/element';

import CollectionFieldsContext, {
	useIsSchemaFrozen,
} from '../collectionFieldsContextObject';
import EditRollupPopover from './EditRollupPopover';

// What a flagged rollup shows instead of a value. `reason` is the validation
// error the server stored, without its `cortext_rollup_` prefix.
export function rollupInvalidLabel( reason ) {
	switch ( reason ) {
		case 'target_must_be_number':
		case 'target_must_be_date':
			return __( 'Target property changed type', 'cortext' );
		case 'relation_invalid':
		case 'source_not_relation':
			return __( 'Relation is in another collection', 'cortext' );
		case 'target_invalid':
		case 'target_required':
			return __( 'Target property is missing', 'cortext' );
		default:
			return __( 'Rollup needs a fix', 'cortext' );
	}
}

// Opens the rollup editor where the schema can change; elsewhere (frozen
// collections, static previews) it stays plain text.
export default function RollupInvalidHint( {
	recordId,
	reason,
	collectionId,
	isStatic = false,
	onSaved,
} ) {
	const context = useContext( CollectionFieldsContext );
	const isSchemaFrozen = useIsSchemaFrozen();
	const [ isEditing, setIsEditing ] = useState( false );
	const [ anchor, setAnchor ] = useState( null );
	const label = rollupInvalidLabel( reason );
	const editCollectionId = collectionId ?? context?.collection?.id;

	if ( isStatic || isSchemaFrozen || ! context || ! editCollectionId ) {
		return <span className="cortext-rollup-invalid">{ label }</span>;
	}

	return (
		<>
			<button
				type="button"
				ref={ setAnchor }
				className="cortext-rollup-invalid cortext-rollup-invalid--action"
				aria-haspopup="dialog"
				onClick={ ( event ) => {
					// The cell would otherwise treat the click as its own.
					event.stopPropagation();
					setIsEditing( true );
				} }
			>
				{ label }
			</button>
			{ isEditing ? (
				<EditRollupPopover
					recordId={ recordId }
					collectionId={ editCollectionId }
					anchor={ anchor }
					onClose={ () => setIsEditing( false ) }
					onSaved={ onSaved }
				/>
			) : null }
		</>
	);
}
