// Editor-coupled subtree of the row detail surface. Loaded as part of the
// `editor` lazy chunk (shared with Canvas) so the Cortext wrappers around
// EditorProvider/EditorBody, the autosave bridge, and the row property
// panel stay off the initial admin bundle. The row peek's chrome
// (toolbar, modal frame, navigation buttons) lives in RowDetailView and
// renders synchronously; only this inner stack suspends on first row open.
import { useDispatch } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { SlotFillProvider } from '@wordpress/components';

import useAutosave from '../hooks/useAutosave';
import usePostLock from '../hooks/usePostLock';
// Registers core + Cortext blocks before any editor renders. Living here
// (rather than at a static import in RowDetailView) keeps the Cortext
// block sources and the registerCoreBlocks call site off the initial
// bundle. The module is idempotent, so Canvas's copy of this import is
// a no-op when RowEditor mounts second, or vice versa.
import { getEditorSettings } from './initEditor';
import { DocumentPropertiesProvider } from './DocumentPropertiesContext';
import { EditorSurfaceProvider } from './EditorSurfaceContext';
import EditorBody from './EditorBody';
import { PostLockFailureNotice, PostLockModal } from './PostLockControls';
import CortextLinkSuggestions from './CortextLinkSuggestions';
import { CortextMentions } from './mention';
import BacklinksPanel from './BacklinksPanel';
import { RowMutationContext } from './EditableCell';

const ROW_DETAIL_EDITOR_CSS = `
	body {
		background: #fff;
	}

	.editor-styles-wrapper {
		box-sizing: border-box;
		min-height: 100%;
		padding: 24px 32px 48px;
	}

	.editor-styles-wrapper .wp-block-post-content {
		margin-block-start: 0;
	}

	.editor-styles-wrapper > .block-editor-block-list__layout,
	.editor-styles-wrapper .block-editor-block-list__layout.is-root-container {
		min-height: 180px;
	}

	.editor-styles-wrapper .block-list-appender {
		margin-top: 12px;
	}
`;

const ROW_DETAIL_EXTRA_STYLES = [ { css: ROW_DETAIL_EDITOR_CSS } ];

function RowAutosaveBridge( {
	isActive = true,
	onApi,
	onSaved,
	recentTarget,
} ) {
	const { status, lastSavedAt, flushNow, isDirty, isSaving } = useAutosave( {
		debounceMs: 0,
		minSaveIntervalMs: 0,
		recentTarget,
	} );
	const { resetPost } = useDispatch( editorStore );
	const discard = useCallback( () => resetPost(), [ resetPost ] );
	const lastNotifiedSaveRef = useRef( null );
	const autosaveStateRef = useRef( { isDirty, isSaving } );
	autosaveStateRef.current = { isDirty, isSaving };
	const hasPendingEdits = useCallback(
		() =>
			autosaveStateRef.current.isDirty ||
			autosaveStateRef.current.isSaving,
		[]
	);

	useEffect( () => {
		if ( ! isActive ) {
			return undefined;
		}
		onApi?.( { flushNow, discard, hasPendingEdits } );
		return () => onApi?.( null );
	}, [ discard, flushNow, hasPendingEdits, isActive, onApi ] );

	useEffect( () => {
		if (
			! isActive ||
			status !== 'saved' ||
			! lastSavedAt ||
			lastNotifiedSaveRef.current === lastSavedAt
		) {
			return;
		}
		lastNotifiedSaveRef.current = lastSavedAt;
		onSaved?.();
	}, [ isActive, lastSavedAt, onSaved, status ] );

	return null;
}

