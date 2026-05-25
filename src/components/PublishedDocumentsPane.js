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

import Infotip from './Infotip';
import PageIcon from './PageIcon';
import {
	POST_TYPE as PAGE_POST_TYPE,
	PUBLISHED_PAGES_QUERY,
} from './page-queries';
import { PUBLISHED_COLLECTIONS_QUERY } from '../collections';
import {
	computeCollectionUri,
	computeDocumentUri,
} from '../router/useResolveEntity';

const COLLECTION_POST_TYPE = 'crtxt_collection';

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

const TYPE_LABELS = {
	page: __( 'Page', 'cortext' ),
	collection: __( 'Collection', 'cortext' ),
};

function titleText( entity ) {
	const title = entity?.title;
	if ( typeof title === 'string' ) {
		return title.trim();
	}
	return title?.raw?.trim() || title?.rendered?.trim() || '';
}

// DataViews can't natively de-duplicate two record sets coming from different
// post types because ids collide (a page #4 and a collection #4 are unrelated
// entities). The composite `${kind}-${id}` key keeps them distinct in the
// table while preserving the underlying record on `.source` for navigation
// and link rendering.
function buildItems( pages, collections ) {
	const items = [];
	const untitled = __( '(untitled)', 'cortext' );

	const pagesById = new Map();
	for ( const page of pages ?? [] ) {
		pagesById.set( page.id, page );
	}

	for ( const page of pages ?? [] ) {
		items.push( {
			key: `page-${ page.id }`,
			id: page.id,
			kind: 'page',
			postType: PAGE_POST_TYPE,
			title: titleText( page ) || untitled,
			modified: page.modified ?? page.modified_gmt ?? '',
			link: page.link ?? '',
			icon: page?.meta?.cortext_document_icon ?? '',
			source: page,
		} );
	}

	for ( const collection of collections ?? [] ) {
		const mode = collection?.meta?.workspace_mode ?? '';
		const ownerId = collection?.meta?._cortext_inline_owner_page ?? 0;
		// Owner page may not be in `pages` when its status is draft/private
		// while the inline collection is published. The render falls back to
		// a title-less "Embedded in a page" in that case.
		const ownerPage = ownerId ? pagesById.get( ownerId ) ?? null : null;
		items.push( {
			key: `collection-${ collection.id }`,
			id: collection.id,
			kind: 'collection',
			postType: COLLECTION_POST_TYPE,
			title: titleText( collection ) || untitled,
			modified: collection.modified ?? collection.modified_gmt ?? '',
			link: '',
			icon: collection?.meta?.cortext_document_icon ?? '',
			source: collection,
			workspaceMode: mode,
			ownerPage,
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
			COLLECTION_POST_TYPE,
			PUBLISHED_COLLECTIONS_QUERY
		);

	const isLoading = isResolvingPages || isResolvingCollections;

	const openItem = useCallback(
		( item ) => {
			const splat =
				item.kind === 'collection'
					? computeCollectionUri( item.source )
					: computeDocumentUri( item.source );
			navigate( { to: '/$', params: { _splat: splat } } );
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
							<PageIcon icon={ item.icon } size={ 16 } />
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
					{ value: 'page', label: TYPE_LABELS.page },
					{ value: 'collection', label: TYPE_LABELS.collection },
				],
				filterBy: { operators: [ 'is', 'isAny' ] },
				getValue: ( { item } ) => item.kind,
				render: ( { item } ) => TYPE_LABELS[ item.kind ] ?? item.kind,
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
					if ( item.kind === 'page' ) {
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
					}
					if ( item.workspaceMode !== 'inline' ) {
						return (
							<span className="cortext-published-pane__na">
								<Text variant="muted">
									{ __( 'N/A', 'cortext' ) }
								</Text>
								<Infotip
									description={ __(
										'While this collection does not have a URL, its data is nevertheless publicly accessible.',
										'cortext'
									) }
								/>
							</span>
						);
					}
					if ( ! item.ownerPage ) {
						return (
							<Text variant="muted">
								{ __( 'Embedded in a page', 'cortext' ) }
							</Text>
						);
					}
					const ownerTitle =
						titleText( item.ownerPage ) ||
						__( '(untitled)', 'cortext' );
					return (
						<Text variant="muted">
							{ __( 'Embedded in', 'cortext' ) }{ ' ' }
							<Button
								variant="link"
								onClick={ () =>
									openItem( {
										kind: 'page',
										source: item.ownerPage,
									} )
								}
							>
								{ ownerTitle }
							</Button>
						</Text>
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
