// Central entry for Cortext-provided blocks. Keeps registration side-effects
// in one place so src/index.js stays a thin bootstrap.
import './data-view';
import './document-icon';
import './document-cover';
import './page-header-actions';

// Install the editor filter that puts row properties below the title. The slot
// only renders when Canvas or RowEditor provides row-property context.
import '../editor/filters/document-properties-slot';
