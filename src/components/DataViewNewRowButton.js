import apiFetch from '@wordpress/api-fetch';
import { Button, Notice } from '@wordpress/components';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { plus } from '@wordpress/icons';

// Pull a simple `is` prefill from the active filters. Multi-value operators
// are ignored for now; this path only handles one scalar value per field.
// Filters already run on GET /cortext/v1/rows, so prefill is only a convenience
// for new rows, not the reason filtering works.
function prefillFromFilters( filters, fieldIds ) {
	const prefill = {};
	if ( ! Array.isArray( filters ) ) {
		return prefill;
	}
	for ( const filter of filters ) {
		if ( ! filter || typeof filter !== 'object' ) {
			continue;
		}
		const op = filter.operator;
		if ( op !== 'is' ) {
			continue;
		}
		const { field, value } = filter;
		if ( ! field || field === 'title' ) {
			continue;
		}
		if ( Array.isArray( value ) || value === null || value === undefined ) {
			continue;
		}
		if ( ! fieldIds.has( field ) ) {
			continue;
		}
		prefill[ field ] = value;
	}
	return prefill;
}

export default function DataViewNewRowButton( {
	slug,
	view,
	fields,
	onCreated,
	disabled,
	presentation = 'footer',
} ) {
	const [ isCreating, setIsCreating ] = useState( false );
	const [ error, setError ] = useState( null );

	const prefillableFieldIds = useMemo(
		() =>
			new Set(
				fields
					.filter(
						( f ) =>
							f.editable !== false && f.cortextType !== 'rollup'
					)
					.map( ( f ) => f.id )
			),
		[ fields ]
	);

	const onClick = useCallback( async () => {
		setIsCreating( true );
		setError( null );
		const meta = prefillFromFilters( view?.filters, prefillableFieldIds );
		try {
			// FIXME: Consider supporting row creation via /cortext/v1/rows.
			const created = await apiFetch( {
				path: `/wp/v2/crtxt_${ slug }`,
				method: 'POST',
				data: {
					status: 'private',
					title: '',
					...( Object.keys( meta ).length ? { meta } : {} ),
				},
			} );
			onCreated( created );
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not create row.', 'cortext' )
			);
		} finally {
			setIsCreating( false );
		}
	}, [ slug, view, prefillableFieldIds, onCreated ] );

	const button = (
		<Button
			className={
				'cortext-data-view__new-row' +
				( presentation === 'grid-card'
					? ' cortext-data-view__new-row-card'
					: '' ) +
				( presentation === 'list-row'
					? ' cortext-data-view__new-row-list'
					: '' )
			}
			variant="tertiary"
			icon={ plus }
			onClick={ onClick }
			isBusy={ isCreating }
			disabled={ disabled || isCreating || ! slug }
		>
			{ __( 'New', 'cortext' ) }
		</Button>
	);
	const notice = error ? (
		<Notice
			status="error"
			isDismissible
			onRemove={ () => setError( null ) }
		>
			{ error }
		</Notice>
	) : null;

	if ( presentation === 'grid-card' ) {
		return (
			<div className="cortext-data-view__new-row-card-wrapper">
				{ button }
				{ notice }
			</div>
		);
	}

	return (
		<>
			{ button }
			{ notice }
		</>
	);
}
