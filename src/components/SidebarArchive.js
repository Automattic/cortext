import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import {
	Button,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { rotateLeft, trash } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import computeCascadeRoots from './computeCascadeRoots';
import DocumentIcon from './DocumentIcon';
import { SidebarListSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useDocumentActions, useDocumentRecord } from '../documents';

const EMPTY_ARCHIVED_DOCUMENTS_STATE = {
	documents: [],
	total: 0,
	isLoading: false,
	hasResolved: true,
	error: null,
	refresh: () => {},
};

const ARCHIVE_MARKER_META_KEYS = [
	'_cortext_archived_by_parent',
	'_cortext_archived_by_collection',
];

export function computeSidebarArchiveRoots( archivedDocuments = [] ) {
	return computeCascadeRoots( archivedDocuments, ARCHIVE_MARKER_META_KEYS );
}

function optionalTitleText( title ) {
	if ( typeof title === 'string' && title.trim() ) {
		return title.trim();
	}
	return title?.rendered?.trim() || title?.raw?.trim() || '';
}

function buildBreadcrumb( record, ancestorById ) {
	const ancestors = [];
	let current = record.parent ? ancestorById.get( record.parent ) : null;
	const seen = new Set( [ record.id ] );
	while ( current && ! seen.has( current.id ) ) {
		seen.add( current.id );
		const title = optionalTitleText( current.title );
		if ( title ) {
			ancestors.unshift( {
				id: current.id,
				title,
				icon: current.meta?.cortext_document_icon ?? '',
			} );
		}
		current = current.parent ? ancestorById.get( current.parent ) : null;
	}
	return ancestors;
}

const EMPTY_COUNTS = Object.freeze( { total: 0 } );

function SidebarArchiveRow( {
	record,
	descendantCounts,
	ancestorById,
	isSelected,
	isBusy,
	error,
	onRestore,
	onRequestTrash,
} ) {
	const navigate = useNavigate();
	const { title, features, nestedDocumentCountLabel } =
		useDocumentRecord( record );
	const breadcrumb = features.hierarchy
		? buildBreadcrumb( record, ancestorById )
		: [];
	const documentIcon = record.meta?.cortext_document_icon ?? '';
	const collectionTitle = record.collection?.id
		? optionalTitleText( record.collection?.title )
		: '';
	const ownerTitle = record.owner
		? optionalTitleText( record.owner?.title )
		: '';
	const meta = descendantCounts.total
		? nestedDocumentCountLabel( descendantCounts )
		: '';
	const rowClasses = [ 'cortext-sidebar__row' ];
	if ( isSelected ) {
		rowClasses.push( 'is-selected' );
	}

	return (
		<li
			className="cortext-sidebar__node cortext-sidebar__trash-row"
			data-cortext-document-id={ record.id }
		>
			<div className={ rowClasses.join( ' ' ) }>
				<Button
					className="cortext-sidebar__title cortext-sidebar__trash-text"
					variant="tertiary"
					aria-current={ isSelected ? 'page' : undefined }
					onClick={ () =>
						navigate( {
							to: '/$',
							params: { _splat: record.path },
						} )
					}
				>
					<span className="cortext-sidebar__trash-title">
						<DocumentIcon
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
									<DocumentIcon
										icon={ crumb.icon }
										size={ 12 }
									/>
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
						onClick={ () => onRestore( record ) }
					/>
					<Button
						size="small"
						icon={ trash }
						isDestructive
						label={ __( 'Move to Trash', 'cortext' ) }
						disabled={ isBusy }
						onClick={ () => onRequestTrash( record ) }
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

function SidebarArchiveTrashConfirmDialog( { record, onConfirm, onCancel } ) {
	const { title } = useDocumentRecord( record );
	const message = sprintf(
		/* translators: %s: document title */
		__(
			'Move “%s” to Trash? Nested documents will also move to Trash. Items in Trash are permanently deleted after 30 days.',
			'cortext'
		),
		title
	);

	return (
		<ConfirmDialog
			onConfirm={ () => onConfirm( record ) }
			onCancel={ onCancel }
			confirmButtonText={ __( 'Move to Trash', 'cortext' ) }
		>
			{ message }
		</ConfirmDialog>
	);
}

export default function SidebarArchive( {
	activePages,
	selectedId,
	selectedCollectionId = null,
	archivedDocumentsState = EMPTY_ARCHIVED_DOCUMENTS_STATE,
} ) {
	const {
		documents: archivedDocuments,
		isLoading: isResolvingArchive,
		error: archiveError,
		hasResolved,
	} = archivedDocumentsState;
	const { unarchive, trash: trashDocument } = useDocumentActions();
	const [ pendingTrash, setPendingTrash ] = useState( null );
	const [ rowError, setRowError ] = useState( null );
	const [ busyId, setBusyId ] = useState( null );
	const [ cachedArchived, setCachedArchived ] = useState( [] );
	const [ hasArchiveCache, setHasArchiveCache ] = useState( false );

	useEffect( () => {
		if (
			! archiveError &&
			hasResolved &&
			Array.isArray( archivedDocuments )
		) {
			setCachedArchived( archivedDocuments );
			setHasArchiveCache( true );
		}
	}, [ archiveError, archivedDocuments, hasResolved ] );

	const visibleArchived =
		hasResolved && Array.isArray( archivedDocuments )
			? archivedDocuments
			: cachedArchived;
	const ancestorById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		visibleArchived.forEach( ( document ) => {
			if ( ! map.has( document.id ) ) {
				map.set( document.id, document );
			}
		} );
		return map;
	}, [ activePages, visibleArchived ] );
	const { roots, descendantCountById } = useMemo(
		() => computeSidebarArchiveRoots( visibleArchived ),
		[ visibleArchived ]
	);

	const handleRestore = useCallback(
		async ( record ) => {
			setRowError( null );
			setBusyId( record.id );
			try {
				await unarchive( record );
			} catch ( error ) {
				setRowError( {
					id: record.id,
					message:
						error?.message ??
						__( 'Could not restore this document.', 'cortext' ),
				} );
			} finally {
				setBusyId( null );
			}
		},
		[ unarchive ]
	);

	const handleTrash = useCallback(
		async ( record ) => {
			setPendingTrash( null );
			setRowError( null );
			setBusyId( record.id );
			try {
				await trashDocument( record );
			} catch ( error ) {
				setRowError( {
					id: record.id,
					message:
						error?.message ??
						__(
							'Could not move this document to Trash.',
							'cortext'
						),
				} );
			} finally {
				setBusyId( null );
			}
		},
		[ trashDocument ]
	);

	const isLoading = isResolvingArchive && ! hasArchiveCache;
	const showSkeleton = useDelayedFlag(
		isLoading,
		120,
		SKELETON_MIN_VISIBLE_MS
	);
	const hasError = Boolean( archiveError && ! hasArchiveCache );

	return (
		<>
			{ isLoading && showSkeleton && (
				<SidebarListSkeleton itemCount={ 4 } />
			) }
			{ ! isLoading && hasError && (
				<div className="cortext-sidebar__error" role="alert">
					<p>
						{ __(
							'Could not load archived documents.',
							'cortext'
						) }
					</p>
					<Button
						variant="secondary"
						onClick={ archivedDocumentsState.refresh }
					>
						{ __( 'Retry', 'cortext' ) }
					</Button>
				</div>
			) }
			{ ! isLoading && ! hasError && roots.length === 0 && (
				<p className="cortext-sidebar__empty">
					{ __( 'No archived documents.', 'cortext' ) }
				</p>
			) }
			{ ! isLoading && ! hasError && roots.length > 0 && (
				<ul className="cortext-sidebar__list cortext-sidebar__trash-list">
					{ roots.map( ( record ) => (
						<SidebarArchiveRow
							key={ record.id }
							record={ record }
							descendantCounts={
								descendantCountById.get( record.id ) ??
								EMPTY_COUNTS
							}
							ancestorById={ ancestorById }
							isSelected={
								selectedId === record.id ||
								selectedCollectionId === record.id
							}
							isBusy={ busyId === record.id }
							error={
								rowError?.id === record.id ? rowError : null
							}
							onRestore={ handleRestore }
							onRequestTrash={ setPendingTrash }
						/>
					) ) }
				</ul>
			) }
			{ pendingTrash !== null && (
				<SidebarArchiveTrashConfirmDialog
					record={ pendingTrash }
					onConfirm={ handleTrash }
					onCancel={ () => setPendingTrash( null ) }
				/>
			) }
		</>
	);
}
