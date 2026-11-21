// The `cortext/property` block bindings source: fills a block attribute with
// one of the row's properties, such as an image from a URL property or a
// button's link. Values update as the property changes.
//
// The server registers the same source in `includes/Editor/PropertyBindings.php`.
import { registerBlockBindingsSource } from '@wordpress/blocks';
import { store as coreStore } from '@wordpress/core-data';
import { __ } from '@wordpress/i18n';

import { propertyKey, propertyText } from '../utils/propertyText';
import { selectRowPropertyFields } from '../utils/rowPropertyFields';

export const PROPERTY_BINDINGS_SOURCE = 'cortext/property';

// Attributes that take the stored value as is, since locale formatting would
// break a link or an attachment ID. Matches `PropertyBindings::RAW_ATTRIBUTES`.
const RAW_ATTRIBUTES = new Set( [ 'url', 'id', 'linkTarget', 'rel' ] );

export const propertyBindingsSource = {
	name: PROPERTY_BINDINGS_SOURCE,
	label: __( 'Document property', 'cortext' ),
	usesContext: [ 'postId', 'postType' ],
	getValues( { select, context, bindings } ) {
		const fields = selectRowPropertyFields( select, context?.postId );
		const record = select( coreStore ).getEditedEntityRecord(
			'postType',
			context?.postType,
			context?.postId
		);
		const values = {};
		for ( const [ attribute, binding ] of Object.entries( bindings ) ) {
			const field = fields.find(
				( entry ) => propertyKey( entry ) === binding.args?.key
			);
			values[ attribute ] = field
				? propertyText( field, record, {
						raw: RAW_ATTRIBUTES.has( attribute ),
				  } )
				: '';
		}
		return values;
	},
	canUserEditValue: () => false,
	getFieldsList( { select, context } ) {
		return selectRowPropertyFields( select, context?.postId ).map(
			( field ) => ( {
				label: field.label,
				type: 'string',
				args: { key: propertyKey( field ) },
			} )
		);
	},
};

registerBlockBindingsSource( propertyBindingsSource );
