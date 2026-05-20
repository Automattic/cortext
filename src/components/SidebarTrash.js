import { __, sprintf, _n } from '@wordpress/i18n';
import { useDispatch } from '@wordpress/data';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import {
	Button,
	Spinner,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';
import { rotateLeft, trash } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import PageIcon from './PageIcon';
import TypeToConfirmDialog from './TypeToConfirmDialog';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import { FULL_PAGE_COLLECTION_QUERY } from '../collections';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';

const EMPTY_TRASHED_DOCUMENTS_STATE = {
	documents: [],
	total: 0,
	isLoading: false,
	hasResolved: true,
	error: null,
	refresh: () => {},
};

// Keep these in sync with the PHP cascade marker meta keys. Trash entries
// carry a marker pointing at the cascade root (page → subpage, page → owned
// inline collection) so the sidebar can fold descendants under their root.
const PARENT_MARKER_META = '_cortext_trashed_by_parent';
const OWNER_PAGE_MARKER_META = '_cortext_trashed_by_owner_page';

export function computeSidebarTrashRoots( trashedDocuments = [] ) {
	const all = Array.isArray( trashedDocuments ) ? trashedDocuments : [];
	const trashedById = new Map(
		all.map( ( document ) => [ document.id, document ] )
	);
	const childrenByMarker = new Map();

	const markerOf = ( document ) => {
		const meta = document.meta ?? {};
		// Pages → subpages share the original marker. Pages → owned inline
		// collections use a different key, but both point at a parent page
		// that's the cascade root.
		const parent = Number( meta[ PARENT_MARKER_META ] ?? 0 );
		if ( parent > 0 ) {
			return parent;
		}
		return Number( meta[ OWNER_PAGE_MARKER_META ] ?? 0 );
	};

	all.forEach( ( document ) => {
		const marker = markerOf( document );
		if ( marker > 0 && trashedById.has( marker ) ) {
			if ( ! childrenByMarker.has( marker ) ) {
				childrenByMarker.set( marker, [] );
			}
			childrenByMarker.get( marker ).push( document );
		}
	} );

	const roots = all.filter( ( document ) => {
		const marker = markerOf( document );
		return marker === 0 || ! trashedById.has( marker );
	} );

	const descendantCountById = new Map();
	roots.forEach( ( root ) => {
		const counts = { pages: 0, collections: 0, total: 0 };
		const stack = [ ...( childrenByMarker.get( root.id ) ?? [] ) ];
		while ( stack.length ) {
			const node = stack.pop();
			counts.total++;
			if ( node.kind === 'page' || node.type === POST_TYPE ) {
				counts.pages++;
			} else if (
				node.kind === 'collection' ||
				node.type === 'crtxt_collection'
			) {
				counts.collections++;
			}
			const kids = childrenByMarker.get( node.id );
			if ( kids ) {
				stack.push( ...kids );
			}
		}
		descendantCountById.set( root.id, counts );
	} );

	return { roots, descendantCountById };
}

function titleText( title, fallback ) {
	if ( typeof title === 'string' && title.trim() ) {
		return title.trim();
	}
	return title?.rendered?.trim() || title?.raw?.trim() || fallback;
}

function documentKind( document ) {
	if ( document?.kind ) {
		return document.kind;
	}
	if ( document?.type === POST_TYPE ) {
		return 'page';
	}
	if ( document?.type === 'crtxt_collection' ) {
		return 'collection';
	}
	return 'document';
}

function descendantLabel( rootKind, counts ) {
	// Mixed subtrees (page → subpage + page → owned inline collection) read
	// as "%d nested items" so the wording stays honest. Pure subtrees keep
	// the more specific noun.
	if ( rootKind === 'page' ) {
		if ( counts.pages > 0 && counts.collections === 0 ) {
			return sprintf(
				/* translators: %d: number of subpages */
				_n( '%d subpage', '%d subpages', counts.pages, 'cortext' ),
				counts.pages
			);
		}
		if ( counts.collections > 0 && counts.pages === 0 ) {
			return sprintf(
				/* translators: %d: number of nested inline collections */
				_n(
					'%d collection',
					'%d collections',
					counts.collections,
					'cortext'
				),
				counts.collections
			);
		}
	}

	return sprintf(
		/* translators: %d: number of nested trashed documents */
		_n( '%d nested item', '%d nested items', counts.total, 'cortext' ),
		counts.total
	);
}

/**
 * Sidebar Trash for Cortext documents.
 *
 * Trash shows cascade roots. Children that were trashed with a parent are
 * restored or deleted with that parent. If a marker points to a parent that is
 * no longer in Trash, the orphan still appears so it can be recovered.
 *
 * Mutations use the document Trash endpoints. Pages also refresh the page tree;
 * rows notify collection queries because relation chips and rollups can change
 * outside the row's own collection.
 *
 * @param {Object}      props
 * @param {Array}       props.activePages           Active page records for
 *                                                  breadcrumb lookup.
 * @param {number|null} props.selectedId            Currently-selected page id, used
 *                                                  to highlight a trashed document when
 *                                                  the canvas is showing it.
 * @param {number|null} props.selectedCollectionId  Currently-selected collection id, so
 *                                                  permanent delete can navigate away
 *                                                  when the open collection (or one of
 *                                                  its rows) is gone.
 * @param {Function}    props.onSelect              Opens a trashed document in
 *                                                  the canvas.
 * @param {Object}      props.trashedDocumentsState Trashed document query state.
 */
export default function SidebarTrash( {
	activePages,
	selectedId,
	selectedCollectionId = null,
	onSelect,
	trashedDocumentsState = EMPTY_TRASHED_DOCUMENTS_STATE,
} ) {
	const navigate = useNavigate();
	const {
		documents: trashedDocuments,
		isLoading: isResolvingTrash,
		error: trashError,
		hasResolved,
	} = trashedDocumentsState;

	const { invalidateResolution } = useDispatch( 'core' );

	const [ pendingDelete, setPendingDelete ] = useState( null );
	const [ rowError, setRowError ] = useState( null );
	const [ busyId, setBusyId ] = useState( null );
	const [ cachedTrashed, setCachedTrashed ] = useState( [] );
	const [ hasTrashCache, setHasTrashCache ] = useState( false );

	useEffect( () => {
		if (
			! trashError &&
			hasResolved &&
			Array.isArray( trashedDocuments )
		) {
			setCachedTrashed( trashedDocuments );
			setHasTrashCache( true );
		}
	}, [ hasResolved, trashError, trashedDocuments ] );

	const visibleTrashed =
		hasResolved && Array.isArray( trashedDocuments )
			? trashedDocuments
			: cachedTrashed;

	const ancestorById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		// Prefer active records for pages that somehow appear in both lists.
		// Their title is fresher than the trashed snapshot.
		visibleTrashed.forEach( ( document ) => {
			if ( ! map.has( document.id ) ) {
				map.set( document.id, document );
			}
		} );
		return map;
	}, [ activePages, visibleTrashed ] );

	// Roots are documents with no marker, plus documents whose marker points
	// at a parent that's no longer in Trash.
	const { roots, descendantCountById } = useMemo(
		() => computeSidebarTrashRoots( visibleTrashed ),
		[ visibleTrashed ]
	);

	const buildBreadcrumb = useCallback(
		( document ) => {
			const ancestors = [];
			let current = document.parent
				? ancestorById.get( document.parent )
				: null;
			const seen = new Set( [ document.id ] );
			while ( current && ! seen.has( current.id ) ) {
				seen.add( current.id );
				ancestors.unshift( {
					id: current.id,
					title:
						current.title?.rendered?.trim() ||
						__( '(untitled)', 'cortext' ),
					icon: current.meta?.cortext_document_icon ?? '',
				} );
				current = current.parent
					? ancestorById.get( current.parent )
					: null;
			}
			return ancestors;
		},
		[ ancestorById ]
	);

	const refreshQueries = useCallback( () => {
		invalidateResolution( 'getEntityRecords', [
			'postType',
			POST_TYPE,
			ACTIVE_PAGES_QUERY,
		] );
		invalidateResolution( 'getEntityRecords', [
			'postType',
			POST_TYPE,
			TRASHED_PAGES_QUERY,
		] );
		// Restoring a page can also restore collections. Refresh the full-page
		// list so they return to the sidebar.
		invalidateResolution( 'getEntityRecords', [
			'postType',
			'crtxt_collection',
			FULL_PAGE_COLLECTION_QUERY,
		] );
	}, [ invalidateResolution ] );

	const refreshTrash = useCallback( () => {
		trashedDocumentsState.refresh?.();
	}, [ trashedDocumentsState ] );

	const refreshRows = useCallback( () => {
		notifyCollectionRowsChanged();
		refreshTrash();
	}, [ refreshTrash ] );

	const restore = useCallback(
		async ( item ) => {
			const { id } = item;
			const kind = documentKind( item );
			setRowError( null );
			setBusyId( id );
			try {
				await apiFetch( {
					path: `/cortext/v1/documents/${ id }/restore`,
					method: 'POST',
				} );
				if ( kind === 'row' ) {
					refreshRows( item );
				} else {
					refreshQueries();
					refreshTrash();
				}
			} catch ( error ) {
				setRowError( {
					id,
					message:
						error?.message ??
						( kind === 'row'
							? __( 'Could not restore row.', 'cortext' )
							: __( 'Could not restore page.', 'cortext' ) ),
				} );
			} finally {
				setBusyId( null );
			}
		},
		[ refreshQueries, refreshRows, refreshTrash ]
	);

	const confirmPermanentDelete = useCallback( async () => {
		const item = pendingDelete;
		setPendingDelete( null );
		if ( ! item?.id ) {
			return;
		}
		const { id } = item;
		const kind = documentKind( item );
		setRowError( null );
		setBusyId( id );
		try {
			const response = await apiFetch( {
				path: `/cortext/v1/documents/${ id }/permanent-delete`,
				method: 'POST',
			} );
			// If the canvas was showing one of the deleted documents,
			// navigate away. Without this `useEntityRecord` would return
			// undefined and the canvas would spin forever (the document is
			// genuinely gone now, not just trashed). Collections track via
			// `selectedCollectionId`, so check both.
			const deletedIds = response?.deleted ?? [];
			const openId = selectedId ?? selectedCollectionId;
			if ( openId && deletedIds.includes( openId ) ) {
				onSelect( null );
			}
			if ( kind === 'row' ) {
				refreshRows( item );
			} else {
				refreshQueries();
				refreshTrash();
			}
		} catch ( error ) {
			setRowError( {
				id,
				message:
					error?.message ??
					( kind === 'row'
						? __( 'Could not delete row.', 'cortext' )
						: __( 'Could not delete page.', 'cortext' ) ),
			} );
		} finally {
			setBusyId( null );
		}
	}, [
		pendingDelete,
		refreshQueries,
		refreshRows,
		refreshTrash,
		selectedId,
		selectedCollectionId,
		onSelect,
	] );

	const isLoading = isResolvingTrash && ! hasTrashCache;
	const hasError = Boolean( trashError && ! hasTrashCache );
	const hasItems = roots.length > 0;
	const pendingKind = pendingDelete ? documentKind( pendingDelete ) : null;
	const pendingDescendantCounts = pendingDelete
		? descendantCountById.get( pendingDelete.id ) ?? {
				pages: 0,
				collections: 0,
				total: 0,
		  }
		: { pages: 0, collections: 0, total: 0 };
	const pendingDescendantCount = pendingDescendantCounts.total;
	const retryTrashFetch = useCallback( () => {
		invalidateResolution( 'getEntityRecords', [
			'postType',
			POST_TYPE,
			TRASHED_PAGES_QUERY,
		] );
		refreshTrash();
	}, [ invalidateResolution, refreshTrash ] );

	let pendingDeleteMessage = __(
		"Permanently delete this page? You can't undo this.",
		'cortext'
	);
	if ( pendingKind === 'row' ) {
		pendingDeleteMessage = __(
			"Permanently delete this row? You can't undo this.",
			'cortext'
		);
	} else if ( pendingKind === 'collection' ) {
		pendingDeleteMessage = __(
			"Permanently delete this collection and all its rows? You can't undo this.",
			'cortext'
		);
	} else if ( pendingKind === 'document' ) {
		pendingDeleteMessage = __(
			"Permanently delete this document? You can't undo this.",
			'cortext'
		);
	} else if ( pendingDescendantCount > 0 ) {
		// Mixed subtrees (subpages + inline collections) use the generic
		// "nested items" wording so the count stays correct without
		// pretending an inline collection is a subpage.
		if (
			pendingDescendantCounts.pages > 0 &&
			pendingDescendantCounts.collections === 0
		) {
			pendingDeleteMessage = sprintf(
				/* translators: %d: number of subpages that will be deleted along with the page. */
				_n(
					"Permanently delete this page and %d subpage? You can't undo this.",
					"Permanently delete this page and %d subpages? You can't undo this.",
					pendingDescendantCounts.pages,
					'cortext'
				),
				pendingDescendantCounts.pages
			);
		} else {
			pendingDeleteMessage = sprintf(
				/* translators: %d: number of nested trashed items deleted along with the page. */
				_n(
					"Permanently delete this page and %d nested item? You can't undo this.",
					"Permanently delete this page and %d nested items? You can't undo this.",
					pendingDescendantCount,
					'cortext'
				),
				pendingDescendantCount
			);
		}
	}
	if ( pendingDescendantCount > 0 && pendingKind === 'row' ) {
		pendingDeleteMessage = sprintf(
			/* translators: %d: number of nested items that will be deleted along with the row. */
			_n(
				"Permanently delete this row and %d nested item? You can't undo this.",
				"Permanently delete this row and %d nested items? You can't undo this.",
				pendingDescendantCount,
				'cortext'
			),
			pendingDescendantCount
		);
	} else if ( pendingDescendantCount > 0 && pendingKind === 'document' ) {
		pendingDeleteMessage = sprintf(
			/* translators: %d: number of nested items that will be deleted along with the document. */
			_n(
				"Permanently delete this document and %d nested item? You can't undo this.",
				"Permanently delete this document and %d nested items? You can't undo this.",
				pendingDescendantCount,
				'cortext'
			),
			pendingDescendantCount
		);
	}

	return (
		<>
			{ isLoading && (
				<div className="cortext-sidebar__loading">
					<Spinner />
				</div>
			) }

			{ ! isLoading && hasError && (
				<div className="cortext-sidebar__error" role="alert">
					<p>{ __( 'Could not load Trash.', 'cortext' ) }</p>
					<Button variant="secondary" onClick={ retryTrashFetch }>
						{ __( 'Retry', 'cortext' ) }
					</Button>
				</div>
			) }

			{ ! isLoading && ! hasError && ! hasItems && (
				<p className="cortext-sidebar__empty">
					{ __( 'Trash is empty.', 'cortext' ) }
				</p>
			) }

			{ ! isLoading && ! hasError && hasItems && (
				<ul className="cortext-sidebar__list cortext-sidebar__trash-list">
					{ roots.map( ( document ) => {
						const kind = documentKind( document );
						const title = titleText(
							document.title,
							__( '(untitled)', 'cortext' )
						);
						const breadcrumb =
							kind === 'page' ? buildBreadcrumb( document ) : [];
						const documentIcon =
							document.meta?.cortext_document_icon ?? '';
						const isBusy = busyId === document.id;
						const isSelected = selectedId === document.id;
						const error =
							rowError?.id === document.id ? rowError : null;
						const descendantCounts = descendantCountById.get(
							document.id
						) ?? {
							pages: 0,
							collections: 0,
							total: 0,
						};
						const meta = descendantCounts.total
							? descendantLabel( kind, descendantCounts )
							: '';
						const collectionTitle =
							kind === 'row'
								? titleText(
										document.collection?.title,
										__( 'Collection', 'cortext' )
								  )
								: '';
						// Inline collections are the only trash items with an
						// owner. Show that page title when the owner is still
						// active so similar inline tables are easier to tell
						// apart.
						const ownerTitle = document.owner
							? titleText(
									document.owner?.title,
									__( 'Page', 'cortext' )
							  )
							: '';
						const rowClasses = [ 'cortext-sidebar__row' ];
						if ( isSelected ) {
							rowClasses.push( 'is-selected' );
						}

						return (
							<li
								key={ document.id }
								className="cortext-sidebar__node cortext-sidebar__trash-row"
							>
								<div className={ rowClasses.join( ' ' ) }>
									<Button
										className="cortext-sidebar__title cortext-sidebar__trash-text"
										variant="tertiary"
										onClick={ () =>
											navigate( {
												to: '/$',
												params: {
													_splat: document.path,
												},
											} )
										}
									>
										<span className="cortext-sidebar__trash-title">
											<PageIcon
												icon={ documentIcon }
												size={ 14 }
												className="cortext-sidebar__trash-title-icon"
											/>
											<span className="cortext-sidebar__trash-title-text">
												{ title }
											</span>
										</span>
										{ ( breadcrumb.length > 0 ||
											collectionTitle ||
											ownerTitle ||
											meta ) && (
											<span className="cortext-sidebar__breadcrumb">
												{ breadcrumb.map(
													( crumb, index ) => (
														<span
															key={ crumb.id }
															className="cortext-sidebar__breadcrumb-crumb"
														>
															<PageIcon
																icon={
																	crumb.icon
																}
																size={ 12 }
															/>
															<span>
																{ crumb.title }
															</span>
															{ index <
																breadcrumb.length -
																	1 && (
																<span
																	className="cortext-sidebar__breadcrumb-sep"
																	aria-hidden="true"
																>
																	{ ' / ' }
																</span>
															) }
														</span>
													)
												) }
												{ ownerTitle && (
													<span>{ ownerTitle }</span>
												) }
												{ collectionTitle && (
													<span>
														{ collectionTitle }
													</span>
												) }
												{ meta && (
													<>
														{ ( breadcrumb.length >
															0 ||
															collectionTitle ||
															ownerTitle ) && (
															<span aria-hidden="true">
																{ ' · ' }
															</span>
														) }
														<span>{ meta }</span>
													</>
												) }
											</span>
										) }
									</Button>
									<div className="cortext-sidebar__trash-actions">
										<Button
											size="small"
											icon={ rotateLeft }
											label={ __( 'Restore', 'cortext' ) }
											disabled={ isBusy }
											onClick={ () =>
												restore( {
													...document,
													kind,
												} )
											}
										/>
										<Button
											size="small"
											icon={ trash }
											isDestructive
											label={ __(
												'Delete permanently',
												'cortext'
											) }
											disabled={ isBusy }
											onClick={ () =>
												setPendingDelete( {
													...document,
													kind,
												} )
											}
										/>
									</div>
								</div>
								{ error && (
									<p
										className="cortext-sidebar__row-error"
										role="alert"
									>
										{ error.message }
									</p>
								) }
							</li>
						);
					} ) }
				</ul>
			) }

			{ pendingDelete !== null &&
				( pendingKind === 'collection' ? (
					<TypeToConfirmDialog
						title={ __(
							'Delete collection permanently?',
							'cortext'
						) }
						message={ pendingDeleteMessage }
						confirmPhrase={ titleText(
							pendingDelete.title,
							__( '(untitled)', 'cortext' )
						) }
						confirmLabel={ __( 'Delete permanently', 'cortext' ) }
						onConfirm={ confirmPermanentDelete }
						onCancel={ () => setPendingDelete( null ) }
					/>
				) : (
					<ConfirmDialog
						onConfirm={ confirmPermanentDelete }
						onCancel={ () => setPendingDelete( null ) }
						confirmButtonText={ __(
							'Delete permanently',
							'cortext'
						) }
					>
						{ pendingDeleteMessage }
					</ConfirmDialog>
				) ) }
		</>
	);
}
