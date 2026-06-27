import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import { store as interfaceStore } from '@wordpress/interface';
import { Button } from '@wordpress/components';
import { closeSmall, cog, pencil, plus, seen, unseen } from '@wordpress/icons';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';

// Editor-surface stylesheets. Imported via a sibling SCSS file (not
// src/index.scss) so mini-css-extract emits them into the editor chunk's
// CSS bundle, off the initial CSS path.
import './Canvas.scss';

// Registers core + Cortext blocks before any editor renders. Shared with
// RowEditor so opening a row peek first (without a document open) still
// gets the blocks registered.
import { getEditorSettings } from './initEditor';
import useAutosave from '../hooks/useAutosave';
import useDelayedFlag from '../hooks/useDelayedFlag';
import usePostLock from '../hooks/usePostLock';
import { withViewTransition } from '../hooks/viewTransition';
import { notifyBacklinksChanged } from '../hooks/backlinksInvalidation';
import { definesTrait } from '../documents/capabilities';
import { POST_TYPE } from './page-queries';
import CortextInserterSidebar from './CortextInserterSidebar';
import CortextLinkSuggestions from './CortextLinkSuggestions';
import { CortextMentions } from './mention';
import { DocumentPropertiesProvider } from './DocumentPropertiesContext';
import DocumentPublishToggle from './DocumentPublishToggle';
import EditorBody from './EditorBody';
import { PostLockFailureNotice, PostLockModal } from './PostLockControls';
import { CanvasProgressBar } from './Skeleton';
import { TopBarActionsFill } from './WorkspaceTopBar';
import DocumentInspectorSidebar, {
	INSPECTOR_SCOPE,
	InspectorSidebarSlot,
	DOCUMENT_INSPECTOR,
	isInspectorArea,
} from './DocumentInspectorSidebar';
import {
	makeRowDocumentContext,
	rememberRowDocumentContext,
	rowDocumentContextForEditorPost,
} from '../router/rowContextCache';

function InserterToggle( { disabled = false } ) {
	const isOpen = useSelect(
		( select ) => !! select( editorStore ).isInserterOpened(),
		[]
	);
	const { setIsInserterOpened } = useDispatch( editorStore );

	useEffect( () => {
		if ( disabled && isOpen ) {
			setIsInserterOpened( false );
		}
	}, [ disabled, isOpen, setIsInserterOpened ] );

	return (
		<Button
			className="cortext-document-actions__inserter"
			icon={ isOpen ? closeSmall : plus }
			size="compact"
			label={ __( 'Add block', 'cortext' ) }
			isPressed={ isOpen }
			disabled={ disabled }
			onClick={ () => {
				if ( ! disabled ) {
					setIsInserterOpened( ! isOpen );
				}
			} }
		/>
	);
}

