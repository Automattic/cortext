import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

// DataViews labels its table header item "Hide column", while Cortext says
// where hiding applies (see docs/glossary.md). The string comes from DataViews
// alone, so swapping it in the default text domain leaves the rest of
// WordPress untouched. Drop this filter once DataViews says the same.
addFilter(
	'i18n.gettext_default',
	'cortext/data-views-field-terms',
	( translation, text ) => {
		if ( text === 'Hide column' ) {
			return __( 'Hide in view', 'cortext' );
		}
		return translation;
	}
);
