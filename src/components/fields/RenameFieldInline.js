import { __ } from '@wordpress/i18n';
import { TextControl } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';

import { useRenameField } from '../../hooks/useFieldMutations';
import { useMappedField } from '../CollectionFieldsContext';

// Inline rename control for a column header. It starts from the collection's
// mapped field data, so opening rename does not refetch the field record.
export default function RenameFieldInline( {
	recordId,
	initialTitle: fallbackTitle = '',
	onDone,
} ) {
	const mappedField = useMappedField( recordId );
	const initialTitle = mappedField?.label ?? fallbackTitle;
	const [ value, setValue ] = useState( initialTitle );
	const inputRef = useRef( null );
	const { run, isBusy } = useRenameField();

	useEffect( () => {
		setValue( initialTitle );
	}, [ initialTitle ] );

	useEffect( () => {
		const node = inputRef.current?.querySelector( 'input' );
		if ( node ) {
			node.focus();
			node.select();
		}
	}, [] );

	const commit = async () => {
		const trimmed = value.trim();
		if ( ! trimmed || trimmed === initialTitle ) {
			onDone?.();
			return;
		}
		try {
			await run( recordId, trimmed );
		} catch {
			// Caller hasn't observed an error path; revert UI state and
			// let the user retry from the kebab again.
		}
		onDone?.();
	};

	return (
		<span ref={ inputRef } className="cortext-rename-field-inline">
			<TextControl
				value={ value }
				onChange={ setValue }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' ) {
						event.preventDefault();
						commit();
					} else if ( event.key === 'Escape' ) {
						event.preventDefault();
						onDone?.();
					}
				} }
				onBlur={ commit }
				disabled={ isBusy }
				aria-label={ __( 'Field name', 'cortext' ) }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
		</span>
	);
}
