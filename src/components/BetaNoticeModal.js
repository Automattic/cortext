import {
	Button,
	CheckboxControl,
	ExternalLink,
	Modal,
} from '@wordpress/components';
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { Icon, backup, bug, comment } from '@wordpress/icons';

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
				{ __(
					'Thanks for trying Cortext! A few things to keep in mind before you dive in:',
					'cortext'
				) }
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
							'Cortext is in beta. Bugs, missing features, and breaking changes between releases are still on the table.',
							'cortext'
						) }
					</div>
				</li>
				<li>
					<span className="cortext-beta-notice__icon">
						<Icon icon={ backup } />
					</span>
					<div>
						<strong>
							{ __(
								'The data model is still evolving.',
								'cortext'
							) }
						</strong>{ ' ' }
						{ __(
							'Content you create now may not survive future schema changes. Avoid using Cortext for anything you can’t afford to lose.',
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
							'Please test on a staging site, not production, and let us know what you find.',
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
