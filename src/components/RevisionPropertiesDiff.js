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

// The REST API reports an unset single-value key as its type's default, and
// the oldest revision has no predecessor to read values from. Both describe a
// property that holds nothing.
export function isBlank( values ) {
	return values.every(
		( value ) =>
			value === '' ||
			value === null ||
			value === undefined ||
			value === 0 ||
			value === false
	);
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

// Properties whose stored value differs between two meta maps. Rollups are
// computed, so neither a revision nor a restore owns their value.
export function changedProperties( fields, beforeMeta, afterMeta ) {
	return fields
		.filter( ( field ) => field?.cortextFieldType !== 'rollup' )
		.map( ( field ) => ( {
			field,
			before: metaValues( beforeMeta, field.id ),
			after: metaValues( afterMeta, field.id ),
		} ) )
		.filter(
			( { before, after } ) =>
				! valuesEqual( before, after ) &&
				! ( isBlank( before ) && isBlank( after ) )
		);
}

export function PropertyChangesPanel( { title, emptyMessage, changes } ) {
	return (
		<PanelBody title={ title } initialOpen>
			{ changes.length === 0 ? (
				<p className="cortext-revision-properties__empty">
					{ emptyMessage }
				</p>
			) : (
				<div className="cortext-revision-properties">
					{ changes.map( ( { field, before, after } ) => (
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

export default function RevisionPropertiesDiff() {
	const properties = useDocumentPropertiesContext();
	const { currentRevision, previousRevision } = useRevisionControls();
	const fields = Array.isArray( properties?.fields ) ? properties.fields : [];

	if ( fields.length === 0 || ! currentRevision ) {
		return null;
	}

	const changes = changedProperties(
		fields,
		previousRevision?.meta,
		currentRevision?.meta
	);

	return (
		<PropertyChangesPanel
			title={ sprintf(
				/* translators: %d: number of changed properties. */
				__( 'Changed properties (%d)', 'cortext' ),
				changes.length
			) }
			emptyMessage={ __(
				'No properties changed in this revision.',
				'cortext'
			) }
			changes={ changes }
		/>
	);
}
