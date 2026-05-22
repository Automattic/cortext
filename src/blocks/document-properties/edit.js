import { __, _n, sprintf } from '@wordpress/i18n';
import {
	BlockControls,
	InspectorControls,
	useBlockProps,
} from '@wordpress/block-editor';
import { Button, ToolbarButton, ToolbarGroup } from '@wordpress/components';
import { seen, unseen } from '@wordpress/icons';

import DocumentPropertiesActions from '../../components/DocumentPropertiesActions';
import RowProperties from '../../components/RowProperties';
import { TITLE_FIELD_ID } from '../../components/dataViewColumns';
import { useDocumentPropertiesContext } from '../../components/DocumentPropertiesContext';

// Shows row properties between the title and body. Canvas and RowEditor provide
// the fields and fallback row record; pages and rows without fields return null.
export default function Edit() {
	const ctx = useDocumentPropertiesContext();
	const isVisible = ctx?.isVisible !== false;
	// RowProperties still expects the row-detail ancestor used by its nested
	// SCSS rules. The collapsed stub does not render RowProperties, so it does
	// not need that class.
	const blockProps = useBlockProps( {
		className: isVisible
			? 'cortext-document-properties cortext-row-detail'
			: 'cortext-document-properties cortext-document-properties--collapsed',
	} );
	if ( ! ctx ) {
		return null;
	}
	const { fields, fallbackRecord, isResolving, onToggleVisible } = ctx;
	if ( isResolving ) {
		return null;
	}
	if ( ! Array.isArray( fields ) || fields.length === 0 ) {
		return null;
	}

	const blockControls = onToggleVisible ? (
		<BlockControls>
			<ToolbarGroup>
				<ToolbarButton
					icon={ isVisible ? unseen : seen }
					label={
						isVisible
							? __( 'Hide fields', 'cortext' )
							: __( 'Show fields', 'cortext' )
					}
					onClick={ onToggleVisible }
				/>
			</ToolbarGroup>
		</BlockControls>
	) : null;
	const inspectorControls = (
		<InspectorControls>
			<DocumentPropertiesActions />
		</InspectorControls>
	);

	if ( ! isVisible ) {
		// Keep the hidden block selectable and give users a quick way to show
		// fields again. Match RowProperties by excluding the synthetic title
		// field from the count.
		const visibleFieldCount = fields.filter(
			( field ) => field.id !== TITLE_FIELD_ID
		).length;
		const label = sprintf(
			/* translators: %d: number of hidden property fields. */
			_n(
				'%d property hidden',
				'%d properties hidden',
				visibleFieldCount,
				'cortext'
			),
			visibleFieldCount
		);
		return (
			<>
				{ blockControls }
				{ inspectorControls }
				<div { ...blockProps }>
					<Button
						className="cortext-document-properties__collapsed-toggle"
						variant="tertiary"
						icon={ seen }
						onClick={ onToggleVisible }
					>
						{ label }
					</Button>
				</div>
			</>
		);
	}

	return (
		<>
			{ blockControls }
			{ inspectorControls }
			<div { ...blockProps }>
				<RowProperties fields={ fields } row={ fallbackRecord } />
			</div>
		</>
	);
}
