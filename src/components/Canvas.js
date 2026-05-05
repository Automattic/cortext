import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	EditorProvider,
	PostTitle,
	store as editorStore,
} from '@wordpress/editor';
import {
	BlockList,
	BlockInspector,
	BlockCanvas,
	useSettings,
} from '@wordpress/block-editor';
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
import { useEffect, useState } from '@wordpress/element';

import useAutosave from '../hooks/useAutosave';
import { withViewTransition } from '../hooks/viewTransition';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import PageCover, { AddCoverButton } from './PageCover';
import PageIcon from './PageIcon';
import PageIdentityControls from './PageIdentityControls';
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

function CanvasReadyEffect( { postId, onReady } ) {
	useEffect( () => {
		onReady?.( postId );
	}, [ postId, onReady ] );

	return null;
}

function PageHeaderIdentity( { postId } ) {
	const iconMeta = useSelect(
		( select ) =>
			select( editorStore ).getEditedPostAttribute( 'meta' )
				?.cortext_page_icon ?? '',
		[]
	);
	const featuredMedia = useSelect(
		( select ) =>
			select( editorStore ).getEditedPostAttribute( 'featured_media' ) ??
			0,
		[]
	);

	const hasIcon = !! iconMeta;
	const hasCover = featuredMedia > 0;
	const showAddActions = ! hasIcon || ! hasCover;

	return (
		<div className="cortext-page-identity">
			<PageCover pageId={ postId } featuredMedia={ featuredMedia } />
			<div className="cortext-page-identity__row">
				{ hasIcon && (
					<PageIdentityControls
						pageId={ postId }
						currentIcon={ iconMeta }
						renderToggle={ ( { onToggle } ) => (
							<Button
								className="cortext-page-identity__icon-button"
								onClick={ onToggle }
								label={ __( 'Change icon', 'cortext' ) }
							>
								<PageIcon icon={ iconMeta } size={ 56 } />
							</Button>
						) }
					/>
				) }
				{ showAddActions && (
					<div className="cortext-page-identity__actions">
						{ ! hasIcon && (
							<PageIdentityControls
								pageId={ postId }
								currentIcon={ iconMeta }
								renderToggle={ ( { onToggle } ) => (
									<Button
										className="cortext-page-identity__add-button"
										variant="tertiary"
										onClick={ onToggle }
									>
										{ __( 'Add icon', 'cortext' ) }
									</Button>
								) }
							/>
						) }
						{ ! hasCover && (
							<AddCoverButton
								pageId={ postId }
								className="cortext-page-identity__add-button"
							/>
						) }
					</div>
				) }
			</div>
		</div>
	);
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
	// PageHeaderIdentity must live outside the BlockCanvas iframe: MediaUpload
	// calls `wp.media` from the host window, and the iframe's window has no
	// `wp.media` of its own. Putting it above the iframe also keeps the WP
	// media modal mounted in the top document where it expects to be.
	return (
		<div className="cortext-canvas__visual">
			<PageHeaderIdentity postId={ postId } />
			<div className="cortext-canvas__visual-canvas">
				<BlockCanvas height="100%" styles={ styles }>
					<div
						className="editor-visual-editor__post-title-wrapper is-layout-constrained has-global-padding"
						contentEditable={ false }
						style={ { marginTop: '2rem', marginBottom: '2rem' } }
					>
						<PostTitle />
					</div>
					<BlockList
						className="wp-block-post-content is-layout-constrained has-global-padding"
						layout={ { type: 'constrained', ...layout } }
					/>
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
