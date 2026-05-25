import { __ } from '@wordpress/i18n';
import { useDispatch } from '@wordpress/data';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import {
	Button,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { rotateLeft, trash } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import PageIcon from './PageIcon';
import { SidebarListSkeleton } from './Skeleton';
import TypeToConfirmDialog from './TypeToConfirmDialog';
import { POST_TYPE, TRASHED_PAGES_QUERY } from './page-queries';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useDocumentActions, useDocumentRecord } from '../documents';

const EMPTY_TRASHED_DOCUMENTS_STATE = {
	documents: [],
	total: 0,
	isLoading: false,
	hasResolved: true,
	error: null,
	refresh: () => {},
};

// These mirror the PHP cascade marker meta keys. Trash entries point back to
// the cascade root (page → subpage, page → owned inline collection), which lets
// the sidebar show one row for the whole trashed group.
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
		// Pages → subpages and pages → owned inline collections use different
		// marker keys, but both point at the same kind of root: a parent page.
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

function buildBreadcrumb( record, ancestorById ) {
	const ancestors = [];
	let current = record.parent ? ancestorById.get( record.parent ) : null;
	const seen = new Set( [ record.id ] );
	while ( current && ! seen.has( current.id ) ) {
		seen.add( current.id );
		ancestors.unshift( {
			id: current.id,
			title:
				current.title?.rendered?.trim() ||
				__( '(untitled)', 'cortext' ),
			icon: current.meta?.cortext_document_icon ?? '',
		} );
		current = current.parent ? ancestorById.get( current.parent ) : null;
	}
	return ancestors;
}

const EMPTY_COUNTS = Object.freeze( { pages: 0, collections: 0, total: 0 } );

/**
 * One row in the trash list. Display copy comes from `useDocumentRecord`, so
 * the parent component does not need kind checks.
 *
 * @param {Object}                         props
 * @param {Object}                         props.record           Trashed document record.
 * @param {Object}                         props.descendantCounts Cascade counts for this root.
 * @param {Map<number, Object>}            props.ancestorById     Lookup map for breadcrumb walking.
 * @param {boolean}                        props.isSelected       Whether the canvas is currently showing this document.
 * @param {boolean}                        props.isBusy           Restore or delete in flight for this row.
 * @param {?{id: number, message: string}} props.error            Per-row error to display under the row.
 * @param {Function}                       props.onRestore        Parent callback `(record, restoreErrorMessage)`.
 * @param {Function}                       props.onRequestDelete  Parent callback `(record)` to open the confirm dialog.
 */
