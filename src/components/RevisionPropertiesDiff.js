import { PanelBody } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

import { useDocumentPropertiesContext } from './DocumentPropertiesContext';
import { useRevisionControls } from '../hooks/useRevisions';

export function metaValues( meta, key ) {
	if ( ! meta || ! Object.prototype.hasOwnProperty.call( meta, key ) ) {
		return [];
	}
	const value = meta[ key ];
	return Array.isArray( value ) ? value : [ value ];
}

export function valuesEqual( a, b ) {
	return JSON.stringify( a ?? [] ) === JSON.stringify( b ?? [] );
}

function stringifyValue( value ) {
	if ( value === null || value === undefined || value === '' ) {
		return '';
	}
	if ( typeof value === 'boolean' ) {
		return value ? __( 'Yes', 'cortext' ) : __( 'No', 'cortext' );
	}
	if ( typeof value === 'object' ) {
		return JSON.stringify( value );
	}
	return String( value );
}

export function displayValues( values, field ) {
	if ( ! Array.isArray( values ) || values.length === 0 ) {
		return __( 'Empty', 'cortext' );
	}
	if ( field?.cortextFieldType === 'checkbox' ) {
		return stringifyValue(
			[ true, '1', 1, 'true', 'yes', 'on' ].includes( values[ 0 ] )
		);
	}
	return (
		values
			.map( stringifyValue )
			.filter( ( value ) => value !== '' )
			.join( ', ' ) || __( 'Empty', 'cortext' )
	);
}

export default function RevisionPropertiesDiff() {
	const properties = useDocumentPropertiesContext();
	const { currentRevision, previousRevision } = useRevisionControls();
	const fields = Array.isArray( properties?.fields ) ? properties.fields : [];

	if ( fields.length === 0 || ! currentRevision ) {
		return null;
	}

	const changedFields = fields
		.filter( ( field ) => field?.cortextFieldType !== 'rollup' )
		.map( ( field ) => {
			const key = field.id;
			const before = metaValues( previousRevision?.meta, key );
			const after = metaValues( currentRevision?.meta, key );
			return {
				field,
				before,
				after,
				changed: ! valuesEqual( before, after ),
			};
		} )
		.filter( ( entry ) => entry.changed );

	return (
		<PanelBody
			title={ sprintf(
				/* translators: %d: number of changed properties. */
				__( 'Changed properties (%d)', 'cortext' ),
				changedFields.length
			) }
			initialOpen
		>
			{ changedFields.length === 0 ? (
				<p className="cortext-revision-properties__empty">
					{ __(
						'No properties changed in this revision.',
						'cortext'
					) }
				</p>
			) : (
				<div className="cortext-revision-properties">
					{ changedFields.map( ( { field, before, after } ) => (
						<div
							key={ field.id }
							className="cortext-revision-properties__field"
						>
							<div className="cortext-revision-properties__label">
								{ field.label }
							</div>
							<div className="cortext-revision-properties__values">
								<del>{ displayValues( before, field ) }</del>
								<ins>{ displayValues( after, field ) }</ins>
							</div>
						</div>
					) ) }
				</div>
			) }
		</PanelBody>
	);
}