function DocumentActions( {
	disabled = false,
	isActive,
	postId,
	topBarActions,
	hasProperties,
	arePropertiesVisible,
	isPropertiesLayoutEditing,
	onEditPropertiesLayout,
	onTogglePropertiesVisible,
} ) {
	const { enableComplementaryArea, disableComplementaryArea } =
		useDispatch( interfaceStore );
	const isInspectorOpen = useSelect(
		( select ) =>
			isInspectorArea(
				select( interfaceStore ).getActiveComplementaryArea(
					INSPECTOR_SCOPE
				)
			),
		[]
	);
	// Pages and rows both open the document tab first: page metadata for pages,
	// row properties for rows. Block details stay in the second tab.
	const defaultInspector = DOCUMENT_INSPECTOR;

	// Canvas stays mounted across route changes (preservePaint keeps the
	// editor iframe warm). Suppress the Fill when this page isn't the active
	// pane so a backgrounded editor doesn't keep projecting Save/Publish into
	// the workspace top bar over a collection.
	if ( ! isActive ) {
		return null;
	}

	return (
		<TopBarActionsFill>
			<div className="cortext-document-actions">
				<InserterToggle disabled={ disabled } />
				{ topBarActions }
				<DocumentPublishToggle
					postId={ postId }
					disabled={ disabled }
				/>
				{ hasProperties ? (
					<>
						<Button
							className="cortext-document-actions__fields"
							icon={ arePropertiesVisible ? unseen : seen }
							size="compact"
							label={
								arePropertiesVisible
									? __( 'Collapse properties', 'cortext' )
									: __( 'Expand properties', 'cortext' )
							}
							isPressed={ arePropertiesVisible }
							disabled={ disabled }
							onClick={ onTogglePropertiesVisible }
						/>
						<Button
							className="cortext-document-actions__fields"
							icon={ pencil }
							size="compact"
							label={
								isPropertiesLayoutEditing
									? __( 'Done customizing', 'cortext' )
									: __( 'Customize properties', 'cortext' )
							}
							isPressed={ isPropertiesLayoutEditing }
							disabled={ disabled }
							onClick={ onEditPropertiesLayout }
						/>
					</>
				) : null }
				<Button
					className="cortext-document-actions__settings"
					icon={ cog }
					size="compact"
					label={ __( 'Settings', 'cortext' ) }
					isPressed={ isInspectorOpen }
					onClick={ () =>
						isInspectorOpen
							? disableComplementaryArea( INSPECTOR_SCOPE )
							: enableComplementaryArea(
									INSPECTOR_SCOPE,
									defaultInspector
							  )
					}
				/>
			</div>
		</TopBarActionsFill>
	);
}

function VisualCanvas( {
	featuredMedia,
	isActive,
	isLocked = false,
	postId,
	postType,
	onReady,
	onRestored,
} ) {
	return (
		<EditorBody
			featuredMedia={ featuredMedia }
			isActive={ isActive }
			isLocked={ isLocked }
			postId={ postId }
			postType={ postType }
			onReady={ onReady }
			onRestored={ onRestored }
		/>
	);
}

function CanvasInterfaceSkeleton( {
	className,
	content,
	secondarySidebar,
	sidebar,
} ) {
	const classes = [ className, 'interface-interface-skeleton' ]
		.filter( Boolean )
		.join( ' ' );

	return (
		<div className={ classes }>
			<div className="interface-interface-skeleton__editor">
				<div className="interface-interface-skeleton__body">
					{ secondarySidebar ? (
						<div
							className="interface-interface-skeleton__secondary-sidebar"
							role="region"
							aria-label={ __( 'Block Library', 'cortext' ) }
						>
							{ secondarySidebar }
						</div>
					) : null }
					<div
						className="interface-interface-skeleton__content"
						role="region"
						aria-label={ __( 'Content', 'cortext' ) }
					>
						{ content }
					</div>
					{ sidebar ? (
						<div
							className="interface-interface-skeleton__sidebar"
							role="region"
							aria-label={ __( 'Settings', 'cortext' ) }
						>
							{ sidebar }
						</div>
					) : null }
				</div>
			</div>
		</div>
	);
}

const CANVAS_SWITCH_READY_TIMEOUT = 8000;

function documentKey( postType, postId ) {
	if ( ! postType || postId === null || postId === undefined ) {
		return null;
	}
	return `${ postType }:${ postId }`;
}

