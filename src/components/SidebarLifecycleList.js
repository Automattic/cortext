import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import { Button } from '@wordpress/components';
import { rotateLeft, trash } from '@wordpress/icons';
import { useNavigate } from '@tanstack/react-router';

import computeCascadeRoots from './computeCascadeRoots';
import DocumentIcon from './DocumentIcon';
import { SidebarListSkeleton } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useDocumentRecord } from '../documents';

export const EMPTY_LIFECYCLE_DOCUMENTS_STATE = {
	documents: [],
	total: 0,
	isLoading: false,
	hasResolved: true,
	error: null,
	refresh: () => {},
};

export const EMPTY_COUNTS = Object.freeze( { total: 0 } );

export function optionalTitleText( title ) {
	if ( typeof title === 'string' && title.trim() ) {
		return title.trim();
	}
	return title?.rendered?.trim() || title?.raw?.trim() || '';
}

export function buildBreadcrumb( record, ancestorById ) {
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

/**
 * List state shared by the Archived and Trash panels: the last good result,
 * the cascade roots, and the busy and error state of the row being acted on.
 *
 * @param {Object}   documentsState Lifecycle document query state.
 * @param {Array}    activePages    Active page records for breadcrumb lookup.
 * @param {string[]} markerKeys     Cascade marker meta keys. Pass a stable
 *                                  reference.
 */
export function useSidebarLifecycleList(
	documentsState,
	activePages,
	markerKeys
) {
	const {
		documents,
		isLoading: isResolving,
		error,
		hasResolved,
	} = documentsState;
	const [ rowError, setRowError ] = useState( null );
	const [ busyId, setBusyId ] = useState( null );
	const [ cachedDocuments, setCachedDocuments ] = useState( [] );
	const [ hasCache, setHasCache ] = useState( false );

	useEffect( () => {
		if ( ! error && hasResolved && Array.isArray( documents ) ) {
			setCachedDocuments( documents );
			setHasCache( true );
		}
	}, [ documents, error, hasResolved ] );

	const visibleDocuments =
		hasResolved && Array.isArray( documents ) ? documents : cachedDocuments;

	const ancestorById = useMemo( () => {
		const map = new Map();
		( activePages ?? [] ).forEach( ( page ) => map.set( page.id, page ) );
		// Prefer active records for pages that somehow appear in both lists.
		// Their title is fresher than the lifecycle snapshot.
		visibleDocuments.forEach( ( document ) => {
			if ( ! map.has( document.id ) ) {
				map.set( document.id, document );
			}
		} );
		return map;
	}, [ activePages, visibleDocuments ] );

	// Roots are documents with no marker, plus documents whose marker points
	// at a parent that's no longer in this list.
	const { roots, descendantCountById, descendantsById } = useMemo(
		() => computeCascadeRoots( visibleDocuments, markerKeys ),
		[ markerKeys, visibleDocuments ]
	);

	const runRowAction = useCallback(
		async ( record, action, fallbackMessage ) => {
			setRowError( null );
			setBusyId( record.id );
			try {
				await action();
			} catch ( nextError ) {
				setRowError( {
					id: record.id,
					message: nextError?.message ?? fallbackMessage,
				} );
			} finally {
				setBusyId( null );
			}
		},
		[]
	);

	const isLoading = isResolving && ! hasCache;
	const showSkeleton = useDelayedFlag(
		isLoading,
		120,
		SKELETON_MIN_VISIBLE_MS
	);

	return {
		ancestorById,
		busyId,
		descendantCountById,
		descendantsById,
		hasError: Boolean( error && ! hasCache ),
		isLoading,
		roots,
		rowError,
		runRowAction,
		showSkeleton,
	};
}

/**
 * One row in a lifecycle list. Display copy comes from `useDocumentRecord`, so
 * the parent component does not need kind checks.
 *
 * @param {Object}                         props
 * @param {Object}                         props.record            Lifecycle document record.
 * @param {Object}                         props.descendantCounts  Cascade counts for this root.
 * @param {Map<number, Object>}            props.ancestorById      Lookup map for breadcrumb walking.
 * @param {boolean}                        props.isSelected        Whether the canvas is currently showing this document.
 * @param {boolean}                        props.isBusy            An action is in flight for this row.
 * @param {?{id: number, message: string}} props.error             Per-row error to display under the row.
 * @param {Function}                       props.onRestore         Parent callback `(record)`.
 * @param {string}                         props.secondaryLabel    Label of the destructive action.
 * @param {Function}                       props.onSecondaryAction Parent callback `(record)` for the destructive action.
 */
function SidebarLifecycleRow( {
	record,
	descendantCounts,
	ancestorById,
	isSelected,
	isBusy,
	error,
	onRestore,
	secondaryLabel,
	onSecondaryAction,
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
	// Inline collections are the only lifecycle items with an owner. If that
	// page is still active, show its title so similar inline tables are easier
	// to tell apart.
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
						label={ secondaryLabel }
						disabled={ isBusy }
						onClick={ () => onSecondaryAction( record ) }
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
 * Loading, error, empty, and populated states of a lifecycle list.
 *
 * @param {Object}   props
 * @param {Object}   props.list              State from `useSidebarLifecycleList`.
 * @param {Function} props.isSelected        Returns whether the canvas is showing a record.
 * @param {string}   props.errorMessage      Copy shown when the list fails to load.
 * @param {string}   props.emptyMessage      Copy shown when the list has no documents.
 * @param {Function} props.onRetry           Refetches the list.
 * @param {Function} props.onRestore         Row callback `(record)`.
 * @param {string}   props.secondaryLabel    Label of the destructive row action.
 * @param {Function} props.onSecondaryAction Row callback `(record)` for the destructive action.
 */
export default function SidebarLifecycleList( {
	list,
	isSelected,
	errorMessage,
	emptyMessage,
	onRetry,
	onRestore,
	secondaryLabel,
	onSecondaryAction,
} ) {
	const {
		ancestorById,
		busyId,
		descendantCountById,
		hasError,
		isLoading,
		roots,
		rowError,
		showSkeleton,
	} = list;

	if ( isLoading ) {
		return showSkeleton ? <SidebarListSkeleton itemCount={ 4 } /> : null;
	}

	if ( hasError ) {
		return (
			<div className="cortext-sidebar__error" role="alert">
				<p>{ errorMessage }</p>
				<Button variant="secondary" onClick={ onRetry }>
					{ __( 'Retry', 'cortext' ) }
				</Button>
			</div>
		);
	}

	if ( roots.length === 0 ) {
		return <p className="cortext-sidebar__empty">{ emptyMessage }</p>;
	}

	return (
		<ul className="cortext-sidebar__list cortext-sidebar__trash-list">
			{ roots.map( ( record ) => (
				<SidebarLifecycleRow
					key={ record.id }
					record={ record }
					descendantCounts={
						descendantCountById.get( record.id ) ?? EMPTY_COUNTS
					}
					ancestorById={ ancestorById }
					isSelected={ isSelected( record ) }
					isBusy={ busyId === record.id }
					error={ rowError?.id === record.id ? rowError : null }
					onRestore={ onRestore }
					secondaryLabel={ secondaryLabel }
					onSecondaryAction={ onSecondaryAction }
				/>
			) ) }
		</ul>
	);
}
