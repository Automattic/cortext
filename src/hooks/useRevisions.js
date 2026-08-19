import apiFetch from '@wordpress/api-fetch';
import { store as coreStore } from '@wordpress/core-data';
import {
	createRegistrySelector,
	useDispatch,
	useSelect,
} from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';

import { unlock } from '../lock-unlock';
import { notifyBacklinksChanged } from './backlinksInvalidation';
import { notifyDocumentRecordChanged } from './documentRecordInvalidation';
import { notifyCollectionRowsChanged } from './rowInvalidation';

const BASE_REVISION_FIELDS = [
	'id',
	'date',
	'modified',
	'author',
	'meta',
	'featured_media',
	'title.raw',
	'excerpt.raw',
	'content.raw',
];

function hasOwnProperty( object, key ) {
	return Object.prototype.hasOwnProperty.call( object ?? {}, key );
}

export function revisionMetaValue( revision, key, fallback = '' ) {
	const meta = revision?.meta;
	if ( ! meta || ! hasOwnProperty( meta, key ) ) {
		return fallback;
	}

	const value = meta[ key ];
	if ( Array.isArray( value ) ) {
		return value[ 0 ] ?? fallback;
	}

	return value ?? fallback;
}

export function revisionFeaturedMedia( revision, fallback = 0 ) {
	const value = hasOwnProperty( revision, 'featured_media' )
		? revision.featured_media
		: revisionMetaValue( revision, '_thumbnail_id', fallback );

	return Number( value ) || 0;
}

export function revisionRecordQuery( revisionKey = 'id' ) {
	return {
		context: 'edit',
		_fields: [
			...new Set( [ ...BASE_REVISION_FIELDS, revisionKey ] ),
		].join(),
	};
}

export function revisionIconChanged( currentRevision, previousRevision ) {
	if ( ! currentRevision || ! previousRevision ) {
		return false;
	}
	return (
		revisionMetaValue( currentRevision, 'cortext_document_icon', '' ) !==
		revisionMetaValue( previousRevision, 'cortext_document_icon', '' )
	);
}

export function revisionFeaturedMediaChanged(
	currentRevision,
	previousRevision
) {
	if ( ! currentRevision || ! previousRevision ) {
		return false;
	}
	return (
		revisionFeaturedMedia( currentRevision, 0 ) !==
		revisionFeaturedMedia( previousRevision, 0 )
	);
}

export function revisionIdentityRecord(
	currentRevision,
	previousRevision,
	revisionDiffStatus
) {
	if ( revisionDiffStatus === 'removed' ) {
		return previousRevision ?? currentRevision;
	}

	return currentRevision;
}

function revisionIdentifier( revision, revisionKey = 'id' ) {
	return revision?.[ revisionKey ] ?? revision?.id;
}

function useRevisionRecord( { postId, postType, revisionId, revisionKey } ) {
	return useSelect(
		( select ) => {
			if ( ! postType || ! postId || ! revisionId ) {
				return null;
			}

			const core = select( coreStore );
			const query = revisionRecordQuery( revisionKey );
			if ( typeof core.getRevision === 'function' ) {
				return (
					core.getRevision(
						'postType',
						postType,
						postId,
						revisionId,
						query
					) ?? null
				);
			}

			const revisions = core.getRevisions?.(
				'postType',
				postType,
				postId,
				revisionQuery( revisionKey, 'desc' )
			);
			return (
				revisions?.find(
					( revision ) =>
						revisionIdentifier( revision, revisionKey ) ===
						revisionId
				) ?? null
			);
		},
		[ postId, postType, revisionId, revisionKey ]
	);
}

