// Editor-chunk half of the Cortext blocks: hands each block type its edit
// component. See `./deferredEdit` for why registration and edit are split.
import { setBlockEdits } from './deferredEdit';
import dataViewMetadata from './data-view/block.json';
import DataViewEdit from './data-view/edit';
import documentCoverMetadata from './document-cover/block.json';
import DocumentCoverEdit from './document-cover/edit';
import documentIconMetadata from './document-icon/block.json';
import DocumentIconEdit from './document-icon/edit';
import documentPropertiesMetadata from './document-properties/block.json';
import DocumentPropertiesEdit from './document-properties/edit';

setBlockEdits( {
	[ dataViewMetadata.name ]: DataViewEdit,
	[ documentCoverMetadata.name ]: DocumentCoverEdit,
	[ documentIconMetadata.name ]: DocumentIconEdit,
	[ documentPropertiesMetadata.name ]: DocumentPropertiesEdit,
} );
