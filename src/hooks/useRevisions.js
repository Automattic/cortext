import apiFetch from '@wordpress/api-fetch';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useMemo, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';

import { unlock } from '../lock-unlock';

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

export function useRevisionedDocumentIdentity( {
	postId,
	postType,
	meta,
	featuredId,
} = {} ) {
	const { isRevisionsMode, currentRevision } = useRevisionControls( {
		postId,
		postType,
	} );

	return {
		iconMeta: isRevisionsMode
			? revisionMetaValue( currentRevision, 'cortext_document_icon', '' )
			: meta?.cortext_document_icon ?? '',
		featuredId: isRevisionsMode
			? revisionFeaturedMedia( currentRevision, 0 )
			: featuredId,
		isRevisionsMode,
		currentRevision,
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
			const error =
				core.getResolutionError?.( 'getRevisions', args ) ?? null;

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

export function useRevisionControls( { postId, postType } = {} ) {
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
	} = useSelect( ( select ) => {
		const editor = unlock( select( editorStore ) );
		const store = select( editorStore );
		const hasControls =
			typeof editor.getCurrentRevisionId === 'function' &&
			typeof editor.isRevisionsMode === 'function';
		const currentId =
			typeof editor.getCurrentRevisionId === 'function'
				? editor.getCurrentRevisionId()
				: null;
		return {
			isAvailable:
				hasControls && typeof editor.getCurrentRevision === 'function',
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
		};
	}, [] );
	// Restoring writes server-side and resets the editor, so block it while the
	// editor has unsaved edits (would be silently discarded) or a save is in
	// flight, and on trashed documents (restore the document first).
	const isTrashed = postStatus === 'trash';
	const canRestore = ! isTrashed && ! isDirty && ! isSaving;
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
	const revisionsQuery = useMemo( () => revisionQuery( 'id', 'desc' ), [] );

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
				}
				invalidateResolution( 'getRevisions', [
					'postType',
					postType,
					postId,
					revisionsQuery,
				] );
				setCurrentRevisionId?.( null );
				createSuccessNotice(
					__(
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
			postId,
			postType,
			receiveEntityRecords,
			revisionsQuery,
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
		canRestore,
		isRestoring,
		selectRevision,
		exitRevisions,
		toggleDiff,
		restoreRevision,
	};
}
