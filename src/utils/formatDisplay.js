/**
 * Re-export formatDisplay from its canonical location so the public
 * frontend bundle can import it without pulling in the full
 * EditableCell editor machinery via tree-shaking.
 */
export { formatDisplay } from '../components/EditableCell';
