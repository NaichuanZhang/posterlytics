// Registers the test-only TS-extension resolver hook on the loader thread.
import { register } from 'node:module'
register('./ts-resolve.mjs', import.meta.url)
