import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

// DataViews titles its view options "Properties" and labels its table header
// item "Hide column", while Cortext calls both fields (see docs/glossary.md).
// Both strings come from DataViews alone, so swapping them in the default
// text domain leaves the rest of WordPress untouched. Drop this filter once
// DataViews uses the same words in its UI as in its `fields` API.
addFilter(
	'i18n.gettext_default',
	'cortext/data-views-field-terms',
	( translation, text ) => {
		if ( text === 'Properties' ) {
			return __( 'Fields', 'cortext' );
		}
		if ( text === 'Hide column' ) {
			return __( 'Hide in view', 'cortext' );
		}
		return translation;
	}
);
