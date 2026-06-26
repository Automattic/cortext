import { PanelBody } from '@wordpress/components';
import { _n, sprintf } from '@wordpress/i18n';

import BacklinksList from './BacklinksList';
import { useBacklinks } from './useBacklinks';
import './BacklinksPanel.scss';

// Inspector treatment: a native collapsible panel that sits with the rest of
// the document settings. The peek uses BacklinksToolbarButton instead.
export default function BacklinksPanel( { documentId, initialOpen = false } ) {
	const { sources, total } = useBacklinks( documentId );

	if ( total < 1 ) {
		return null;
	}

	const title = sprintf(
		/* translators: %d: backlink count. */
		_n( '%d backlink', '%d backlinks', total, 'cortext' ),
		total
	);

	return (
		<PanelBody title={ title } initialOpen={ initialOpen }>
			<BacklinksList sources={ sources } />
		</PanelBody>
	);
}
