import {
	Button,
	CheckboxControl,
	ExternalLink,
	Modal,
} from '@wordpress/components';
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, bug, caution, comment } from '@wordpress/icons';

import './BetaNoticeModal.scss';

const REPO_URL = 'https://github.com/Automattic/cortext';

export default function BetaNoticeModal( { onAcknowledge } ) {
	const [ dontShowAgain, setDontShowAgain ] = useState( true );

	return (
		<Modal
			className="cortext-beta-notice"
			overlayClassName="cortext-beta-notice-overlay"
			title={ __( 'Welcome to Cortext (beta)', 'cortext' ) }
			onRequestClose={ () => onAcknowledge( dontShowAgain ) }
			size="medium"
		>
			<p className="cortext-beta-notice__intro">
				{ __( 'Before you start, a quick heads-up:', 'cortext' ) }
			</p>
			<ul className="cortext-beta-notice__list">
				<li>
					<span className="cortext-beta-notice__icon">
						<Icon icon={ bug } />
					</span>
					<div>
						<strong>
							{ __( 'Expect rough edges.', 'cortext' ) }
						</strong>{ ' ' }
						{ __(
							'Cortext is in beta. Some workflows are unfinished, and updates may still change behavior.',
							'cortext'
						) }
					</div>
				</li>
				<li>
					<span className="cortext-beta-notice__icon">
						<Icon icon={ caution } />
					</span>
					<div>
						<strong>
							{ __( 'Start with test content.', 'cortext' ) }
						</strong>{ ' ' }
						{ __(
							'Try it somewhere low-stakes before adding anything important.',
							'cortext'
						) }
					</div>
				</li>
				<li>
					<span className="cortext-beta-notice__icon">
						<Icon icon={ comment } />
					</span>
					<div>
						<strong>
							{ __( 'Feedback is welcome.', 'cortext' ) }
						</strong>{ ' ' }
						{ __(
							'Tell us what breaks, what feels off, and what you need next.',
							'cortext'
						) }
					</div>
				</li>
			</ul>
			<p className="cortext-beta-notice__repo">
				<ExternalLink href={ REPO_URL }>
					{ __( 'View Cortext on GitHub', 'cortext' ) }
				</ExternalLink>
			</p>
			<div className="cortext-beta-notice__footer">
				<CheckboxControl
					__nextHasNoMarginBottom
					label={ __( "Don't show this again", 'cortext' ) }
					checked={ dontShowAgain }
					onChange={ setDontShowAgain }
				/>
				<Button
					variant="primary"
					onClick={ () => onAcknowledge( dontShowAgain ) }
				>
					{ __( 'Got it', 'cortext' ) }
				</Button>
			</div>
		</Modal>
	);
}
