import { __ } from '@wordpress/i18n';
import { Notice, Popover } from '@wordpress/components';
import { useMemo, useState } from '@wordpress/element';

import './ChangeFieldTypePopover.scss';

import { FIELD_TYPES, FieldTypeIcon } from './fieldTypes';
import { useChangeFieldType } from '../../hooks/useFieldMutations';

// These types depend on other fields or collections, so we do not offer them
// as conversion targets.
const UNCONVERTIBLE = new Set( [ 'relation', 'rollup', 'formula' ] );

function pickTargetTypes( currentType ) {
	return FIELD_TYPES.filter(
		( option ) =>
			option.value !== currentType && ! UNCONVERTIBLE.has( option.value )
	);
}

export default function ChangeFieldTypePopover( {
	anchor,
	collectionId,
	recordId,
	currentType,
	onClose,
	onTypeChanged,
} ) {
	const [ pending, setPending ] = useState( null );
	const commit = useChangeFieldType( collectionId );

	const targets = useMemo(
		() => pickTargetTypes( currentType ),
		[ currentType ]
	);

	const handlePick = async ( targetType ) => {
		if ( commit.isBusy ) {
			return;
		}
		setPending( targetType );
		try {
			await commit.run( recordId, targetType );
			onTypeChanged?.( targetType );
			onClose?.();
		} catch {
			// Keep the popover open so the inline error stays visible.
			setPending( null );
		}
	};

	return (
		<Popover
			anchor={ anchor }
			placement="bottom-start"
			onClose={ commit.isBusy ? () => {} : onClose }
			className="cortext-change-field-type-popover"
			focusOnMount="firstElement"
		>
			<div className="cortext-change-field-type-popover__body">
				<span className="cortext-change-field-type-popover__title">
					{ __( 'Change type', 'cortext' ) }
				</span>
				<div className="cortext-change-field-type-popover__grid">
					{ targets.map( ( option ) => (
						<button
							key={ option.value }
							type="button"
							className="cortext-change-field-type-popover__type-button"
							onClick={ () => handlePick( option.value ) }
							disabled={ commit.isBusy }
							aria-busy={ pending === option.value }
						>
							<FieldTypeIcon
								type={ option.value }
								className="cortext-change-field-type-popover__type-icon"
							/>
							<span>{ option.label }</span>
						</button>
					) ) }
				</div>
				{ commit.error && (
					<Notice status="error" isDismissible={ false }>
						{ commit.error?.message ??
							__( 'Could not change type.', 'cortext' ) }
					</Notice>
				) }
			</div>
		</Popover>
	);
}
