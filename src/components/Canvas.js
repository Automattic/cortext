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
import { Button, Spinner } from '@wordpress/components';
import { cog } from '@wordpress/icons';

const POST_TYPE = 'page';
const SCOPE = 'cortext';
const INSPECTOR = 'cortext/block-inspector';

function Header() {
	const { savePost } = useDispatch( editorStore );
	const { enableComplementaryArea, disableComplementaryArea } =
		useDispatch( interfaceStore );
	const isSaving = useSelect(
		( select ) => select( editorStore ).isSavingPost(),
		[]
	);
	const isInspectorOpen = useSelect(
		( select ) =>
			select( interfaceStore ).getActiveComplementaryArea( SCOPE ) ===
			INSPECTOR,
		[]
	);

	return (
		<div className="cortext-canvas__header">
			<Button
				variant="primary"
				isBusy={ isSaving }
				onClick={ () => savePost() }
			>
				{ isSaving
					? __( 'Saving…', 'cortext' )
					: __( 'Save', 'cortext' ) }
			</Button>
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
	return (
		<ComplementaryArea
			scope={ SCOPE }
			identifier={ INSPECTOR }
			icon={ cog }
			title={ __( 'Block', 'cortext' ) }
			isPinnable={ false }
			isActiveByDefault
		>
			<BlockInspector />
		</ComplementaryArea>
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
	// Constrained is hardcoded here. That covers the common case (block
	// theme with the default constrained content layout) but it's wrong
	// for two cases the core editor handles:
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

	return (
		<EditorProvider
			post={ post }
			settings={ window.cortextEditorSettings ?? {} }
			useSubRegistry={ false }
		>
			<InterfaceSkeleton
				className="cortext-canvas"
				header={ <Header /> }
				content={ <VisualCanvas /> }
				sidebar={ <ComplementaryArea.Slot scope={ SCOPE } /> }
			/>
			<InspectorSidebar />
		</EditorProvider>
	);
}
