import { __, sprintf, _n } from '@wordpress/i18n';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useCallback, useMemo, useState } from '@wordpress/element';
import {
	Button,
	Spinner,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';
import { rotateLeft, trash } from '@wordpress/icons';

import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';

const MARKER_META = '_cortext_trashed_by_parent';

/**
 * Renders the sidebar Trash section: a flat list of trashed pages with a
 * breadcrumb on each row plus inline Restore and Delete-permanently actions.
 *
 * Only cascade roots are listed. Subpages dragged into trash by a parent's
 * cascade ride along when the root is restored or permanently deleted, and
 * are intentionally hidden so the user manages whole trees rather than
 * fragments. Pages whose recorded parent has since been permanently deleted
 * (orphans with stale markers) get promoted back to roots so they remain
 * reachable.
 *
 * Restore goes through `/cortext/v1/pages/<id>/restore` and permanent delete
 * through `/cortext/v1/pages/<id>/permanent-delete`. Both endpoints invoke
 * `PageTrashCascade`'s subtree handling on the server; the client only needs
 * to invalidate the page queries afterwards.
 *
 * @param {Object}      props
 * @param {Array}       props.activePages Active page records, used for
 *                                        breadcrumb ancestor lookup.
 * @param {number|null} props.selectedId  Currently-selected page id, used
 *                                        to highlight a trashed row when
 *                                        the canvas is showing it.
 * @param {Function}    props.onSelect    Called with a page id when a row
 *                                        is clicked, navigating the canvas
 *                                        to that page (read-only view).
 */
export default function SidebarTrash( { activePages, selectedId, onSelect } ) {
	const {
		records: trashed,
		status,
		hasResolved,
	} = useEntityRecords( 'postType', POST_TYPE, TRASHED_PAGES_QUERY );

	const { invalidateResolution } = useDispatch( 'core' );

	const [ pendingDeleteId, setPendingDeleteId ] = useState( null );
	const [ rowError, setRowError ] = useState( null );
	const [ busyId, setBusyId ] = useState( null );

	const ancestorById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		// Trashed records take a back seat: a page that exists in both lists
		// (shouldn't happen, but guard anyway) is shown by its active title.
		( trashed ?? [] ).forEach( ( page ) => {
			if ( ! map.has( page.id ) ) {
				map.set( page.id, page );
			}
		} );
		return map;
	}, [ activePages, trashed ] );

	// Cascade roots: pages with no marker, plus pages whose marker points at
	// a page that's no longer in trash (its tagged parent was permanently
	// deleted). Without the second clause those orphans would be hidden.
	const { roots, descendantCountById } = useMemo( () => {
		const all = trashed ?? [];
		const trashedById = new Map( all.map( ( p ) => [ p.id, p ] ) );
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

		const computedRoots = all.filter( ( page ) => {
			const marker = markerOf( page );
			return marker === 0 || ! trashedById.has( marker );
		} );

		const counts = new Map();
		computedRoots.forEach( ( root ) => {
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
			counts.set( root.id, count );
		} );

		return { roots: computedRoots, descendantCountById: counts };
	}, [ trashed ] );

	const buildBreadcrumb = useCallback(
		( page ) => {
			const titles = [];
			let current = page.parent ? ancestorById.get( page.parent ) : null;
			const seen = new Set( [ page.id ] );
			while ( current && ! seen.has( current.id ) ) {
				seen.add( current.id );
				titles.unshift(
					current.title?.rendered?.trim() ||
						__( '(untitled)', 'cortext' )
				);
				current = current.parent
					? ancestorById.get( current.parent )
					: null;
			}
			return titles;
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

	const restore = useCallback(
		async ( id ) => {
			setRowError( null );
			setBusyId( id );
			try {
				await apiFetch( {
					path: `/cortext/v1/pages/${ id }/restore`,
					method: 'POST',
				} );
				refreshQueries();
			} catch ( error ) {
				setRowError( {
					id,
					message:
						error?.message ??
						__( 'Could not restore page.', 'cortext' ),
				} );
			} finally {
				setBusyId( null );
			}
		},
		[ refreshQueries ]
	);

	const confirmPermanentDelete = useCallback( async () => {
		const id = pendingDeleteId;
		setPendingDeleteId( null );
		if ( ! id ) {
			return;
		}
		setRowError( null );
		setBusyId( id );
		try {
			await apiFetch( {
				path: `/cortext/v1/pages/${ id }/permanent-delete`,
				method: 'POST',
			} );
			refreshQueries();
		} catch ( error ) {
			setRowError( {
				id,
				message:
					error?.message ?? __( 'Could not delete page.', 'cortext' ),
			} );
		} finally {
			setBusyId( null );
		}
	}, [ pendingDeleteId, refreshQueries ] );

	const isLoading = ! hasResolved;
	const hasError = status === 'ERROR';
	const hasItems = roots.length > 0;
	const pendingDescendantCount = pendingDeleteId
		? descendantCountById.get( pendingDeleteId ) ?? 0
		: 0;

	return (
		<>
			<h2 className="cortext-sidebar__section-title">
				{ __( 'Trash', 'cortext' ) }
			</h2>

			{ isLoading && (
				<div className="cortext-sidebar__loading">
					<Spinner />
				</div>
			) }

			{ ! isLoading && hasError && (
				<div className="cortext-sidebar__error" role="alert">
					<p>{ __( 'Could not load trashed pages.', 'cortext' ) }</p>
					<Button
						variant="secondary"
						onClick={ () =>
							invalidateResolution( 'getEntityRecords', [
								'postType',
								POST_TYPE,
								TRASHED_PAGES_QUERY,
							] )
						}
					>
						{ __( 'Retry', 'cortext' ) }
					</Button>
				</div>
			) }

			{ ! isLoading && ! hasError && ! hasItems && (
				<p className="cortext-sidebar__empty">
					{ __( 'No trashed pages.', 'cortext' ) }
				</p>
			) }

			{ ! isLoading && ! hasError && hasItems && (
				<ul className="cortext-sidebar__list cortext-sidebar__trash-list">
					{ roots.map( ( page ) => {
						const title =
							page.title?.rendered?.trim() ||
							__( '(untitled)', 'cortext' );
						const breadcrumb = buildBreadcrumb( page );
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
											{ title }
										</span>
										{ ( breadcrumb.length > 0 || meta ) && (
											<span className="cortext-sidebar__breadcrumb">
												{ [
													breadcrumb.join( ' / ' ),
													meta,
												]
													.filter( Boolean )
													.join( ' · ' ) }
											</span>
										) }
									</Button>
									<div className="cortext-sidebar__trash-actions">
										<Button
											size="small"
											icon={ rotateLeft }
											label={ __( 'Restore', 'cortext' ) }
											disabled={ isBusy }
											onClick={ () => restore( page.id ) }
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
												setPendingDeleteId( page.id )
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

			{ pendingDeleteId !== null && (
				<ConfirmDialog
					onConfirm={ confirmPermanentDelete }
					onCancel={ () => setPendingDeleteId( null ) }
					confirmButtonText={ __( 'Delete permanently', 'cortext' ) }
				>
					{ pendingDescendantCount > 0
						? sprintf(
								/* translators: %d: number of subpages that will be deleted along with the page. */
								_n(
									'Permanently delete this page and %d subpage? This cannot be undone.',
									'Permanently delete this page and %d subpages? This cannot be undone.',
									pendingDescendantCount,
									'cortext'
								),
								pendingDescendantCount
						  )
						: __(
								'Permanently delete this page? This cannot be undone.',
								'cortext'
						  ) }
				</ConfirmDialog>
			) }
		</>
	);
}
