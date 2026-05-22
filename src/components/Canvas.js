import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import { store as blockEditorStore } from '@wordpress/block-editor';
import {
	InterfaceSkeleton,
	store as interfaceStore,
} from '@wordpress/interface';
import { Button, Disabled } from '@wordpress/components';
import { chevronDown, chevronUp, cog, seen, unseen } from '@wordpress/icons';
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
import EditorBody from './EditorBody';
import PagePublishToggle from './PagePublishToggle';
import RowProperties from './RowProperties';
import { CanvasProgressBar } from './Skeleton';
import { TopBarActionsFill } from './WorkspaceTopBar';
import PageInspectorSidebar, {
	BLOCK_INSPECTOR,
	INSPECTOR_SCOPE,
	InspectorSidebarSlot,
	PAGE_INSPECTOR,
	isInspectorArea,
} from './PageInspectorSidebar';

function DocumentActions( {
	isActive,
	postType,
	topBarActions,
	hasProperties,
	arePropertiesVisible,
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
	const defaultInspector =
		postType === POST_TYPE ? PAGE_INSPECTOR : BLOCK_INSPECTOR;

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
				{ postType === POST_TYPE ? <PagePublishToggle /> : null }
				{ hasProperties ? (
					<Button
						className="cortext-document-actions__fields"
						icon={ arePropertiesVisible ? unseen : seen }
						size="compact"
						label={
							arePropertiesVisible
								? __( 'Hide fields', 'cortext' )
								: __( 'Show fields', 'cortext' )
						}
						isPressed={ arePropertiesVisible }
						onClick={ onTogglePropertiesVisible }
					/>
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

// While one of our locked header blocks is selected, hide core's block
// settings menu (the "kebab"). Its items (Cut, Copy, Add before/after,
// Lock, Hide, Create pattern, etc.) make no sense on a fixed-position
// singleton block, and there's no per-block API to filter individual
// items. The contextual toolbar lives in the parent document while the
// block itself is in the BlockCanvas iframe, so :has() can't bridge the
// boundary; toggling a body class here lets a plain CSS rule do the work.
function HideHeaderBlockKebab() {
	const selectedName = useSelect( ( select ) => {
		const store = select( blockEditorStore );
		const clientId = store.getSelectedBlockClientId();
		return clientId ? store.getBlockName( clientId ) : null;
	}, [] );

	useEffect( () => {
		const isHeader =
			selectedName === 'cortext/document-cover' ||
			selectedName === 'cortext/document-icon';
		document.body.classList.toggle(
			'cortext-hide-block-settings-menu',
			isHeader
		);
		return () => {
			document.body.classList.remove(
				'cortext-hide-block-settings-menu'
			);
		};
	}, [ selectedName ] );

	return null;
}

function VisualCanvas( { isActive, postId, postType, onReady, onRestored } ) {
	return (
		<EditorBody
			isActive={ isActive }
			postId={ postId }
			postType={ postType }
			onReady={ onReady }
			onRestored={ onRestored }
		/>
	);
}

const CANVAS_SWITCH_READY_TIMEOUT = 2500;

function documentKey( postType, postId ) {
	if ( ! postType || postId === null || postId === undefined ) {
		return null;
	}
	return `${ postType }:${ postId }`;
}

function CanvasEditor( {
	post,
	postType,
	fields,
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
	const isTrashed = post.status === 'trash';

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
	const togglePropertiesVisible = useCallback(
		() => setArePropertiesVisible( ( current ) => ! current ),
		[]
	);
	// tech-debt.md#41: row properties are shell chrome until they become a
	// locked dynamic block with frontend rendering.
	const rowProperties = hasProperties ? (
		<div
			className={
				'cortext-row-detail cortext-row-detail--canvas-properties' +
				( arePropertiesVisible
					? ''
					: ' cortext-row-detail--canvas-properties-collapsed' )
			}
		>
			<Button
				className="cortext-row-detail__canvas-properties-toggle"
				icon={ arePropertiesVisible ? chevronUp : chevronDown }
				size="small"
				label={
					arePropertiesVisible
						? __( 'Hide fields', 'cortext' )
						: __( 'Show fields', 'cortext' )
				}
				showTooltip
				onClick={ togglePropertiesVisible }
			/>
			<div className="cortext-row-detail__canvas-properties-body">
				<RowProperties fields={ fields } row={ row } />
			</div>
		</div>
	) : null;

	return (
		<>
			<DocumentActions
				isActive={ isActive }
				postType={ postType }
				topBarActions={ topBarActions }
				hasProperties={ hasProperties }
				arePropertiesVisible={ arePropertiesVisible }
				onTogglePropertiesVisible={ togglePropertiesVisible }
			/>
			<HideHeaderBlockKebab />
			<InterfaceSkeleton
				className="cortext-canvas"
				content={
					<>
						{ notice }
						{ isTrashed && rowProperties ? (
							<Disabled>{ rowProperties }</Disabled>
						) : (
							rowProperties
						) }
						<VisualCanvas
							isActive={ isActive }
							postId={ post.id }
							postType={ postType }
							onReady={ onDisplayedPost }
							onRestored={ onRestored }
						/>
					</>
				}
				sidebar={ <InspectorSidebarSlot /> }
			/>
			<PageInspectorSidebar postId={ post.id } postType={ postType } />
		</>
	);
}

export default function Canvas( {
	postId,
	postType = POST_TYPE,
	fields,
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

	const switchDisplayedPost = useCallback( ( nextPost ) => {
		const key = documentKey( nextPost?.type, nextPost?.id );
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
					pendingDisplayResolversRef.current.get( key ) !== pending
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
	}, [] );

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
					postType={ renderedPost.type }
					fields={ fields }
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
