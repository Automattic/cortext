import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import edit from './edit';
import save from './save';
import { registerDataViewVariations } from './variations';

registerBlockType( metadata.name, {
	...metadata,
	edit,
	save,
} );

registerDataViewVariations();
