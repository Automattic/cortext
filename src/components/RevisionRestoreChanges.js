import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { __, sprintf } from '@wordpress/i18n';

import { useDocumentPropertiesContext } from './DocumentPropertiesContext';
import {
	PropertyChangesPanel,
	changedProperties,
} from './RevisionPropertiesDiff';
import { useRevisionControls } from '../hooks/useRevisions';

// Lists the property values a restore would overwrite: what the row holds now
// against what the selected revision holds. The canvas keeps showing the row's
// current values during a preview, so this is where the difference surfaces.
export default function RevisionRestoreChanges() {
	const properties = useDocumentPropertiesContext();
	const { currentRevision } = useRevisionControls();
	const editorMeta = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'meta' ),
		[]
	);
	const fields = Array.isArray( properties?.fields ) ? properties.fields : [];

	if ( fields.length === 0 || ! currentRevision ) {
		return null;
	}

	// A revision without its own metadata restores content only.
	const carriesMeta = currentRevision.cortext_carries_meta !== false;
	// The same sources, in the same order, as the values the row displays.
	const liveMeta = {
		...( editorMeta ?? {} ),
		...( properties?.fallbackRecord?.meta ?? {} ),
	};
	const changes = carriesMeta
		? changedProperties( fields, liveMeta, currentRevision.meta )
		: [];

	return (
		<PropertyChangesPanel
			title={ sprintf(
				/* translators: %d: number of properties a restore would change. */
				__( 'Restoring will change (%d)', 'cortext' ),
				changes.length
			) }
			emptyMessage={
				carriesMeta
					? __(
							'Restoring this revision leaves properties as they are.',
							'cortext'
					  )
					: __(
							'This version predates property history, so restoring it leaves properties as they are.',
							'cortext'
					  )
			}
			changes={ changes }
		/>
	);
}