export function useRevisionedDocumentIdentity( {
	postId,
	postType,
	meta,
	featuredId,
	revisionDiffStatus,
} = {} ) {
	const {
		currentRevision,
		currentRevisionId,
		isRevisionsMode,
		isShowingRevisionDiff,
		previousRevision,
		revisionKey,
	} = useRevisionControls( { postId, postType } );
	const currentRevisionRecord = useRevisionRecord( {
		postId,
		postType,
		revisionId:
			revisionIdentifier( currentRevision, revisionKey ) ??
			currentRevisionId,
		revisionKey,
	} );
	const previousRevisionRecord = useRevisionRecord( {
		postId,
		postType,
		revisionId:
			revisionIdentifier( previousRevision, revisionKey ) ??
			previousRevision?.id,
		revisionKey,
	} );
	const effectiveCurrentRevision = currentRevisionRecord ?? currentRevision;
	const effectivePreviousRevision =
		previousRevisionRecord ?? previousRevision;
	const identityRevision =
		isRevisionsMode && isShowingRevisionDiff
			? revisionIdentityRecord(
					effectiveCurrentRevision,
					effectivePreviousRevision,
					revisionDiffStatus
			  )
			: effectiveCurrentRevision;

	return {
		iconMeta: isRevisionsMode
			? revisionMetaValue( identityRevision, 'cortext_document_icon', '' )
			: meta?.cortext_document_icon ?? '',
		featuredId: isRevisionsMode
			? revisionFeaturedMedia( identityRevision, 0 )
			: featuredId,
		isRevisionsMode,
		currentRevision: effectiveCurrentRevision,
		previousRevision: effectivePreviousRevision,
		iconChanged:
			isRevisionsMode &&
			isShowingRevisionDiff &&
			revisionIconChanged(
				effectiveCurrentRevision,
				effectivePreviousRevision
			),
		featuredMediaChanged:
			isRevisionsMode &&
			isShowingRevisionDiff &&
			revisionFeaturedMediaChanged(
				effectiveCurrentRevision,
				effectivePreviousRevision
			),
	};
}

export function revisionQuery( revisionKey = 'id', order = 'desc' ) {
	return {
		per_page: -1,
		context: 'edit',
		orderby: 'date',
		order,
		_fields: [
			...new Set( [ ...BASE_REVISION_FIELDS, revisionKey ] ),
		].join(),
	};
}

let didRegisterRevisionSelectors = false;

function getEditorRevisionRecord( select, state, order ) {
	const revisionId = state?.revisionId;
	if ( ! revisionId ) {
		return undefined;
	}

	const postId = state?.postId;
	const postType = state?.postType;
	if ( ! postId || ! postType ) {
		return null;
	}

	const core = select( coreStore );
	const revisionKey =
		core.getEntityConfig( 'postType', postType )?.revisionKey || 'id';
	const revisions = core.getRevisions(
		'postType',
		postType,
		postId,
		revisionQuery( revisionKey, 'desc' )
	);
	if ( ! revisions ) {
		return null;
	}

	const currentIndex = revisions.findIndex(
		( revision ) =>
			String( revisionIdentifier( revision, revisionKey ) ) ===
			String( revisionId )
	);
	if ( order !== 'asc' ) {
		return currentIndex >= 0 ? revisions[ currentIndex ] : null;
	}

	return currentIndex >= 0 ? revisions[ currentIndex + 1 ] ?? null : null;
}

function registerRevisionSelectors() {
	if (
		didRegisterRevisionSelectors ||
		typeof createRegistrySelector !== 'function'
	) {
		return;
	}

	const editorPrivateStore = unlock( editorStore );
	if ( typeof editorPrivateStore?.registerPrivateSelectors !== 'function' ) {
		return;
	}

	// Core's revision selector can stay null after a server-side restore even
	// when core-data has the matching revision. Read from editor state and the
	// revisions collection directly so the preview canvas keeps rendering.
	editorPrivateStore.registerPrivateSelectors( {
		getCurrentRevision: createRegistrySelector(
			( select ) => ( state ) => getEditorRevisionRecord( select, state )
		),
		getPreviousRevision: createRegistrySelector(
			( select ) => ( state ) =>
				getEditorRevisionRecord( select, state, 'asc' )
		),
	} );
	didRegisterRevisionSelectors = true;
}

registerRevisionSelectors();