function SidebarTrashRow( {
	record,
	descendantCounts,
	ancestorById,
	isSelected,
	isBusy,
	error,
	onRestore,
	onRequestDelete,
} ) {
	const navigate = useNavigate();
	const { title, features, descendantLabel, restoreErrorMessage } =
		useDocumentRecord( record );

	const breadcrumb = features.hierarchy
		? buildBreadcrumb( record, ancestorById )
		: [];
	const documentIcon = record.meta?.cortext_document_icon ?? '';
	const collectionTitle = record.collection?.id
		? titleText( record.collection?.title, __( 'Collection', 'cortext' ) )
		: '';
	// Inline collections are the only trash items with an owner. If that page
	// is still active, show its title so similar inline tables are easier to
	// tell apart.
	const ownerTitle = record.owner
		? titleText( record.owner?.title, __( 'Page', 'cortext' ) )
		: '';
	const meta = descendantCounts.total
		? descendantLabel( descendantCounts )
		: '';

	const handleRestore = useCallback( () => {
		onRestore( record, restoreErrorMessage );
	}, [ onRestore, record, restoreErrorMessage ] );

	const handleRequestDelete = useCallback( () => {
		onRequestDelete( record );
	}, [ onRequestDelete, record ] );

	const rowClasses = [ 'cortext-sidebar__row' ];
	if ( isSelected ) {
		rowClasses.push( 'is-selected' );
	}

	return (
		<li className="cortext-sidebar__node cortext-sidebar__trash-row">
			<div className={ rowClasses.join( ' ' ) }>
				<Button
					className="cortext-sidebar__title cortext-sidebar__trash-text"
					variant="tertiary"
					onClick={ () =>
						navigate( {
							to: '/$',
							params: { _splat: record.path },
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
							{ breadcrumb.map( ( crumb, index ) => (
								<span
									key={ crumb.id }
									className="cortext-sidebar__breadcrumb-crumb"
								>
									<PageIcon icon={ crumb.icon } size={ 12 } />
									<span>{ crumb.title }</span>
									{ index < breadcrumb.length - 1 && (
										<span
											className="cortext-sidebar__breadcrumb-sep"
											aria-hidden="true"
										>
											{ ' / ' }
										</span>
									) }
								</span>
							) ) }
							{ ownerTitle && <span>{ ownerTitle }</span> }
							{ collectionTitle && (
								<span>{ collectionTitle }</span>
							) }
							{ meta && (
								<>
									{ ( breadcrumb.length > 0 ||
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
						onClick={ handleRestore }
					/>
					<Button
						size="small"
						icon={ trash }
						isDestructive
						label={ __( 'Delete permanently', 'cortext' ) }
						disabled={ isBusy }
						onClick={ handleRequestDelete }
					/>
				</div>
			</div>
			{ error && (
				<p className="cortext-sidebar__row-error" role="alert">
					{ error.message }
				</p>
			) }
		</li>
	);
}

/**
 * Confirmation for permanent delete. The descriptor decides whether this can
 * use a plain confirm dialog or needs the typed-name flow.
 *
 * @param {Object}   props
 * @param {Object}   props.record    Trashed record pending delete.
 * @param {Object}   props.counts    Cascade counts for the pending root.
 * @param {Function} props.onConfirm Parent callback `(record, permanentDeleteErrorMessage)`.
 * @param {Function} props.onCancel  Closes the dialog without deleting.
 */
function SidebarTrashConfirmDialog( { record, counts, onConfirm, onCancel } ) {
	const { title, permanentDeleteConfirmation, permanentDeleteErrorMessage } =
		useDocumentRecord( record );
	const dialogConfig = permanentDeleteConfirmation( counts ) ?? {
		title: '',
		message: '',
	};

	const handleConfirm = useCallback( () => {
		onConfirm( record, permanentDeleteErrorMessage );
	}, [ onConfirm, record, permanentDeleteErrorMessage ] );

	if ( dialogConfig.requireTypeToConfirm ) {
		return (
			<TypeToConfirmDialog
				title={ dialogConfig.title }
				message={ dialogConfig.message }
				confirmPhrase={ title }
				confirmLabel={ __( 'Delete permanently', 'cortext' ) }
				onConfirm={ handleConfirm }
				onCancel={ onCancel }
			/>
		);
	}

	return (
		<ConfirmDialog
			onConfirm={ handleConfirm }
			onCancel={ onCancel }
			confirmButtonText={ __( 'Delete permanently', 'cortext' ) }
		>
			{ dialogConfig.message }
		</ConfirmDialog>
	);
}

/**
 * Sidebar Trash for Cortext documents.
 *
 * Trash shows cascade roots. Children trashed with a parent are restored or
 * deleted with that parent. If a marker points to a parent that is no longer
 * in Trash, the orphan still appears so it can be recovered.
 *
 * Restore and permanent delete go through the descriptors, keeping per-kind
 * refreshes and error copy out of this component.
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
	const {
		documents: trashedDocuments,
		isLoading: isResolvingTrash,
		error: trashError,
		hasResolved,
	} = trashedDocumentsState;

	const { invalidateResolution } = useDispatch( 'core' );
	const { restore, permanentDelete } = useDocumentActions();

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

	const handleRestore = useCallback(
		async ( record, restoreErrorMessage ) => {
			setRowError( null );
			setBusyId( record.id );
			try {
				await restore( record );
			} catch ( error ) {
				setRowError( {
					id: record.id,
					message: error?.message ?? restoreErrorMessage,
				} );
			} finally {
				setBusyId( null );
			}
		},
		[ restore ]
	);

	const handlePermanentDelete = useCallback(
		async ( record, permanentDeleteErrorMessage ) => {
			setPendingDelete( null );
			setRowError( null );
			setBusyId( record.id );
			try {
				const response = await permanentDelete( record );
				const deletedIds = response?.deleted ?? [];
				// If the canvas was showing one of the deleted documents, move
				// away from it. Otherwise `useEntityRecord` returns undefined
				// and the canvas keeps spinning because the document is gone,
				// not just trashed. Collections track via `selectedCollectionId`,
				// so check both ids.
				const openId = selectedId ?? selectedCollectionId;
				if ( openId && deletedIds.includes( openId ) ) {
					onSelect( null );
				}
			} catch ( error ) {
				setRowError( {
					id: record.id,
					message: error?.message ?? permanentDeleteErrorMessage,
				} );
			} finally {
				setBusyId( null );
			}
		},
		[ permanentDelete, selectedId, selectedCollectionId, onSelect ]
	);

	const isLoading = isResolvingTrash && ! hasTrashCache;
	const showSkeleton = useDelayedFlag(
		isLoading,
		120,
		SKELETON_MIN_VISIBLE_MS
	);
	const hasError = Boolean( trashError && ! hasTrashCache );
	const hasItems = roots.length > 0;

	const retryTrashFetch = useCallback( () => {
		invalidateResolution( 'getEntityRecords', [
			'postType',
			POST_TYPE,
			TRASHED_PAGES_QUERY,
		] );
		trashedDocumentsState.refresh?.();
	}, [ invalidateResolution, trashedDocumentsState ] );

	return (
		<>
			{ isLoading && showSkeleton && (
				<SidebarListSkeleton itemCount={ 4 } />
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
					{ roots.map( ( record ) => (
						<SidebarTrashRow
							key={ record.id }
							record={ record }
							descendantCounts={
								descendantCountById.get( record.id ) ??
								EMPTY_COUNTS
							}
							ancestorById={ ancestorById }
							isSelected={ selectedId === record.id }
							isBusy={ busyId === record.id }
							error={
								rowError?.id === record.id ? rowError : null
							}
							onRestore={ handleRestore }
							onRequestDelete={ setPendingDelete }
						/>
					) ) }
				</ul>
			) }

			{ pendingDelete !== null && (
				<SidebarTrashConfirmDialog
					record={ pendingDelete }
					counts={
						descendantCountById.get( pendingDelete.id ) ??
						EMPTY_COUNTS
					}
					onConfirm={ handlePermanentDelete }
					onCancel={ () => setPendingDelete( null ) }
				/>
			) }
		</>
	);
}
