import { __, sprintf, _n } from '@wordpress/i18n';
import { useEntityRecords } from '@wordpress/core-data';
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

import PageIcon from './PageIcon';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';

const EMPTY_TRASHED_ROWS_STATE = {
	rows: [],
	total: 0,
	isLoading: false,
	hasResolved: true,
	error: null,
	refresh: () => {},
};

// Must stay in sync with `PageTrashCascade::META_KEY` in PHP. The meta is
// exposed via REST as part of the `meta` field on each page record.
const MARKER_META = '_cortext_trashed_by_parent';

export function computeSidebarTrashRoots( trashedPages = [] ) {
	const all = Array.isArray( trashedPages ) ? trashedPages : [];
	const trashedById = new Map( all.map( ( page ) => [ page.id, page ] ) );
	const childrenByMarker = new Map();

	const markerOf = ( page ) => Number( page.meta?.[ MARKER_META ] ?? 0 );

	all.forEach( ( page ) => {
		const marker = markerOf( page );
		if ( marker > 0 && trashedById.has( marker ) ) {
			if ( ! childrenByMarker.has( marker ) ) {
				childrenByMarker.set( marker, [] );
			}
			childrenByMarker.get( marker ).push( page );
		}
	} );

	const roots = all.filter( ( page ) => {
		const marker = markerOf( page );
		return marker === 0 || ! trashedById.has( marker );
	} );

	const descendantCountById = new Map();
	roots.forEach( ( root ) => {
		let count = 0;
		const stack = [ ...( childrenByMarker.get( root.id ) ?? [] ) ];
		while ( stack.length ) {
			const node = stack.pop();
			count++;
			const kids = childrenByMarker.get( node.id );
			if ( kids ) {
				stack.push( ...kids );
			}
		}
		descendantCountById.set( root.id, count );
	} );

	return { roots, descendantCountById };
}

function titleText( title, fallback ) {
	if ( typeof title === 'string' && title.trim() ) {
		return title.trim();
	}
	return title?.rendered?.trim() || title?.raw?.trim() || fallback;
}

/**
 * Renders the sidebar Trash panel: a flat list of trashed page cascade roots
 * and trashed collection rows, with inline Restore and Delete-permanently
 * actions.
 *
 * Only cascade roots are listed. Subpages dragged into trash by a parent's
 * cascade ride along when the root is restored or permanently deleted, and
 * are intentionally hidden so the user manages whole trees rather than
 * fragments. Pages whose recorded parent has since been permanently deleted
 * (orphans with stale markers) get promoted back to roots so they remain
 * reachable.
 *
 * Restore goes through `/cortext/v1/documents/<id>/restore` and permanent delete
 * through `/cortext/v1/documents/<id>/permanent-delete`. Page mutations
 * invalidate page queries; row mutations invalidate the row trash list and the
 * affected collection.
 *
 * @param {Object}      props
 * @param {Array}       props.activePages      Active page records, used for
 *                                             breadcrumb ancestor lookup.
 * @param {number|null} props.selectedId       Currently-selected page id, used
 *                                             to highlight a trashed document when
 *                                             the canvas is showing it.
 * @param {Function}    props.onSelect         Called with a document id when a
 *                                             trashed page or row is clicked,
 *                                             navigating the canvas to that
 *                                             document (read-only view).
 * @param {Object}      props.trashedRowsState Trashed row query state.
 */