function CanvasEditor( {
	post,
	postType,
	collectionId,
	fields,
	allFields,
	detailLayoutEntries,
	row,
	propertiesResolving = false,
	pendingPost,
	onSwitchPost,
	onDisplayedPost,
	isActive,
	topBarActions,
	notice,
	onApi,
	onSaved,
	onRestored,
	recentTarget,
} ) {
	const isCollection = definesTrait( post );
	const hasTrait =
		Array.isArray( post?.crtxt_trait ) && post.crtxt_trait.length > 0;
	const autosaveRecentTarget =
		recentTarget ??
		( post?.id && ! isCollection && ! hasTrait ? { id: post.id } : null );
	const { status, lastSavedAt, flushNow, isDirty, isSaving } = useAutosave( {
		recentTarget: autosaveRecentTarget,
	} );
	const postLock = usePostLock( {
		postId: post.id,
		postType: post.type ?? postType,
		enabled: isActive,
	} );
	const { resetPost } = useDispatch( editorStore );
	const discard = useCallback( () => resetPost(), [ resetPost ] );
	const lastNotifiedBacklinkSaveRef = useRef( null );

	useEffect( () => {
		onApi?.( { flushNow, discard } );
		return () => onApi?.( null );
	}, [ discard, flushNow, onApi ] );

	useEffect( () => {
		if (
			status !== 'saved' ||
			! lastSavedAt ||
			lastNotifiedBacklinkSaveRef.current === lastSavedAt
		) {
			return;
		}
		lastNotifiedBacklinkSaveRef.current = lastSavedAt;
		notifyBacklinksChanged();
		onSaved?.();
	}, [ lastSavedAt, onSaved, status ] );

	useEffect( () => {
		if (
			! pendingPost ||
			( pendingPost.id === post.id && pendingPost.type === post.type )
		) {
			return undefined;
		}

		let cancelled = false;

		async function switchAfterSave() {
			const didFlush = await flushNow();
			if ( ! cancelled && didFlush ) {
				if ( ! isActive ) {
					onSwitchPost( pendingPost );
					return;
				}
				// EntityRoute's `active` value does not move for page-to-page
				// swaps. Start the transition here and keep the old snapshot up
				// while the next editor render settles.
				withViewTransition( () => onSwitchPost( pendingPost ), {
					mode: 'hold-old-canvas',
				} );
			}
		}

		switchAfterSave();

		return () => {
			cancelled = true;
		};
	}, [
		pendingPost,
		post.id,
		post.type,
		flushNow,
		isActive,
		isDirty,
		isSaving,
		onSwitchPost,
	] );

	// Browse All writes to the editor store through EditorProvider. When that
	// flag is on, show Gutenberg's full inserter beside the canvas.
	const isInserterOpened = useSelect(
		( select ) => !! select( editorStore ).isInserterOpened(),
		[]
	);

	const hasProperties = Array.isArray( fields ) && fields.length > 0;
	const [ arePropertiesVisible, setArePropertiesVisible ] = useState( true );
	const [ isPropertiesLayoutEditing, setIsPropertiesLayoutEditing ] =
		useState( false );
	const [ layoutEditRequest, setLayoutEditRequest ] = useState( 0 );
	const togglePropertiesVisible = useCallback(
		() => setArePropertiesVisible( ( current ) => ! current ),
		[]
	);
	const requestPropertiesLayoutEdit = useCallback( () => {
		if ( ! isPropertiesLayoutEditing ) {
			setArePropertiesVisible( true );
		}
		setLayoutEditRequest( ( current ) => current + 1 );
	}, [ isPropertiesLayoutEditing ] );

	return (
		<DocumentPropertiesProvider
			collectionId={ collectionId }
			rowId={ row?.id ?? post.id }
			fields={ fields }
			allFields={ allFields }
			detailLayoutEntries={ detailLayoutEntries }
			fallbackRecord={ row }
			isResolving={ propertiesResolving }
			// During a document switch, only the header repair pass should
			// wait. The visible row properties can stay on screen until the
			// next editor is ready.
			isSchemaResolving={ propertiesResolving || !! pendingPost }
			isVisible={ arePropertiesVisible }
			isLayoutEditing={ isPropertiesLayoutEditing }
			layoutEditRequest={ layoutEditRequest }
			onLayoutEditingChange={ setIsPropertiesLayoutEditing }
			onRequestLayoutEdit={ requestPropertiesLayoutEdit }
			onToggleVisible={ togglePropertiesVisible }
		>
			<CortextMentions />
			<DocumentActions
				disabled={ postLock.isReadOnly }
				isActive={ isActive }
				postId={ post.id }
				topBarActions={ topBarActions }
				hasProperties={ hasProperties }
				arePropertiesVisible={ arePropertiesVisible }
				isPropertiesLayoutEditing={ isPropertiesLayoutEditing }
				onEditPropertiesLayout={ requestPropertiesLayoutEdit }
				onTogglePropertiesVisible={ togglePropertiesVisible }
			/>
			<CanvasInterfaceSkeleton
				className="cortext-canvas"
				content={
					<>
						{ notice }
						<PostLockFailureNotice
							error={ postLock.error }
							isRetrying={ postLock.isAcquiring }
							onRetry={ postLock.retry }
						/>
						<VisualCanvas
							featuredMedia={ post.featured_media }
							isActive={ isActive }
							isLocked={ postLock.isReadOnly }
							postId={ post.id }
							postType={ post.type ?? postType }
							onReady={ onDisplayedPost }
							onRestored={ onRestored }
						/>
					</>
				}
				secondarySidebar={
					isInserterOpened ? <CortextInserterSidebar /> : null
				}
				sidebar={ <InspectorSidebarSlot /> }
			/>
			<PostLockModal
				isOpen={ postLock.isLocked }
				isTakeover={ postLock.isTakeover }
				isTakingOver={ postLock.isTakingOver }
				onTakeOver={ postLock.takeOver }
				user={ postLock.user }
			/>
			<DocumentInspectorSidebar
				isLocked={ postLock.isReadOnly }
				postId={ post.id }
				postType={ postType }
			/>
		</DocumentPropertiesProvider>
	);
}

