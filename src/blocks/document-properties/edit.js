import { useBlockProps } from '@wordpress/block-editor';

import RowProperties from '../../components/RowProperties';
import { useDocumentPropertiesContext } from '../../components/DocumentPropertiesContext';

// Renders the row's schema-driven properties between the title and body.
// Reads `fields` and the fallback record from `DocumentPropertiesProvider`
// installed by Canvas / RowEditor; returns null on surfaces without a
// provider (pages, rows without schema).
export default function Edit() {
	const blockProps = useBlockProps( {
		// `cortext-row-detail` keeps the BEM child rules inside
		// `RowProperties` working; they're SCSS-nested under that
		// ancestor today. `cortext-document-properties` is the public
		// hook for shared editor/front-end styles.
		className: 'cortext-document-properties cortext-row-detail',
	} );
	const ctx = useDocumentPropertiesContext();
	if ( ! ctx ) {
		return null;
	}
	const { fields, fallbackRecord, isResolving, isVisible } = ctx;
	if ( isResolving || ! isVisible ) {
		return null;
	}
	if ( ! Array.isArray( fields ) || fields.length === 0 ) {
		return null;
	}
	return (
		<div { ...blockProps }>
			<RowProperties fields={ fields } row={ fallbackRecord } />
		</div>
	);
}
