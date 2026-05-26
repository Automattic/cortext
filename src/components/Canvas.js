import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import {
	InterfaceSkeleton,
	store as interfaceStore,
} from '@wordpress/interface';
import { Button } from '@wordpress/components';
import { cog, pencil, seen, unseen } from '@wordpress/icons';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';

// Editor-surface stylesheets. Imported via a sibling SCSS file (not
// src/index.scss) so mini-css-extract emits them into the editor chunk's
// CSS bundle, off the initial CSS path.
import './Canvas.scss';

// Registers core + Cortext blocks before any editor renders. Shared with
// RowEditor so opening a row peek first (without a document open) still
// gets the blocks registered.
import './initEditor';
import useAutosave from '../hooks/useAutosave';
import useDelayedFlag from '../hooks/useDelayedFlag';
import { withViewTransition } from '../hooks/viewTransition';
import { POST_TYPE } from './page-queries';
import CollectionPublishToggle from './CollectionPublishToggle';
import { DocumentPropertiesProvider } from './DocumentPropertiesContext';
import EditorBody from './EditorBody';
import PagePublishToggle from './PagePublishToggle';
import { CanvasProgressBar } from './Skeleton';
import { TopBarActionsFill } from './WorkspaceTopBar';
import PageInspectorSidebar, {
	INSPECTOR_SCOPE,
	InspectorSidebarSlot,
	PAGE_INSPECTOR,
	isInspectorArea,
} from './PageInspectorSidebar';

function DocumentActions( {
	isActive,
	postId,
	postType,
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
	const defaultInspector = PAGE_INSPECTOR;

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
				{ topBarActions }
				{ postType === POST_TYPE && <PagePublishToggle /> }
				{ postType === 'crtxt_collection' && (
					<CollectionPublishToggle collectionId={ postId } />
				) }
				{ hasProperties ? (
					<>
						<Button
							className="cortext-document-actions__fields"
							icon={ arePropertiesVisible ? unseen : seen }
							size="compact"
							label={
								arePropertiesVisible
									? __( 'Hide properties', 'cortext' )
									: __( 'Show properties', 'cortext' )
							}
							isPressed={ arePropertiesVisible }
							onClick={ onTogglePropertiesVisible }
						/>
						<Button
							className="cortext-document-actions__fields"
							icon={ pencil }
							size="compact"
							label={
								isPropertiesLayoutEditing
									? __( 'Done editing properties', 'cortext' )
									: __( 'Edit properties', 'cortext' )
							}
							isPressed={ isPropertiesLayoutEditing }
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
	postId,
	postType,
	onReady,
	onRestored,
} ) {
	return (
		<EditorBody
			featuredMedia={ featuredMedia }
			isActive={ isActive }
			postId={ postId }
			postType={ postType }
			onReady={ onReady }
			onRestored={ onRestored }
		/>
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
	const autosaveRecentTarget =
		recentTarget ??
		( postType === POST_TYPE && post?.id
			? { kind: 'page', id: post.id }
			: null );
	const { status, flushNow, isDirty, isSaving } = useAutosave( {
		recentTarget: autosaveRecentTarget,
	} );
	const { resetPost } = useDispatch( editorStore );
	const discard = useCallback( () => resetPost(), [ resetPost ] );

	useEffect( () => {
		onApi?.( { flushNow, discard } );
		return () => onApi?.( null );
	}, [ discard, flushNow, onApi ] );

	useEffect( () => {
		if ( status === 'saved' ) {
			onSaved?.();
		}
	}, [ onSaved, status ] );

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
			// While a document switch is in flight (`pendingPost` set),
			// the provider already carries the destination's fields but
			// the editor still renders the previous post. Pausing the
			// header-block lifecycle here keeps `EnsureHeaderBlocks` from
			// deleting `cortext/document-properties` from the outgoing
			// row right before `flushNow()` saves that deletion.
			isResolving={ !! pendingPost }
			isVisible={ arePropertiesVisible }
			layoutEditRequest={ layoutEditRequest }
			onLayoutEditingChange={ setIsPropertiesLayoutEditing }
			onToggleVisible={ togglePropertiesVisible }
		>
			<DocumentActions
				isActive={ isActive }
				postId={ post.id }
				postType={ postType }
				topBarActions={ topBarActions }
				hasProperties={ hasProperties }
				arePropertiesVisible={ arePropertiesVisible }
				isPropertiesLayoutEditing={ isPropertiesLayoutEditing }
				onEditPropertiesLayout={ requestPropertiesLayoutEdit }
				onTogglePropertiesVisible={ togglePropertiesVisible }
			/>
			<InterfaceSkeleton
				className="cortext-canvas"
				content={
					<>
						{ notice }
						<VisualCanvas
							featuredMedia={ post.featured_media }
							isActive={ isActive }
							postId={ post.id }
							postType={ post.type ?? postType }
							onReady={ onDisplayedPost }
							onRestored={ onRestored }
						/>
					</>
				}
				sidebar={ <InspectorSidebarSlot /> }
			/>
			<PageInspectorSidebar postId={ post.id } postType={ postType } />
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
	// Keep the last rendered post mounted until CanvasEditor has flushed edits
	// and chosen the next post. Falling back to `requestedPost` on a type change
	// would remount the editor at once and could drop edits mid-navigation.
	const renderedPost = displayedPost ?? requestedPost;

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
				settings={ window.cortextEditorSettings ?? {} }
				useSubRegistry={ useSubRegistry }
			>
				<CanvasEditor
					post={ renderedPost }
					postType={ renderedPost.type ?? postType }
					collectionId={ collectionId }
					fields={ fields }
					allFields={ allFields }
					detailLayoutEntries={ detailLayoutEntries }
					row={ row }
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