function DetailPaneContent( {
	collectionId,
	detailKey,
	fields,
	allFields,
	detailLayoutEntries,
	isActive,
	isHidden,
	isPropertiesLayoutEditing,
	layoutEditRequest,
	mutationContext,
	onApi,
	onLayoutEditingChange,
	onPaneReady,
	onRequestLayoutEdit,
	onRestored,
	onSaved,
	onTogglePropertiesVisible,
	postType,
	propertiesVisible,
	row,
	rowId,
	shouldAcquirePostLock,
} ) {
	const postLock = usePostLock( {
		postId: row?.id ?? rowId,
		postType,
		enabled: shouldAcquirePostLock,
	} );
	const [ isEditorReady, setIsEditorReady ] = useState( false );
	const notifiedReadyKeyRef = useRef( null );
	const handleReady = useCallback( () => setIsEditorReady( true ), [] );
	const isPostLockSettled =
		! postLock.isReadOnly || postLock.isFailed || postLock.isLocked;

	useEffect( () => {
		setIsEditorReady( false );
		notifiedReadyKeyRef.current = null;
	}, [ detailKey ] );

	useEffect( () => {
		if (
			! isEditorReady ||
			! isPostLockSettled ||
			notifiedReadyKeyRef.current === detailKey
		) {
			return;
		}
		notifiedReadyKeyRef.current = detailKey;
		onPaneReady( detailKey );
	}, [ detailKey, isEditorReady, isPostLockSettled, onPaneReady ] );

	const content = (
		<DocumentPropertiesProvider
			collectionId={ collectionId }
			rowId={ rowId ?? row?.id }
			fields={ fields }
			allFields={ allFields }
			detailLayoutEntries={ detailLayoutEntries }
			fallbackRecord={ row }
			isVisible={ propertiesVisible }
			isLayoutEditing={ isPropertiesLayoutEditing }
			layoutEditRequest={ layoutEditRequest }
			onLayoutEditingChange={ onLayoutEditingChange }
			onRequestLayoutEdit={ onRequestLayoutEdit }
			onToggleVisible={ onTogglePropertiesVisible }
		>
			<PostLockFailureNotice
				error={ postLock.error }
				isRetrying={ postLock.isAcquiring }
				onRetry={ postLock.retry }
			/>
			<EditorBody
				isActive={ isActive && ! isHidden }
				isLocked={ postLock.isReadOnly }
				postId={ row?.id }
				postType={ postType }
				extraStyles={ ROW_DETAIL_EXTRA_STYLES }
				onReady={ handleReady }
				onRestored={ onRestored }
			/>
			<BacklinksPanel
				asPanel={ false }
				documentId={ row?.id ?? rowId }
				className="cortext-row-detail__backlinks"
			/>
			<PostLockModal
				isOpen={ postLock.isLocked }
				isTakeover={ postLock.isTakeover }
				isTakingOver={ postLock.isTakingOver }
				onTakeOver={ postLock.takeOver }
				user={ postLock.user }
			/>
		</DocumentPropertiesProvider>
	);

	return (
		<>
			<RowAutosaveBridge
				isActive={ isActive }
				onApi={ onApi }
				onSaved={ onSaved }
				recentTarget={
					rowId && collectionId ? { id: rowId, collectionId } : null
				}
			/>
			{ mutationContext ? (
				<RowMutationContext.Provider value={ mutationContext }>
					{ content }
				</RowMutationContext.Provider>
			) : (
				content
			) }
			<div
				aria-hidden={ isHidden ? true : undefined }
				{ ...( isHidden ? { inert: '' } : {} ) }
			/>
		</>
	);
}

export default function RowEditor( {
	collectionId,
	detailKey,
	fields,
	allFields,
	detailLayoutEntries,
	isActive,
	isHidden,
	isPropertiesLayoutEditing,
	layoutEditRequest,
	mutationContext,
	onApi,
	onLayoutEditingChange,
	onPaneReady,
	onRequestLayoutEdit,
	onRestored,
	onSaved,
	onTogglePropertiesVisible,
	post,
	postType,
	propertiesVisible,
	row,
	rowId,
	shouldAcquirePostLock = false,
} ) {
	return (
		<EditorProvider
			post={ post }
			settings={ getEditorSettings() }
			useSubRegistry
		>
			<CortextLinkSuggestions />
			<CortextMentions />
			{ /* tech-debt.md#td-row-detail-toolbar-isolation: row detail owns these SlotFills while
			     peek/modal are open. */ }
			<SlotFillProvider>
				<EditorSurfaceProvider hasBlockInspector={ false }>
					<DetailPaneContent
						collectionId={ collectionId }
						detailKey={ detailKey }
						fields={ fields }
						allFields={ allFields }
						detailLayoutEntries={ detailLayoutEntries }
						isActive={ isActive }
						isHidden={ isHidden }
						isPropertiesLayoutEditing={ isPropertiesLayoutEditing }
						layoutEditRequest={ layoutEditRequest }
						mutationContext={ mutationContext }
						onApi={ onApi }
						onLayoutEditingChange={ onLayoutEditingChange }
						onPaneReady={ onPaneReady }
						onRequestLayoutEdit={ onRequestLayoutEdit }
						onRestored={ onRestored }
						onSaved={ onSaved }
						onTogglePropertiesVisible={ onTogglePropertiesVisible }
						postType={ postType }
						propertiesVisible={ propertiesVisible }
						row={ row }
						rowId={ rowId }
						shouldAcquirePostLock={ shouldAcquirePostLock }
					/>
				</EditorSurfaceProvider>
			</SlotFillProvider>
		</EditorProvider>
	);
}