export function useRevisions( postType, postId, { order = 'desc' } = {} ) {
	const revisionState = useSelect(
		( select ) => {
			if ( ! postType || ! postId ) {
				return {
					data: [],
					isLoading: false,
					hasResolved: true,
					error: null,
					revisionKey: 'id',
					query: revisionQuery( 'id', order ),
				};
			}

			const core = select( coreStore );
			const entityConfig = core.getEntityConfig( 'postType', postType );
			const revisionKey = entityConfig?.revisionKey || 'id';
			const query = revisionQuery( revisionKey, order );
			const args = [ 'postType', postType, postId, query ];
			const data = core.getRevisions( ...args );
			const isLoading = core.isResolving( 'getRevisions', args );
			const hasResolved =
				core.hasFinishedResolution?.( 'getRevisions', args ) ??
				( ! isLoading && Array.isArray( data ) );
			const resolutionError =
				core.getResolutionError?.( 'getRevisions', args ) ?? null;
			// Core-data deliberately swallows getRevisions API failures. A
			// finished resolution with no collection is therefore the only signal
			// that the request failed; a successful empty response is stored as [].
			const error =
				resolutionError ??
				( hasResolved && data === null
					? new Error( __( 'Could not load revisions.', 'cortext' ) )
					: null );

			return {
				data: Array.isArray( data ) ? data : [],
				isLoading,
				hasResolved,
				error,
				revisionKey,
				query,
			};
		},
		[ order, postId, postType ]
	);
	const { invalidateResolution } = useDispatch( coreStore );
	const refresh = useCallback( () => {
		if ( ! postType || ! postId ) {
			return;
		}
		invalidateResolution( 'getRevisions', [
			'postType',
			postType,
			postId,
			revisionState.query,
		] );
	}, [ invalidateResolution, postId, postType, revisionState.query ] );

	return { ...revisionState, refresh };
}

export function useRevisionAuthor( authorId ) {
	return useSelect(
		( select ) => {
			if ( ! authorId ) {
				return { user: null, isLoading: false };
			}
			const core = select( coreStore );
			const args = [ 'root', 'user', authorId ];
			return {
				user: core.getEntityRecord( ...args ),
				isLoading: core.isResolving( 'getEntityRecord', args ),
			};
		},
		[ authorId ]
	);
}

