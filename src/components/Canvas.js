import { __ } from '@wordpress/i18n';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	EditorProvider,
	PostTitle,
	store as editorStore,
} from '@wordpress/editor';
import { BlockList } from '@wordpress/block-editor';
import { Button, Spinner } from '@wordpress/components';

const POST_TYPE = 'page';

function Header() {
	const { savePost } = useDispatch( editorStore );
	const isSaving = useSelect(
		( select ) => select( editorStore ).isSavingPost(),
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
		</div>
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
		<EditorProvider post={ post } settings={ {} }>
			<div className="cortext-canvas">
				<Header />
				<div className="cortext-canvas__body">
					<div className="cortext-canvas__title">
						<PostTitle />
					</div>
					<BlockList />
				</div>
			</div>
		</EditorProvider>
	);
}
