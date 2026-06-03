import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

import useSeedSampleContent from '../hooks/useSeedSampleContent';

// Two empty-state faces share one pane. With content present, this is the
// "nothing selected" placeholder. On a fresh install with no documents at all,
// it becomes the onboarding surface that offers sample content. The CTA is
// driven purely by `isWorkspaceEmpty`, so it disappears on its own once the
// first document exists; there is no persisted "onboarding done" flag.
export default function EmptyState( { isWorkspaceEmpty = false } ) {
	const { seed, isSeeding, error } = useSeedSampleContent();

	if ( ! isWorkspaceEmpty ) {
		return (
			<div className="cortext-canvas__empty">
				<p>{ __( 'Choose something to edit.', 'cortext' ) }</p>
			</div>
		);
	}

	return (
		<div className="cortext-canvas__empty">
			<h2 className="cortext-canvas__empty-title">
				{ __( 'Your workspace is empty', 'cortext' ) }
			</h2>
			<p className="cortext-canvas__empty-text">
				{ __(
					'Add some sample collections and pages to see how Cortext works, or create your first collection from scratch.',
					'cortext'
				) }
			</p>
			<div className="cortext-canvas__empty-actions">
				<Button
					variant="primary"
					isBusy={ isSeeding }
					disabled={ isSeeding }
					onClick={ seed }
				>
					{ isSeeding
						? __( 'Adding demo content…', 'cortext' )
						: __( 'Add demo content', 'cortext' ) }
				</Button>
			</div>
			{ error && (
				<p className="cortext-canvas__empty-error" role="alert">
					{ error }
				</p>
			) }
		</div>
	);
}