export function useRevisionControls( {
	isReadOnly = false,
	postId,
	postType,
} = {} ) {
	const [ isRestoring, setIsRestoring ] = useState( false );
	const {
		isAvailable,
		isRevisionsMode,
		isShowingRevisionDiff,
		currentRevisionId,
		currentRevision,
		previousRevision,
		postStatus,
		isDirty,
		isSaving,
		isPostLocked,
		revisionKey,
		revisionsUrl,
	} = useSelect(
		( select ) => {
			const editor = unlock( select( editorStore ) );
			const store = select( editorStore );
			const entityConfig = postType
				? select( coreStore ).getEntityConfig( 'postType', postType )
				: null;
			const hasControls =
				typeof editor.getCurrentRevisionId === 'function' &&
				typeof editor.isRevisionsMode === 'function';
			const currentId =
				typeof editor.getCurrentRevisionId === 'function'
					? editor.getCurrentRevisionId()
					: null;
			return {
				isAvailable:
					hasControls &&
					typeof editor.getCurrentRevision === 'function',
				isRevisionsMode:
					typeof editor.isRevisionsMode === 'function'
						? editor.isRevisionsMode()
						: Boolean( currentId ),
				isShowingRevisionDiff:
					typeof editor.isShowingRevisionDiff === 'function'
						? editor.isShowingRevisionDiff()
						: false,
				currentRevisionId: currentId,
				currentRevision:
					typeof editor.getCurrentRevision === 'function'
						? editor.getCurrentRevision()
						: null,
				previousRevision:
					typeof editor.getPreviousRevision === 'function'
						? editor.getPreviousRevision()
						: null,
				postStatus: store.getCurrentPostAttribute( 'status' ),
				isDirty: store.isEditedPostDirty?.() ?? false,
				isSaving: store.isSavingPost?.() ?? false,
				isPostLocked: store.isPostLocked?.() ?? false,
				revisionKey: entityConfig?.revisionKey || 'id',
				revisionsUrl:
					postId &&
					typeof entityConfig?.getRevisionsUrl === 'function'
						? entityConfig.getRevisionsUrl( postId )
						: null,
			};
		},
		[ postId, postType ]
	);
	// Restoring writes server-side and resets the editor, so block it while the
	// editor has unsaved edits (would be silently discarded) or a save is in
	// flight, and on trashed documents (restore the document first).
	const isTrashed = postStatus === 'trash';
	const canRestore =
		! isReadOnly &&
		! isPostLocked &&
		! isTrashed &&
		! isDirty &&
		! isSaving;
	const { setCurrentRevisionId, setShowRevisionDiff } = unlock(
		useDispatch( editorStore )
	);
	const {
		clearEntityRecordEdits,
		receiveEntityRecords,
		invalidateResolution,
	} = useDispatch( coreStore );
	const { createErrorNotice, createSuccessNotice } =
		useDispatch( noticesStore );
	// The desc collection is the only revisions query anything resolves: the
	// history panel reads it and the editor's current/previous revision
	// selectors are pointed at it too.
	const invalidationQuery = useMemo(
		() => revisionQuery( revisionKey, 'desc' ),
		[ revisionKey ]
	);
	const selectRevision = useCallback(
		( revisionId ) => {
			setCurrentRevisionId?.( revisionId );
		},
		[ setCurrentRevisionId ]
	);
	const exitRevisions = useCallback( () => {
		setCurrentRevisionId?.( null );
	}, [ setCurrentRevisionId ] );
	const toggleDiff = useCallback(
		( nextValue = ! isShowingRevisionDiff ) => {
			setShowRevisionDiff?.( nextValue );
		},
		[ isShowingRevisionDiff, setShowRevisionDiff ]
	);
	const restoreRevision = useCallback(
		async ( revisionId = currentRevisionId ) => {
			if ( ! postId || ! postType || ! revisionId || ! canRestore ) {
				return null;
			}
			setIsRestoring( true );
			try {
				const response = await apiFetch( {
					path: `/cortext/v1/documents/${ postId }/restore-revision`,
					method: 'POST',
					data: { revision_id: revisionId },
				} );
				if ( response?.post ) {
					clearEntityRecordEdits?.( 'postType', postType, postId );
					receiveEntityRecords(
						'postType',
						postType,
						[ response.post ],
						undefined,
						true
					);
					notifyDocumentRecordChanged( {
						id: postId,
						postType,
						reason: 'revision-restore',
					} );
				}
				// Rows and backlinks live outside core-data, so receiving the
				// record above does not reach them. Restoring rewrites field
				// values, relation pointers and the links in post_content, so
				// both need their own nudge.
				notifyCollectionRowsChanged();
				notifyBacklinksChanged();
				invalidateResolution( 'getRevisions', [
					'postType',
					postType,
					postId,
					invalidationQuery,
				] );
				setCurrentRevisionId?.( null );
				createSuccessNotice(
					response?.contentOnly
						? __(
								'Content restored. This version predates property history, so the icon, cover and properties were left as they are.',
								'cortext'
						  )
						: __(
								'Revision restored. Your previous version is still in history.',
								'cortext'
						  ),
					{
						id: 'cortext-revision-restored',
						type: 'snackbar',
					}
				);
				return response;
			} catch ( error ) {
				createErrorNotice(
					error?.message ??
						__( 'Could not restore revision.', 'cortext' ),
					{
						id: 'cortext-revision-restore-error',
						type: 'snackbar',
					}
				);
				throw error;
			} finally {
				setIsRestoring( false );
			}
		},
		[
			canRestore,
			clearEntityRecordEdits,
			createErrorNotice,
			createSuccessNotice,
			currentRevisionId,
			invalidateResolution,
			invalidationQuery,
			postId,
			postType,
			receiveEntityRecords,
			setCurrentRevisionId,
		]
	);

	return {
		isAvailable,
		isRevisionsMode,
		isShowingRevisionDiff,
		currentRevisionId,
		currentRevision,
		previousRevision,
		postStatus,
		isTrashed,
		isDirty,
		isSaving,
		isPostLocked,
		canRestore,
		isRestoring,
		revisionKey,
		revisionsUrl,
		selectRevision,
		exitRevisions,
		toggleDiff,
		restoreRevision,
	};
}