export default function Canvas( {
	postId,
	postType = POST_TYPE,
	collectionId,
	fields,
	allFields,
	detailLayoutEntries,
	row,
	propertiesResolving = false,
	onDisplayedPost,
	isActive,
	topBarActions = null,
	notice = null,
	onApi,
	onSaved,
	onRestored,
	recentTarget,
	useSubRegistry = false,
} ) {
	const { record: requestedPost } = useEntityRecord(
		'postType',
		postType,
		postId
	);
	const [ displayedPost, setDisplayedPost ] = useState( null );
	const pendingDisplayResolversRef = useRef( new Map() );
	const rowContextCacheRef = useRef( new Map() );
	const incomingRowContext = useMemo(
		() =>
			makeRowDocumentContext( {
				documentId: row?.id ?? postId,
				collectionId,
				fields,
				allFields,
				detailLayoutEntries,
				row,
				isResolving: propertiesResolving,
			} ),
		[
			allFields,
			collectionId,
			detailLayoutEntries,
			fields,
			postId,
			propertiesResolving,
			row,
		]
	);
	// Keep the editor on the last painted post until CanvasEditor has saved
	// and opted into the next one. Jumping straight to `requestedPost` would
	// remount the editor in the middle of navigation.
	const renderedPost = displayedPost ?? requestedPost;
	const renderedRowContext = rowDocumentContextForEditorPost(
		rowContextCacheRef.current,
		renderedPost?.id,
		incomingRowContext
	);

	useEffect( () => {
		rememberRowDocumentContext(
			rowContextCacheRef.current,
			incomingRowContext
		);
	}, [ incomingRowContext ] );

	useEffect( () => {
		if ( ! requestedPost ) {
			return;
		}
		setDisplayedPost( ( current ) => {
			if ( ! current ) {
				return requestedPost;
			}
			// Same document: refresh with the freshest payload.
			if (
				current.id === requestedPost.id &&
				current.type === requestedPost.type
			) {
				return requestedPost;
			}
			// Different document or type: keep the current editor up. CanvasEditor
			// will flush edits and switch posts explicitly.
			return current;
		} );
	}, [ requestedPost ] );

	useEffect( () => {
		const pendingDisplayResolvers = pendingDisplayResolversRef.current;
		return () => {
			pendingDisplayResolvers.forEach( ( pending ) => {
				window.clearTimeout( pending.timeoutId );
				pending.resolve();
			} );
			pendingDisplayResolvers.clear();
		};
	}, [] );

	const handleDisplayedPost = useCallback(
		( id, type ) => {
			const key = documentKey( type, id );
			const pending = key
				? pendingDisplayResolversRef.current.get( key )
				: null;
			if ( pending ) {
				window.clearTimeout( pending.timeoutId );
				pendingDisplayResolversRef.current.delete( key );
				pending.resolve();
			}
			onDisplayedPost?.( id );
		},
		[ onDisplayedPost ]
	);

	const switchDisplayedPost = useCallback(
		( nextPost ) => {
			const key = documentKey( nextPost?.type ?? postType, nextPost?.id );
			const readyPromise = new Promise( ( resolve ) => {
				if ( ! key || typeof window === 'undefined' ) {
					resolve();
					return;
				}

				const existing = pendingDisplayResolversRef.current.get( key );
				if ( existing ) {
					window.clearTimeout( existing.timeoutId );
					existing.resolve();
				}

				const pending = { resolve, timeoutId: null };
				pending.timeoutId = window.setTimeout( () => {
					if (
						pendingDisplayResolversRef.current.get( key ) !==
						pending
					) {
						return;
					}
					pendingDisplayResolversRef.current.delete( key );
					resolve();
				}, CANVAS_SWITCH_READY_TIMEOUT );
				pendingDisplayResolversRef.current.set( key, pending );
			} );

			setDisplayedPost( nextPost );
			return readyPromise;
		},
		[ postType ]
	);

	const pendingPost =
		renderedPost &&
		requestedPost &&
		( requestedPost.type !== renderedPost.type ||
			requestedPost.id !== renderedPost.id )
			? requestedPost
			: null;
	// `pendingPost` only exists once the next record has resolved. On a slow
	// request, compare the URL target with the post still on screen so the
	// progress bar covers the whole click-to-paint gap.
	const isCrossDocNav = Boolean(
		renderedPost &&
			postId &&
			( String( postId ) !== String( renderedPost.id ) ||
				( postType && postType !== renderedPost.type ) )
	);
	const showProgress = useDelayedFlag( ! renderedPost || isCrossDocNav );
	if ( ! renderedPost ) {
		return (
			<div className="cortext-canvas__loading cortext-canvas__loading--document">
				{ showProgress ? <CanvasProgressBar /> : null }
			</div>
		);
	}

	return (
		<>
			{ showProgress && (
				<div className="cortext-canvas__pending-progress">
					<CanvasProgressBar />
				</div>
			) }
			<EditorProvider
				post={ renderedPost }
				settings={ getEditorSettings() }
				useSubRegistry={ useSubRegistry }
			>
				<CortextLinkSuggestions allowCreate />
				<CanvasEditor
					post={ renderedPost }
					postType={ renderedPost.type ?? postType }
					collectionId={ renderedRowContext?.collectionId }
					fields={ renderedRowContext?.fields }
					allFields={ renderedRowContext?.allFields }
					detailLayoutEntries={
						renderedRowContext?.detailLayoutEntries
					}
					row={ renderedRowContext?.row }
					propertiesResolving={
						renderedRowContext?.isResolving ?? false
					}
					pendingPost={ pendingPost }
					onSwitchPost={ switchDisplayedPost }
					onDisplayedPost={ handleDisplayedPost }
					isActive={ isActive }
					topBarActions={ topBarActions }
					notice={ notice }
					onApi={ onApi }
					onSaved={ onSaved }
					onRestored={ onRestored }
					recentTarget={ recentTarget }
				/>
			</EditorProvider>
		</>
	);
}
