import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import {
	BlockList,
	BlockInspector,
	BlockCanvas,
	store as blockEditorStore,
	useSettings,
} from '@wordpress/block-editor';
import { createBlock } from '@wordpress/blocks';
import {
	InterfaceSkeleton,
	ComplementaryArea,
	store as interfaceStore,
} from '@wordpress/interface';
import {
	Button,
	Disabled,
	Notice,
	SnackbarList,
	Spinner,
} from '@wordpress/components';
import { store as noticesStore } from '@wordpress/notices';
import { cog } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';
import { useEffect, useLayoutEffect, useState } from '@wordpress/element';

import useAutosave from '../hooks/useAutosave';
import { withViewTransition } from '../hooks/viewTransition';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import PublishToggle from './PublishToggle';
import { TopBarActionsFill } from './WorkspaceTopBar';

const SCOPE = 'cortext';
const INSPECTOR = 'cortext/block-inspector';

// Renders only Cortext-owned snackbars (the autosave failure toast). The
// editor store also dispatches its own "Post updated" success notice on every
// save; in an autosave-silent UI those would fire constantly, so we filter to
// notices we tagged ourselves.
function CortextSnackbars() {
	const notices = useSelect(
		( select ) =>
			select( noticesStore )
				.getNotices()
				.filter(
					( n ) =>
						n.type === 'snackbar' &&
						typeof n.id === 'string' &&
						n.id.startsWith( 'cortext-' )
				),
		[]
	);
	const { removeNotice } = useDispatch( noticesStore );

	return <SnackbarList notices={ notices } onRemove={ removeNotice } />;
}

function DocumentActions( { isActive } ) {
	const { enableComplementaryArea, disableComplementaryArea } =
		useDispatch( interfaceStore );
	const isInspectorOpen = useSelect(
		( select ) =>
			select( interfaceStore ).getActiveComplementaryArea( SCOPE ) ===
			INSPECTOR,
		[]
	);

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
				<PublishToggle />
				<Button
					icon={ cog }
					size="compact"
					label={ __( 'Settings', 'cortext' ) }
					isPressed={ isInspectorOpen }
					onClick={ () =>
						isInspectorOpen
							? disableComplementaryArea( SCOPE )
							: enableComplementaryArea( SCOPE, INSPECTOR )
					}
				/>
			</div>
		</TopBarActionsFill>
	);
}

function InspectorSidebar() {
	// Mirror the canvas: when the post is in trash, the inspector becomes
	// read-only too. Otherwise users could still edit block attributes
	// (alignment, colors, etc.) from the sidebar even though the canvas
	// itself is locked.
	const isTrashed = useSelect(
		( select ) =>
			select( editorStore ).getCurrentPostAttribute( 'status' ) ===
			'trash',
		[]
	);

	return (
		<ComplementaryArea
			scope={ SCOPE }
			identifier={ INSPECTOR }
			icon={ cog }
			title={ __( 'Block', 'cortext' ) }
			isPinnable={ false }
			isActiveByDefault
		>
			{ isTrashed ? (
				<Disabled>
					<BlockInspector />
				</Disabled>
			) : (
				<BlockInspector />
			) }
		</ComplementaryArea>
	);
}

