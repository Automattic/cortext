import { registerBlockType } from '@wordpress/blocks';

import metadata from './block.json';
import { deferredEdit } from '../deferredEdit';
import save from './save';
import { registerDataViewVariations } from './variations';

registerBlockType( metadata.name, {
	...metadata,
	edit: deferredEdit( metadata.name ),
	save,
} );

registerDataViewVariations();
