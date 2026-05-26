// DataViews table for one collection's rows. Columns are derived from
// the collection's schema (the `fields` array `extractAll` returned), so
// the table reshapes itself per collection without explicit per-type
// branches at this level.

import { __, sprintf } from '@wordpress/i18n';
import { useMemo, useState } from '@wordpress/element';
import {
	ExternalLink,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
} from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { dateI18n, getSettings as getDateSettings } from '@wordpress/date';
import { seen, upload } from '@wordpress/icons';

import ImportRowPreview from './ImportRowPreview';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };
const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];
const UNSORTABLE = new Set( [
	'multi_select',
	'people',
	'relation',
	'rollup',
] );
const FILTERABLE = new Set( [ 'select', 'status' ] );

function formatDateCell( value ) {
	if ( ! value ) {
		return '';
	}
	const hasTime = /T\d{2}:\d{2}/.test( value );
	if ( hasTime ) {
		const settings = getDateSettings();
		return dateI18n(
			`${ settings.formats.date } ${ settings.formats.time }`,
			value
		);
	}
	const [ y, m, d ] = value.split( '-' ).map( ( n ) => parseInt( n, 10 ) );
	if ( ! y || ! m || ! d ) {
		return value;
	}
	return `${ MONTH_NAMES[ m - 1 ] } ${ d }, ${ y }`;
}

// Exported so the row preview modal can render the same value shapes
// with the same formatting (pills, chips, formatted dates, etc.).
export function renderCell( field, value ) {
	if ( value === null || value === undefined ) {
		if ( field.type === 'checkbox' ) {
			return '☐';
		}
		return null;
	}
	switch ( field.type ) {
		case 'title':
		case 'rich_text':
			return value;
		case 'number':
			return String( value );
		case 'select':
		case 'status':
			return value ? (
				<span className="cortext-import-entries__pill">{ value }</span>
			) : null;
		case 'multi_select':
			if ( ! Array.isArray( value ) || value.length === 0 ) {
				return null;
			}
			return (
				<ul className="cortext-import-entries__chips">
					{ value.map( ( name ) => (
						<li
							key={ name }
							className="cortext-import-entries__chip"
						>
							{ name }
						</li>
					) ) }
				</ul>
			);
		case 'date':
			return formatDateCell( value );
		case 'checkbox':
			return value ? '☑' : '☐';
		case 'url':
			return <ExternalLink href={ value }>{ value }</ExternalLink>;
		case 'email':
			return <a href={ `mailto:${ value }` }>{ value }</a>;
		case 'phone_number':
			return <a href={ `tel:${ value }` }>{ value }</a>;
		case 'people':
			if ( ! Array.isArray( value ) || value.length === 0 ) {
				return null;
			}
			return value.map( ( p ) => p.name ?? p.id ).join( ', ' );
		case 'relation':
			if ( ! Array.isArray( value ) || value.length === 0 ) {
				return null;
			}
			return (
				<Text variant="muted">
					{ sprintf(
						/* translators: %d: number of related entries */
						__( '%d related', 'cortext' ),
						value.length
					) }
				</Text>
			);
		case 'formula':
		case 'rollup':
			return Array.isArray( value )
				? JSON.stringify( value )
				: String( value );
		default:
			return JSON.stringify( value );
	}
}

export default function ImportEntriesTable( { collection, entries } ) {
	const titleFieldId = collection.fields.find(
		( f ) => f.type === 'title'
	)?.id;
	const [ previewRow, setPreviewRow ] = useState( null );
	const [ previewMode, setPreviewMode ] = useState( 'side' );
	// Default to "everything selected" so the user can hit Import once to
	// bring the whole collection in.
	const [ selection, setSelection ] = useState( () =>
		entries.map( ( e ) => e.id )
	);

	const actions = useMemo(
		() => [
			{
				id: 'preview',
				label: __( 'Preview', 'cortext' ),
				icon: seen,
				isPrimary: true,
				callback: ( items ) => {
					const item = items?.[ 0 ];
					if ( item ) {
						setPreviewRow( item );
					}
				},
			},
			{
				id: 'import',
				label: __( 'Import', 'cortext' ),
				icon: upload,
				isPrimary: true,
				supportsBulk: true,
				callback: ( items ) => {
					// No-op for now — wiring up the UI shape before the
					// real import pipeline exists.
					// eslint-disable-next-line no-console
					console.log(
						'[cortext] Import (no-op):',
						items.map( ( i ) => i.id )
					);
				},
			},
		],
		[]
	);

	const fields = useMemo(
		() =>
			collection.fields.map( ( field ) => ( {
				id: field.id,
				label: field.name,
				enableHiding: field.type !== 'title',
				enableGlobalSearch: [ 'title', 'rich_text' ].includes(
					field.type
				),
				enableSorting: ! UNSORTABLE.has( field.type ),
				getValue: ( { item } ) => item.values?.[ field.id ] ?? null,
				render: ( { item } ) =>
					renderCell( field, item.values?.[ field.id ] ),
				elements:
					FILTERABLE.has( field.type ) && field.options
						? field.options.map( ( o ) => ( {
								value: o.name,
								label: o.name,
						  } ) )
						: undefined,
				filterBy: FILTERABLE.has( field.type )
					? { operators: [ 'is', 'isAny' ] }
					: undefined,
			} ) ),
		[ collection.fields ]
	);

	const [ view, setView ] = useState( () => ( {
		type: 'table',
		perPage: 25,
		page: 1,
		search: '',
		fields: collection.fields.map( ( f ) => f.id ),
		sort: titleFieldId
			? { field: titleFieldId, direction: 'asc' }
			: undefined,
		filters: [],
		layout: {},
	} ) );

	const { data, paginationInfo } = useMemo(
		() => filterSortAndPaginate( entries, view, fields ),
		[ entries, view, fields ]
	);

	return (
		<>
			<DataViews
				data={ data }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				paginationInfo={ paginationInfo }
				defaultLayouts={ DEFAULT_LAYOUTS }
				getItemId={ ( item ) => item.id }
				actions={ actions }
				selection={ selection }
				onChangeSelection={ setSelection }
				empty={
					<Text variant="muted">
						{ __( 'No rows in this collection.', 'cortext' ) }
					</Text>
				}
			/>
			{ previewRow && (
				<ImportRowPreview
					collection={ collection }
					row={ previewRow }
					mode={ previewMode }
					onModeChange={ setPreviewMode }
					onClose={ () => setPreviewRow( null ) }
				/>
			) }
		</>
	);
}
