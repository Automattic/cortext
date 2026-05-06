import { __ } from '@wordpress/i18n';
import {
	useEntityProp,
	useEntityRecord,
	store as coreStore,
} from '@wordpress/core-data';
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
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';

import useAutosave from '../hooks/useAutosave';
import { withViewTransition } from '../hooks/viewTransition';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import PublishToggle from './PublishToggle';
import { TopBarActionsFill } from './WorkspaceTopBar';
import MediaPicker, { MediaUploadCheck } from './MediaPicker';
import PageIdentityControls from './PageIdentityControls';

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

function PageIdentityActions( { postId } ) {
	const isInsertingCoverRef = useRef( false );
	const actionsRef = useRef( null );
	const [ meta ] = useEntityProp( 'postType', POST_TYPE, 'meta', postId );
	const iconMeta = meta?.cortext_page_icon ?? '';
	const { hasIcon, hasCover, isTrashed, selectedBlockName } = useSelect(
		( select ) => {
			const store = select( blockEditorStore );
			const blocks = store.getBlocks();
			const selectedClientId = store.getSelectedBlockClientId();
			return {
				hasCover: blocks.some(
					( block ) => block.name === 'cortext/page-cover'
				),
				hasIcon: blocks.some(
					( block ) => block.name === 'cortext/page-icon'
				),
				isTrashed:
					select( editorStore ).getCurrentPostAttribute(
						'status'
					) === 'trash',
				selectedBlockName: selectedClientId
					? store.getBlockName( selectedClientId )
					: null,
			};
		},
		[]
	);
	const { insertBlocks } = useDispatch( blockEditorStore );
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );

	useEffect( () => {
		if ( isTrashed || hasCover ) {
			return undefined;
		}
		const node = actionsRef.current;
		const ownerDocument = node?.ownerDocument;
		if ( ! node || ! ownerDocument ) {
			return undefined;
		}
		const focusFirstActionFromTitle = ( event ) => {
			if (
				event.key !== 'Tab' ||
				event.shiftKey ||
				event.defaultPrevented
			) {
				return;
			}
			const target = event.target;
			const targetIsPostTitle =
				target &&
				typeof target.closest === 'function' &&
				target.closest( '[data-type="core/post-title"]' );
			const titleHasFocus = ownerDocument.querySelector(
				'[data-type="core/post-title"]:focus-within'
			);
			if (
				! targetIsPostTitle &&
				! titleHasFocus &&
				selectedBlockName !== 'core/post-title'
			) {
				return;
			}
			const firstAction = node.querySelector(
				'.cortext-canvas__identity-action:not(:disabled)'
			);
			if ( ! firstAction ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			firstAction.focus();
		};
		ownerDocument.addEventListener(
			'keydown',
			focusFirstActionFromTitle,
			true
		);
		return () =>
			ownerDocument.removeEventListener(
				'keydown',
				focusFirstActionFromTitle,
				true
			);
	}, [ hasCover, isTrashed, selectedBlockName ] );

	if ( isTrashed || hasCover ) {
		return null;
	}

	const ensureIconBlock = () => {
		if ( hasIcon ) {
			return;
		}
		const block = createBlock( 'cortext/page-icon', {
			lock: { move: true },
		} );
		insertBlocks( block, 0, undefined, false );
	};

	const insertCover = async ( mediaId ) => {
		if ( hasCover || isInsertingCoverRef.current ) {
			return;
		}
		isInsertingCoverRef.current = true;
		const block = createBlock( 'cortext/page-cover', {
			align: 'full',
			lock: { move: true },
		} );
		insertBlocks( block, 0, undefined, false );
		try {
			editEntityRecord( 'postType', POST_TYPE, postId, {
				featured_media: mediaId,
			} );
			await saveEditedEntityRecord( 'postType', POST_TYPE, postId );
		} finally {
			isInsertingCoverRef.current = false;
		}
	};

	return (
		<div
			ref={ actionsRef }
			className="cortext-canvas__identity-actions"
			role="group"
			aria-label={ __( 'Page identity actions', 'cortext' ) }
		>
			{ ! hasIcon && ! hasCover && (
				<PageIdentityControls
					pageId={ postId }
					currentIcon={ iconMeta }
					onAfterSave={ ensureIconBlock }
					renderToggle={ ( { onToggle } ) => (
						<Button
							className="cortext-canvas__identity-action"
							variant="tertiary"
							onClick={ onToggle }
						>
							{ __( 'Add icon', 'cortext' ) }
						</Button>
					) }
				/>
			) }
			{ ! hasCover && (
				<MediaUploadCheck>
					<MediaPicker
						allowedTypes={ [ 'image' ] }
						onSelect={ ( media ) => insertCover( media.id ) }
						render={ ( { open } ) => (
							<Button
								className="cortext-canvas__identity-action"
								variant="tertiary"
								onClick={ open }
							>
								{ __( 'Add cover', 'cortext' ) }
							</Button>
						) }
					/>
				</MediaUploadCheck>
			) }
		</div>
	);
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
					className="cortext-document-actions__settings"
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
			selectedName === 'cortext/page-icon';
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

// Auto-inserts the locked state/header blocks that aren't there yet and
// strips legacy cortext/page-header-actions blocks. Those actions were
// editor chrome saved as content; PageIdentityActions now renders them
// outside BlockCanvas without adding a block to post_content.
function EnsureHeaderBlocks( { postId } ) {
	const [ meta ] = useEntityProp( 'postType', POST_TYPE, 'meta', postId );
	const [ featuredId ] = useEntityProp(
		'postType',
		POST_TYPE,
		'featured_media',
		postId
	);
	const iconMeta = meta?.cortext_page_icon ?? '';
	const {
		coverIndex,
		hasCover,
		hasIcon,
		hasTitle,
		duplicateHeaderIds,
		legacyActionIds,
		isTrashed,
	} = useSelect( ( select ) => {
		const store = select( blockEditorStore );
		const blocks = store.getBlocks();
		const names = blocks.map( ( block ) => block.name );
		const seenSingletons = new Set();
		const duplicateIds = [];
		blocks.forEach( ( block ) => {
			if (
				block.name !== 'cortext/page-cover' &&
				block.name !== 'cortext/page-icon' &&
				block.name !== 'core/post-title'
			) {
				return;
			}
			if ( seenSingletons.has( block.name ) ) {
				duplicateIds.push( block.clientId );
				return;
			}
			seenSingletons.add( block.name );
		} );
		return {
			coverIndex: names.indexOf( 'cortext/page-cover' ),
			hasCover: names.includes( 'cortext/page-cover' ),
			hasIcon: names.includes( 'cortext/page-icon' ),
			hasTitle: names.includes( 'core/post-title' ),
			duplicateHeaderIds: duplicateIds,
			legacyActionIds: blocks
				.filter(
					( block ) => block.name === 'cortext/page-header-actions'
				)
				.map( ( block ) => block.clientId ),
			isTrashed:
				select( editorStore ).getCurrentPostAttribute( 'status' ) ===
				'trash',
		};
	}, [] );
	const { insertBlocks, removeBlock, updateBlockAttributes } =
		useDispatch( blockEditorStore );

	useLayoutEffect( () => {
		if ( isTrashed ) {
			return;
		}

		[ ...legacyActionIds, ...duplicateHeaderIds ].forEach( ( clientId ) => {
			updateBlockAttributes( clientId, { lock: {} } );
			removeBlock( clientId, false );
		} );
	}, [
		duplicateHeaderIds,
		isTrashed,
		legacyActionIds,
		removeBlock,
		updateBlockAttributes,
	] );

	// useLayoutEffect rather than useEffect: we want the insertion to
	// happen between render and paint so the user never sees the
	// intermediate state where the page has body content but the locked
	// header blocks haven't been added yet.
	useLayoutEffect( () => {
		if ( isTrashed ) {
			return;
		}

		if ( featuredId > 0 && ! hasCover ) {
			insertBlocks(
				createBlock( 'cortext/page-cover', {
					align: 'full',
					lock: { move: true },
				} ),
				0,
				undefined,
				false
			);
		}
		if ( iconMeta && ! hasIcon ) {
			let iconIndex = 0;
			if ( hasCover ) {
				iconIndex = coverIndex + 1;
			} else if ( featuredId > 0 ) {
				iconIndex = 1;
			}
			insertBlocks(
				createBlock( 'cortext/page-icon', {
					lock: { move: true },
				} ),
				iconIndex,
				undefined,
				false
			);
		}
		if ( ! hasTitle ) {
			const titleIndex =
				( featuredId > 0 ? 1 : 0 ) + ( iconMeta ? 1 : 0 );
			insertBlocks(
				createBlock( 'core/post-title', {
					lock: { move: true, remove: true },
				} ),
				titleIndex,
				undefined,
				false
			);
		}
	}, [
		coverIndex,
		featuredId,
		hasCover,
		hasIcon,
		hasTitle,
		iconMeta,
		insertBlocks,
		isTrashed,
	] );

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
			<div className="cortext-canvas__block-canvas">
				<BlockCanvas height="100%" styles={ styles }>
					<PageIdentityActions postId={ postId } />
					<EnsureHeaderBlocks postId={ postId } />
					<div className="cortext-canvas__editor">
						<BlockList
							className="wp-block-post-content is-layout-constrained has-global-padding"
							layout={ { type: 'constrained', ...layout } }
						/>
					</div>
					<CanvasReadyEffect postId={ postId } onReady={ onReady } />
				</BlockCanvas>
			</div>
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