function TrashedNotice( { postId } ) {
	const { invalidateResolution, receiveEntityRecords } =
		useDispatch( 'core' );
	const [ isRestoring, setIsRestoring ] = useState( false );
	const [ error, setError ] = useState( null );

	const restore = async () => {
		setError( null );
		setIsRestoring( true );
		try {
			const response = await apiFetch( {
				path: `/cortext/v1/pages/${ postId }/restore`,
				method: 'POST',
			} );
			// The endpoint returns the freshly-untrashed post so the canvas
			// can drop the trashed banner without a follow-up GET.
			if ( response?.post ) {
				receiveEntityRecords( 'postType', POST_TYPE, [
					response.post,
				] );
			}
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
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not restore page.', 'cortext' )
			);
		} finally {
			setIsRestoring( false );
		}
	};

	return (
		<Notice
			className="cortext-canvas__notice"
			status="warning"
			isDismissible={ false }
			actions={ [
				{
					label: __( 'Restore', 'cortext' ),
					onClick: restore,
					disabled: isRestoring,
					variant: 'primary',
				},
			] }
		>
			{ error ? error : __( 'This page is in trash.', 'cortext' ) }
		</Notice>
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
			selectedName === 'cortext/page-cover' ||
			selectedName === 'cortext/page-icon' ||
			selectedName === 'cortext/page-header-actions';
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

// Auto-inserts the locked header blocks that aren't there yet:
//   - cortext/page-header-actions (renders Add icon / Add cover)
//   - core/post-title (so the title sits below cover and icon)
// Both go after any cover/icon already in content, in canonical order.
// Storage stays clean: post_title is still the source of truth; the
// blocks are render hints and the actions block has a no-op server
// render.
function EnsureHeaderBlocks() {
	const { hasActions, hasTitle, blockOrder } = useSelect( ( select ) => {
		const store = select( blockEditorStore );
		const order = store.getBlockOrder();
		const names = order.map( ( id ) => store.getBlockName( id ) );
		return {
			hasActions: names.includes( 'cortext/page-header-actions' ),
			hasTitle: names.includes( 'core/post-title' ),
			blockOrder: names,
		};
	}, [] );
	const { insertBlocks } = useDispatch( blockEditorStore );

	// useLayoutEffect rather than useEffect: we want the insertion to
	// happen between render and paint so the user never sees the
	// intermediate state where the page has body content but the locked
	// header blocks haven't been added yet (which manifests as content
	// "sliding down" on first open).
	useLayoutEffect( () => {
		// Insert position: right after any cover and icon blocks.
		let index = 0;
		while (
			blockOrder[ index ] === 'cortext/page-cover' ||
			blockOrder[ index ] === 'cortext/page-icon'
		) {
			index++;
		}

		const toInsert = [];
		if ( ! hasActions ) {
			toInsert.push(
				createBlock( 'cortext/page-header-actions', {
					lock: { move: true, remove: true },
				} )
			);
		}
		if ( ! hasTitle ) {
			toInsert.push(
				createBlock( 'core/post-title', {
					lock: { move: true, remove: true },
				} )
			);
		}
		if ( toInsert.length ) {
			insertBlocks( toInsert, index, undefined, false );
		}
	}, [ hasActions, hasTitle, blockOrder, insertBlocks ] );

	return null;
}

function CanvasReadyEffect( { postId, onReady } ) {
	useEffect( () => {
		onReady?.( postId );
	}, [ postId, onReady ] );

	return null;
}

function VisualCanvas( { postId, onReady } ) {
	const styles = useSelect(
		( select ) => select( editorStore ).getEditorSettings().styles,
		[]
	);
	const [ layout ] = useSettings( 'layout' );

	// Mirror the post editor's root-container setup so theme.json
	// constrained layout (max-width, root padding, post-content gap)
	// applies. Plain `<BlockList />` defaults to flow with no classes,
	// leaving the root container full-width and unpadded.
	//
	// TODO: derive the root layout from the page's resolved template
	// (mirror core's `editedPostTemplate` lookup + `useLayoutClasses`
	// against the template's `core/post-content` attributes). Until
	// that's done we hardcode constrained, which is wrong in two cases:
	//   - Classic themes (no layout support): core falls back to
	//     { type: 'default' } when `themeSupportsLayout` is false.
	//   - Pages whose `core/post-content` block carries its own
	//     `layout` attribute (e.g. flex, grid for landing pages):
	//     core derives the wrapper class via `useLayoutClasses` against
	//     the block's saved attributes, not the global setting.
	// The second case matters once autosave is on — the editor would
	// render the post centered while the frontend renders flex/grid,
	// and the user wouldn't notice the divergence until preview.
	return (
		<div className="cortext-canvas__visual">
			<BlockCanvas height="100%" styles={ styles }>
				<EnsureHeaderBlocks />
				<div className="cortext-canvas__editor">
					<BlockList
						className="wp-block-post-content is-layout-constrained has-global-padding"
						layout={ { type: 'constrained', ...layout } }
					/>
				</div>
				<CanvasReadyEffect postId={ postId } onReady={ onReady } />
			</BlockCanvas>
		</div>
	);
}

function CanvasEditor( {
	post,
	pendingPost,
	onSwitchPost,
	onDisplayedPost,
	isActive,
} ) {
	const { flushNow, isDirty, isSaving } = useAutosave();
	const isTrashed = post.status === 'trash';

	useEffect( () => {
		if ( ! pendingPost || pendingPost.id === post.id ) {
			return undefined;
		}

		let cancelled = false;

		async function switchAfterSave() {
			const didFlush = await flushNow();
			if ( ! cancelled && didFlush ) {
				// Page-to-page swaps don't change EntityRoute's `active`, so
				// the surface-level cross-fade can't see them. Trigger one
				// here instead.
				withViewTransition( () => onSwitchPost( pendingPost ) );
			}
		}

		switchAfterSave();

		return () => {
			cancelled = true;
		};
	}, [ pendingPost, post.id, flushNow, isDirty, isSaving, onSwitchPost ] );

	return (
		<>
			<DocumentActions isActive={ isActive } />
			<CortextSnackbars />
			<HideHeaderBlockKebab />
			<InterfaceSkeleton
				className="cortext-canvas"
				content={
					<>
						{ isTrashed && <TrashedNotice postId={ post.id } /> }
						{ isTrashed ? (
							<Disabled className="cortext-canvas__locked">
								<VisualCanvas
									postId={ post.id }
									onReady={ onDisplayedPost }
								/>
							</Disabled>
						) : (
							<VisualCanvas
								postId={ post.id }
								onReady={ onDisplayedPost }
							/>
						) }
					</>
				}
				sidebar={ <ComplementaryArea.Slot scope={ SCOPE } /> }
			/>
			<InspectorSidebar />
		</>
	);
}

export default function Canvas( { postId, onDisplayedPost, isActive } ) {
	const { record: requestedPost } = useEntityRecord(
		'postType',
		POST_TYPE,
		postId
	);
	const [ displayedPost, setDisplayedPost ] = useState( null );
	const renderedPost = displayedPost ?? requestedPost;

	useEffect( () => {
		if ( ! requestedPost ) {
			return;
		}
		setDisplayedPost( ( current ) => {
			if ( ! current || current.id === requestedPost.id ) {
				return requestedPost;
			}
			return current;
		} );
	}, [ requestedPost ] );

	if ( ! renderedPost ) {
		return (
			<div className="cortext-canvas__loading">
				<Spinner />
			</div>
		);
	}

	const pendingPost =
		requestedPost && requestedPost.id !== renderedPost.id
			? requestedPost
			: null;

	return (
		<EditorProvider
			post={ renderedPost }
			settings={ window.cortextEditorSettings ?? {} }
			useSubRegistry={ false }
		>
			<CanvasEditor
				post={ renderedPost }
				pendingPost={ pendingPost }
				onSwitchPost={ setDisplayedPost }
				onDisplayedPost={ onDisplayedPost }
				isActive={ isActive }
			/>
		</EditorProvider>
	);
}
