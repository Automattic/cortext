import { __ } from '@wordpress/i18n';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { useEntityRecords } from '@wordpress/core-data';
import {
	Button,
	ExternalLink,
	Spinner,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalHeading as Heading,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalText as Text,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { dateI18n, getSettings as getDateSettings } from '@wordpress/date';
import { useNavigate } from '@tanstack/react-router';

import './PublishedDocumentsPane.scss';

import DocumentIcon from './DocumentIcon';
import {
	POST_TYPE as DOCUMENT_POST_TYPE,
	PUBLISHED_DOCUMENTS_QUERY,
} from './page-queries';
import { computeDocumentUri } from '../router/useResolveEntity';
import { definesTrait, hasTrait } from '../documents/capabilities';

const DEFAULT_LAYOUTS = { table: { density: 'compact' }, grid: {}, list: {} };

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	search: '',
	fields: [ 'title', 'type', 'modified', 'link' ],
	sort: { field: 'modified', direction: 'desc' },
	filters: [],
	layout: {},
};

const TYPE_PAGE = 'page';
const TYPE_COLLECTION_ITEM = 'collection-item';
const TYPE_COLLECTION = 'collection';

function titleText( entity ) {
	const title = entity?.title;
	if ( typeof title === 'string' ) {
		return title.trim();
	}
	return title?.raw?.trim() || title?.rendered?.trim() || '';
}

function documentTypeValue( record ) {
	if ( definesTrait( record ) ) {
		return TYPE_COLLECTION;
	}
	if ( hasTrait( record ) ) {
		return TYPE_COLLECTION_ITEM;
	}
	return TYPE_PAGE;
}

function documentTypeLabel( record ) {
	if ( definesTrait( record ) ) {
		return __( 'Collection', 'cortext' );
	}
	if ( hasTrait( record ) ) {
		return __( 'Collection item', 'cortext' );
	}
	return __( 'Page', 'cortext' );
}

function buildItems( documents ) {
	const untitled = __( '(untitled)', 'cortext' );
	return ( documents ?? [] ).map( ( document ) => ( {
		key: `document-${ document.id }`,
		id: document.id,
		title: titleText( document ) || untitled,
		modified: document.modified ?? document.modified_gmt ?? '',
		link: document.link ?? '',
		icon: document?.meta?.cortext_document_icon ?? '',
		source: document,
	} ) );
}

function formatModified( value ) {
	if ( ! value ) {
		return '';
	}
	const dateSettings = getDateSettings();
	const format = `${ dateSettings.formats.date } ${ dateSettings.formats.time }`;
	return dateI18n( format, value );
}

export default function PublishedDocumentsPane() {
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const navigate = useNavigate();

	const { records: documents, isResolving: isLoading } = useEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		PUBLISHED_DOCUMENTS_QUERY
	);

	const openItem = useCallback(
		( item ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( item.source ) },
			} );
		},
		[ navigate ]
	);

	const items = useMemo( () => buildItems( documents ), [ documents ] );

	const fields = useMemo(
		() => [
			{
				id: 'title',
				label: __( 'Title', 'cortext' ),
				enableHiding: false,
				enableGlobalSearch: true,
				getValue: ( { item } ) => item.title,
				render: ( { item } ) => (
					<Button
						className="cortext-published-pane__title"
						onClick={ () => openItem( item ) }
					>
						<span
							className="cortext-published-pane__title-icon"
							aria-hidden="true"
						>
							<DocumentIcon icon={ item.icon } size={ 16 } />
						</span>
						<span className="cortext-published-pane__title-text">
							{ item.title }
						</span>
					</Button>
				),
			},
			{
				id: 'type',
				label: __( 'Type', 'cortext' ),
				elements: [
					{ value: TYPE_PAGE, label: __( 'Page', 'cortext' ) },
					{
						value: TYPE_COLLECTION_ITEM,
						label: __( 'Collection item', 'cortext' ),
					},
					{
						value: TYPE_COLLECTION,
						label: __( 'Collection', 'cortext' ),
					},
				],
				filterBy: { operators: [ 'is', 'isAny' ] },
				getValue: ( { item } ) => documentTypeValue( item.source ),
				render: ( { item } ) => documentTypeLabel( item.source ),
			},
			{
				id: 'modified',
				label: __( 'Modified', 'cortext' ),
				getValue: ( { item } ) => item.modified,
				render: ( { item } ) => formatModified( item.modified ),
			},
			{
				id: 'link',
				label: __( 'Public link', 'cortext' ),
				enableSorting: false,
				enableGlobalSearch: false,
				getValue: ( { item } ) => item.link,
				render: ( { item } ) => {
					if ( ! item.link ) {
						return (
							<Text variant="muted">
								{ __( 'N/A', 'cortext' ) }
							</Text>
						);
					}
					return (
						<ExternalLink href={ item.link }>
							{ __( 'View', 'cortext' ) }
						</ExternalLink>
					);
				},
			},
		],
		[ openItem ]
	);

	const { data: filteredItems, paginationInfo } = useMemo(
		() => filterSortAndPaginate( items, view, fields ),
		[ items, view, fields ]
	);

	if ( isLoading && items.length === 0 ) {
		return (
			<VStack className="cortext-published-pane" spacing={ 5 }>
				<Heading level={ 2 }>{ __( 'Published', 'cortext' ) }</Heading>
				<Spinner />
			</VStack>
		);
	}

	return (
		<VStack className="cortext-published-pane" spacing={ 5 }>
			<VStack spacing={ 1 }>
				<Heading level={ 2 }>{ __( 'Published', 'cortext' ) }</Heading>
				<Text variant="muted">
					{ __( 'Public on the web.', 'cortext' ) }
				</Text>
			</VStack>
			<DataViews
				data={ filteredItems }
				fields={ fields }
				view={ view }
				onChangeView={ setView }
				paginationInfo={ paginationInfo }
				defaultLayouts={ DEFAULT_LAYOUTS }
				getItemId={ ( item ) => item.key }
				isLoading={ isLoading }
				empty={
					<Text variant="muted">
						{ __( 'Nothing is public yet.', 'cortext' ) }
					</Text>
				}
			/>
		</VStack>
	);
}
