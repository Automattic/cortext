import { registerFormatType } from '@wordpress/rich-text';
import { __ } from '@wordpress/i18n';

import { MENTION_ATTRIBUTE, MENTION_CLASS, MENTION_FORMAT } from './constants';

registerFormatType( MENTION_FORMAT, {
	title: __( 'Mention', 'cortext' ),
	tagName: 'a',
	className: MENTION_CLASS,
	attributes: {
		id: MENTION_ATTRIBUTE,
		href: 'href',
		iconEmoji: 'data-crtxt-icon-emoji',
		iconColor: 'data-crtxt-icon-color',
		iconImage: 'data-crtxt-icon-image',
		iconWp: 'data-crtxt-icon-wp',
		path: 'data-crtxt-path',
		style: 'style',
	},
	contentEditable: false,
	interactive: true,
	edit: () => null,
} );