export default function SidebarTrash( {
	activePages,
	selectedId,
	onSelect,
	trashedRowsState = EMPTY_TRASHED_ROWS_STATE,
} ) {
	const {
		records: trashed,
		status,
		hasResolved,
	} = useEntityRecords( 'postType', POST_TYPE, TRASHED_PAGES_QUERY );

	const { invalidateResolution } = useDispatch( 'core' );

	const [ pendingDelete, setPendingDelete ] = useState( null );
	const [ rowError, setRowError ] = useState( null );
	const [ busyId, setBusyId ] = useState( null );
	const [ cachedTrashed, setCachedTrashed ] = useState( [] );
	const [ hasTrashCache, setHasTrashCache ] = useState( false );

	useEffect( () => {
		if ( status !== 'ERROR' && hasResolved && Array.isArray( trashed ) ) {
			setCachedTrashed( trashed );
			setHasTrashCache( true );
		}
	}, [ hasResolved, status, trashed ] );

	const visibleTrashed =
		hasResolved && Array.isArray( trashed ) ? trashed : cachedTrashed;

	const ancestorById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		// Trashed records take a back seat: a page that exists in both lists
		// (shouldn't happen, but guard anyway) is shown by its active title.
		visibleTrashed.forEach( ( page ) => {
			if ( ! map.has( page.id ) ) {
				map.set( page.id, page );
			}
		} );
		return map;
	}, [ activePages, visibleTrashed ] );

	// Cascade roots: pages with no marker, plus pages whose marker points at
	// a page that's no longer in trash (its tagged parent was permanently
	// deleted). Without the second clause those orphans would be hidden.
	const { roots, descendantCountById } = useMemo(
		() => computeSidebarTrashRoots( visibleTrashed ),
		[ visibleTrashed ]
	);
	const trashedRows = Array.isArray( trashedRowsState.rows )
		? trashedRowsState.rows
		: [];

	const buildBreadcrumb = useCallback(
		( page ) => {
			const ancestors = [];
			let current = page.parent ? ancestorById.get( page.parent ) : null;
			const seen = new Set( [ page.id ] );
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
	}, [ invalidateResolution ] );

	const refreshRows = useCallback( () => {
		notifyCollectionRowsChanged();
		trashedRowsState.refresh?.();
	}, [ trashedRowsState ] );

	const restore = useCallback(
		async ( item ) => {
			const { id, kind } = item;
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
		[ refreshQueries, refreshRows ]
	);

	const confirmPermanentDelete = useCallback( async () => {
		const item = pendingDelete;
		setPendingDelete( null );
		if ( ! item?.id ) {
			return;
		}
		const { id, kind } = item;
		setRowError( null );
		setBusyId( id );
		try {
			const response = await apiFetch( {
				path: `/cortext/v1/documents/${ id }/permanent-delete`,
				method: 'POST',
			} );
			// If the canvas was showing one of the deleted pages, navigate
			// away. Without this `useEntityRecord` would return undefined
			// and the canvas would spin forever (the page is genuinely gone
			// now, not just trashed).
			const deletedIds = response?.deleted ?? [];
			if ( selectedId && deletedIds.includes( selectedId ) ) {
				onSelect( null );
			}
			if ( kind === 'row' ) {
				refreshRows( item );
			} else {
				refreshQueries();
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
	}, [ pendingDelete, refreshQueries, refreshRows, selectedId, onSelect ] );

	const isLoadingPages = ! hasResolved && ! hasTrashCache;
	const isLoadingRows =
		trashedRowsState.isLoading &&
		! trashedRowsState.hasResolved &&
		trashedRows.length === 0;
	const isLoading = isLoadingPages || isLoadingRows;
	const hasPageError = status === 'ERROR' && ! hasTrashCache;
	const hasRowError = Boolean(
		trashedRowsState.error && ! trashedRows.length
	);
	const hasError = hasPageError || hasRowError;
	const hasItems = roots.length > 0 || trashedRows.length > 0;
	const pendingDescendantCount =
		pendingDelete?.kind === 'page'
			? descendantCountById.get( pendingDelete.id ) ?? 0
			: 0;
	const retryTrashFetch = useCallback( () => {
		invalidateResolution( 'getEntityRecords', [
			'postType',
			POST_TYPE,
			TRASHED_PAGES_QUERY,
		] );
		trashedRowsState.refresh?.();
	}, [ invalidateResolution, trashedRowsState ] );

	let pendingDeleteMessage = __(
		'Permanently delete this page? This cannot be undone.',
		'cortext'
	);
	if ( pendingDelete?.kind === 'row' ) {
		pendingDeleteMessage = __(
			'Permanently delete this row? This cannot be undone.',
			'cortext'
		);
	} else if ( pendingDescendantCount > 0 ) {
		pendingDeleteMessage = sprintf(
			/* translators: %d: number of subpages that will be deleted along with the page. */
			_n(
				'Permanently delete this page and %d subpage? This cannot be undone.',
				'Permanently delete this page and %d subpages? This cannot be undone.',
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
					{ __( 'No trashed items.', 'cortext' ) }
				</p>
			) }

			{ ! isLoading && ! hasError && hasItems && (
				<ul className="cortext-sidebar__list cortext-sidebar__trash-list">
					{ roots.map( ( page ) => {
						const title = titleText(
							page.title,
							__( '(untitled)', 'cortext' )
						);
						const breadcrumb = buildBreadcrumb( page );
						const pageIcon = page.meta?.cortext_document_icon ?? '';
						const isBusy = busyId === page.id;
						const isSelected = selectedId === page.id;
						const error =
							rowError?.id === page.id ? rowError : null;
						const subpages =
							descendantCountById.get( page.id ) ?? 0;
						const meta = subpages
							? sprintf(
									/* translators: %d: number of subpages */
									_n(
										'%d subpage',
										'%d subpages',
										subpages,
										'cortext'
									),
									subpages
							  )
							: '';
						const rowClasses = [ 'cortext-sidebar__row' ];
						if ( isSelected ) {
							rowClasses.push( 'is-selected' );
						}

						return (
							<li
								key={ page.id }
								className="cortext-sidebar__node cortext-sidebar__trash-row"
							>
								<div className={ rowClasses.join( ' ' ) }>
									<Button
										className="cortext-sidebar__title cortext-sidebar__trash-text"
										variant="tertiary"
										onClick={ () =>
											onSelect( page.id, page )
										}
									>
										<span className="cortext-sidebar__trash-title">
											<PageIcon
												icon={ pageIcon }
												size={ 14 }
												className="cortext-sidebar__trash-title-icon"
											/>
											<span className="cortext-sidebar__trash-title-text">
												{ title }
											</span>
										</span>
										{ ( breadcrumb.length > 0 || meta ) && (
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
												{ meta && (
													<>
														{ breadcrumb.length >
															0 && (
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
													...page,
													kind: 'page',
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
													...page,
													kind: 'page',
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
					{ trashedRows.map( ( row ) => {
						const title = titleText(
							row.title,
							__( '(untitled)', 'cortext' )
						);
						const collectionTitle = titleText(
							row.collection?.title,
							__( 'Collection', 'cortext' )
						);
						const rowIcon = row.meta?.cortext_document_icon ?? '';
						const isBusy = busyId === row.id;
						const isSelected = selectedId === row.id;
						const error = rowError?.id === row.id ? rowError : null;
						const rowClasses = [ 'cortext-sidebar__row' ];
						if ( isSelected ) {
							rowClasses.push( 'is-selected' );
						}

						return (
							<li
								key={ `row:${ row.id }` }
								className="cortext-sidebar__node cortext-sidebar__trash-row"
							>
								<div className={ rowClasses.join( ' ' ) }>
									<Button
										className="cortext-sidebar__title cortext-sidebar__trash-text"
										variant="tertiary"
										onClick={ () =>
											onSelect( row.id, row )
										}
									>
										<span className="cortext-sidebar__trash-title">
											<PageIcon
												icon={ rowIcon }
												size={ 14 }
												className="cortext-sidebar__trash-title-icon"
											/>
											<span className="cortext-sidebar__trash-title-text">
												{ title }
											</span>
										</span>
										<span className="cortext-sidebar__breadcrumb">
											{ collectionTitle }
										</span>
									</Button>
									<div className="cortext-sidebar__trash-actions">
										<Button
											size="small"
											icon={ rotateLeft }
											label={ __( 'Restore', 'cortext' ) }
											disabled={ isBusy }
											onClick={ () =>
												restore( {
													...row,
													kind: 'row',
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
													...row,
													kind: 'row',
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

			{ pendingDelete !== null && (
				<ConfirmDialog
					onConfirm={ confirmPermanentDelete }
					onCancel={ () => setPendingDelete( null ) }
					confirmButtonText={ __( 'Delete permanently', 'cortext' ) }
				>
					{ pendingDeleteMessage }
				</ConfirmDialog>
			) }
		</>
	);
}
