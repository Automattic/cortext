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
	POST_TYPE as PAGE_POST_TYPE,
	PUBLISHED_PAGES_QUERY,
} from './page-queries';
import {
	DOCUMENT_POST_TYPE,
	PUBLISHED_COLLECTIONS_QUERY,
} from '../collections';
import { computeDocumentUri } from '../router/useResolveEntity';
import { hasFields } from '../documents/capabilities';
import { documentLabel } from '../documents/labels';

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

// Local enum values for the Type filter. These stay in this component so
// DataViews has stable filter elements; the display label still comes from
// `documentLabel` reading capabilities.
const FILTER_PAGE = 'page';
const FILTER_COLLECTION = 'collection';

function titleText( entity ) {
	const title = entity?.title;
	if ( typeof title === 'string' ) {
		return title.trim();
	}
	return title?.raw?.trim() || title?.rendered?.trim() || '';
}

// Pages and collections both live in `crtxt_document`, so ids do not collide,
// but the lists arrive from separate queries (`/wp/v2/pages` vs the universal
// document filter for collections). Capability-derived `source` flags drive
// the Type filter; `.source` carries the underlying record for navigation
// and link rendering.
function buildItems( pages, collections ) {
	const items = [];
	const untitled = __( '(untitled)', 'cortext' );

	for ( const page of pages ?? [] ) {
		items.push( {
			key: `page-${ page.id }`,
			id: page.id,
			postType: PAGE_POST_TYPE,
			title: titleText( page ) || untitled,
			modified: page.modified ?? page.modified_gmt ?? '',
			link: page.link ?? '',
			icon: page?.meta?.cortext_document_icon ?? '',
			source: page,
		} );
	}

	for ( const collection of collections ?? [] ) {
		items.push( {
			key: `collection-${ collection.id }`,
			id: collection.id,
			postType: DOCUMENT_POST_TYPE,
			title: titleText( collection ) || untitled,
			modified: collection.modified ?? collection.modified_gmt ?? '',
			link: collection.link ?? '',
			icon: collection?.meta?.cortext_document_icon ?? '',
			source: collection,
		} );
	}

	return items;
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

	const { records: pages, isResolving: isResolvingPages } = useEntityRecords(
		'postType',
		PAGE_POST_TYPE,
		PUBLISHED_PAGES_QUERY
	);
	const { records: collections, isResolving: isResolvingCollections } =
		useEntityRecords(
			'postType',
			DOCUMENT_POST_TYPE,
			PUBLISHED_COLLECTIONS_QUERY
		);

	const isLoading = isResolvingPages || isResolvingCollections;

	const openItem = useCallback(
		( item ) => {
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( item.source ) },
			} );
		},
		[ navigate ]
	);

	const items = useMemo(
		() => buildItems( pages, collections ),
		[ pages, collections ]
	);

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
					{ value: FILTER_PAGE, label: __( 'Page', 'cortext' ) },
					{
						value: FILTER_COLLECTION,
						label: __( 'Collection', 'cortext' ),
					},
				],
				filterBy: { operators: [ 'is', 'isAny' ] },
				getValue: ( { item } ) =>
					hasFields( item.source ) ? FILTER_COLLECTION : FILTER_PAGE,
				render: ( { item } ) => documentLabel( item.source ),
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
				<Heading level={ 2 }>
					{ __( 'Published documents', 'cortext' ) }
				</Heading>
				<Spinner />
			</VStack>
		);
	}

	return (
		<VStack className="cortext-published-pane" spacing={ 5 }>
			<VStack spacing={ 1 }>
				<Heading level={ 2 }>
					{ __( 'Published documents', 'cortext' ) }
				</Heading>
				<Text variant="muted">
					{ __(
						'Pages and collections that are currently public.',
						'cortext'
					) }
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
						{ __(
							'No documents are currently public.',
							'cortext'
						) }
					</Text>
				}
			/>
		</VStack>
	);
}
