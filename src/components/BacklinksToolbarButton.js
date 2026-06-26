import { Button, Popover } from '@wordpress/components';
import { useState } from '@wordpress/element';
import { _n, sprintf } from '@wordpress/i18n';
import { link } from '@wordpress/icons';

import BacklinksList from './BacklinksList';
import { useBacklinks } from './useBacklinks';
import './BacklinksPanel.scss';

// Discreet backlinks affordance for the row peek: an icon with the count in the
// detail toolbar that opens the source list in a popover, so backlinks never
// take room in the content itself.
export default function BacklinksToolbarButton( { documentId } ) {
	const { sources, total } = useBacklinks( documentId );
	const [ isOpen, setIsOpen ] = useState( false );

	if ( total < 1 ) {
		return null;
	}

	const label = sprintf(
		/* translators: %d: backlink count. */
		_n( '%d backlink', '%d backlinks', total, 'cortext' ),
		total
	);

	return (
		<div className="cortext-backlinks-toolbar">
			<Button
				className="cortext-row-detail__toolbar-button cortext-backlinks-toolbar__button"
				icon={ link }
				label={ label }
				showTooltip
				aria-expanded={ isOpen }
				onClick={ () => setIsOpen( ( value ) => ! value ) }
			>
				<span className="cortext-backlinks-toolbar__count">
					{ total }
				</span>
			</Button>
			{ isOpen ? (
				<Popover
					className="cortext-backlinks-popover"
					placement="bottom-end"
					onClose={ () => setIsOpen( false ) }
					onFocusOutside={ () => setIsOpen( false ) }
				>
					<div className="cortext-backlinks-popover__inner">
						<div className="cortext-backlinks-popover__title">
							{ label }
						</div>
						<BacklinksList
							sources={ sources }
							onNavigate={ () => setIsOpen( false ) }
						/>
					</div>
				</Popover>
			) : null }
		</div>
	);
}
