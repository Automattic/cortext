import { Button } from '@wordpress/components';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import EditableCell from './EditableCell';
import DocumentIcon from './DocumentIcon';
import { ROW_DETAIL_MODE_ICONS } from './RowDetailView';
import { COVER_FIELD_ID, TITLE_FIELD_ID } from './dataViewColumns';
import { dataViewsFilterByForType } from '../hooks/fieldMapping';

export const TITLE_LABEL = __( 'Title', 'cortext' );
const TITLE_FILTER_OPERATORS = [
	'is',
	'isNot',
	'contains',
	'notContains',
	'startsWith',
	'endsWith',
	'isEmpty',
	'isNotEmpty',
];

export const OpenRowActionContext = createContext( {
	enabled: false,
	icon: ROW_DETAIL_MODE_ICONS.side,
	openRowId: null,
	requestOpenRow: null,
	showInlineOpen: true,
} );

// The peek panel cannot render until the editor is ready. On slower loads a
// row click can feel like nothing happened, so pointerdown applies a short
// "opening" state immediately.
const OPENING_FEEDBACK_TIMEOUT_MS = 600;

function TitleCell( { item } ) {
	const { enabled, icon, openRowId, requestOpenRow, showInlineOpen } =
		useContext( OpenRowActionContext );
	const canOpenRow = Boolean( enabled && requestOpenRow );
	const isOpenRow = canOpenRow && String( item?.id ) === String( openRowId );
	const documentIcon = item?.meta?.cortext_document_icon ?? '';
	const [ isOpening, setIsOpening ] = useState( false );
	const openingTimeoutRef = useRef( null );

	const clearOpeningTimeout = useCallback( () => {
		if ( openingTimeoutRef.current ) {
			clearTimeout( openingTimeoutRef.current );
			openingTimeoutRef.current = null;
		}
	}, [] );

	useEffect( () => clearOpeningTimeout, [ clearOpeningTimeout ] );

	// Once this row owns the open peek, --is-open handles the visual state.
	// Drop the short-lived opening state so it cannot linger after a quick close.
	useEffect( () => {
		if ( isOpenRow && isOpening ) {
			clearOpeningTimeout();
			setIsOpening( false );
		}
	}, [ clearOpeningTimeout, isOpening, isOpenRow ] );

	const openRow = useCallback(
		( event ) => {
			event.preventDefault();
			event.stopPropagation();
			requestOpenRow?.( item );
		},
		[ item, requestOpenRow ]
	);
	const handleOpenPointerDown = useCallback(
		( event ) => {
			event.stopPropagation();
			if ( ! canOpenRow || isOpenRow ) {
				return;
			}
			setIsOpening( true );
			clearOpeningTimeout();
			openingTimeoutRef.current = setTimeout( () => {
				openingTimeoutRef.current = null;
				setIsOpening( false );
			}, OPENING_FEEDBACK_TIMEOUT_MS );
		},
		[ canOpenRow, clearOpeningTimeout, isOpenRow ]
	);
	const stopPropagation = useCallback( ( event ) => {
		event.stopPropagation();
	}, [] );

	return (
		<div
			className={
				'cortext-title-cell' +
				( canOpenRow && showInlineOpen
					? ' cortext-title-cell--with-open-action'
					: '' ) +
				( isOpenRow ? ' cortext-title-cell--is-open' : '' ) +
				( isOpening && ! isOpenRow
					? ' cortext-title-cell--is-opening'
					: '' )
			}
		>
			{ documentIcon ? (
				<span className="cortext-title-cell__icon" aria-hidden="true">
					<DocumentIcon icon={ documentIcon } />
				</span>
			) : null }
			<EditableCell
				item={ item }
				fieldId="title"
				fieldType="title"
				label={ TITLE_LABEL }
				readOnly={ ! showInlineOpen }
				getValue={ ( ctx ) =>
					ctx.item?.title?.raw ?? ctx.item?.title?.rendered ?? ''
				}
			/>
			{ canOpenRow && showInlineOpen ? (
				<Button
					className="cortext-title-cell__open"
					icon={ icon }
					label={ __( 'Open', 'cortext' ) }
					size="small"
					variant="tertiary"
					onClick={ openRow }
					onMouseDown={ stopPropagation }
					onPointerDown={ handleOpenPointerDown }
				>
					{ __( 'Open', 'cortext' ) }
				</Button>
			) : null }
		</div>
	);
}

export const TITLE_FIELD = {
	id: TITLE_FIELD_ID,
	type: 'text',
	label: TITLE_LABEL,
	header: (
		<span className="cortext-column-header-label">{ TITLE_LABEL }</span>
	),
	// Prefer `title.raw` over `title.rendered` so sort comparisons use
	// the unfiltered string (the_title encodes `&` as `&#038;`, which
	// would otherwise sort under that literal entity). Same reason as
	// `mapField`'s label fallback in `src/hooks/fieldMapping.js`.
	getValue: ( { item } ) => {
		const title = item?.title;
		return typeof title === 'string'
			? title
			: title?.raw ?? title?.rendered ?? '';
	},
	render: ( { item } ) => <TitleCell item={ item } />,
	editable: true,
	cortextType: 'title',
	sortable: true,
	filterable: true,
	operators: TITLE_FILTER_OPERATORS,
	filterBy: dataViewsFilterByForType( 'text', TITLE_FILTER_OPERATORS ),
	enableGlobalSearch: true,
	// The title column can't be hidden (it's the row identity), but it
	// reorders and resizes like any other column. `normalizeView` re-adds
	// the id to `view.fields` if something corrupts the saved state.
	enableHiding: false,
};

export const COVER_FIELD = {
	id: COVER_FIELD_ID,
	type: 'media',
	label: __( 'Cover', 'cortext' ),
	header: <span>{ __( 'Cover', 'cortext' ) }</span>,
	enableSorting: false,
	enableGlobalSearch: false,
	editable: false,
	getValue: ( { item } ) => item?.cover?.url ?? '',
	render: ( { item } ) => {
		const cover = item?.cover;
		if ( ! cover?.url ) {
			return null;
		}
		return (
			<img
				className="cortext-data-view__cover-image"
				src={ cover.url }
				alt={ cover.alt ?? '' }
				loading="lazy"
				decoding="async"
			/>
		);
	},
};
