import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';

registerBlockType( metadata.name, {
	...metadata,
	edit: () => null,
	save: () => null,
} );
