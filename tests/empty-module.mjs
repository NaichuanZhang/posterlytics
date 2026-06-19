// Stub for Deno `npm:`/`https:` specifiers during `node --test`. Any named import
// resolves to a no-op function; the pure helpers under test never call them.
const noop = () => ({})
export const createClient = noop
export default noop
