// Legacy duplicate of /post-task that called the disabled /api/tasks/create
// (Apps Script). Filename is not a valid Next.js page name (`page-*.tsx`) so
// it never rendered, but its presence in the tree was confusing and kept
// references to the legacy endpoint alive. Kept as an empty module so the
// import graph remains stable while preventing accidental restoration.
export {};
