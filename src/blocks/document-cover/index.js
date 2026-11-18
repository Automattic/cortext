import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import { deferredEdit } from '../deferredEdit';

registerBlockType( metadata.name, {
	...metadata,
	edit: deferredEdit( metadata.name ),
	save: () => null,
} );
