// Registers the core and Cortext blocks for every editor surface in the
// shell. Canvas (full document editor) and RowEditor (row peek, modal,
// and full-page row editor) both mount EditorProvider, so each one
// imports this module to make sure registration runs before any editor
// renders blocks. The guard makes the side effect idempotent: whichever
// surface loads first wins, the second is a no-op.
import { registerCoreBlocks } from '@wordpress/block-library';

// Register the `cortext` category before the `../blocks` barrel registers
// Cortext blocks from block.json.
import { CORTEXT_BLOCK_CATEGORY } from './cortextBlockCategory';
import '../blocks';

export { CORTEXT_BLOCK_CATEGORY };

if ( ! window.__cortextBlocksRegistered ) {
	registerCoreBlocks();
	window.__cortextBlocksRegistered = true;
}
