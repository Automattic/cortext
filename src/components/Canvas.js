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
import { Button, Disabled, Notice, Spinner } from '@wordpress/components';
import { cog } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';
import { useState } from '@wordpress/element';

import useAutosave from '../hooks/useAutosave';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import PublishToggle from './PublishToggle';

const SCOPE = 'cortext';
const INSPECTOR = 'cortext/block-inspector';

const STATUS_LABELS = {
	idle: '',
	saving: __( 'Saving…', 'cortext' ),
	saved: __( 'Saved', 'cortext' ),
	error: __( 'Failed to save', 'cortext' ),
};

function SaveStatus() {
	const { status } = useAutosave();
	const label = STATUS_LABELS[ status ] ?? '';

	return (
		<div
			className={ `cortext-canvas__status cortext-canvas__status--${ status }` }
			role="status"
			aria-live="polite"
		>
			{ label }
		</div>
	);
}

function Header() {
	const { enableComplementaryArea, disableComplementaryArea } =
		useDispatch( interfaceStore );
	const isInspectorOpen = useSelect(
		( select ) =>
			select( interfaceStore ).getActiveComplementaryArea( SCOPE ) ===
			INSPECTOR,
		[]
	);

	return (
		<div className="cortext-canvas__header">
			<SaveStatus />
			<PublishToggle />
			<Button
				icon={ cog }
				label={ __( 'Settings', 'cortext' ) }
				isPressed={ isInspectorOpen }
				onClick={ () =>
					isInspectorOpen
						? disableComplementaryArea( SCOPE )
						: enableComplementaryArea( SCOPE, INSPECTOR )
				}
			/>
		</div>
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

function VisualCanvas() {
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
		<BlockCanvas height="100%" styles={ styles }>
			<div
				className="editor-visual-editor__post-title-wrapper is-layout-constrained has-global-padding"
				contentEditable={ false }
				style={ { marginTop: '4rem', marginBottom: '2rem' } }
			>
				<PostTitle />
			</div>
			<BlockList
				className="wp-block-post-content is-layout-constrained has-global-padding"
				layout={ { type: 'constrained', ...layout } }
			/>
		</BlockCanvas>
	);
}

export default function Canvas( { postId } ) {
	const { record: post, isResolving } = useEntityRecord(
		'postType',
		POST_TYPE,
		postId
	);

	if ( isResolving || ! post ) {
		return (
			<div className="cortext-canvas__loading">
				<Spinner />
			</div>
		);
	}

	const isTrashed = post.status === 'trash';

	return (
		<EditorProvider
			post={ post }
			settings={ window.cortextEditorSettings ?? {} }
			useSubRegistry={ false }
		>
			<InterfaceSkeleton
				className="cortext-canvas"
				header={ <Header /> }
				content={
					<>
						{ isTrashed && <TrashedNotice postId={ post.id } /> }
						{ isTrashed ? (
							<Disabled className="cortext-canvas__locked">
								<VisualCanvas />
							</Disabled>
						) : (
							<VisualCanvas />
						) }
					</>
				}
				sidebar={ <ComplementaryArea.Slot scope={ SCOPE } /> }
			/>
			<InspectorSidebar />
		</EditorProvider>
	);
}
