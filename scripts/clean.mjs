import { rmSync } from 'node:fs'

// Clear build output before emitting. Without this, a file that is deleted from
// src/ — or newly excluded from the build, as the tests now are — would linger
// in dist/ and still ship in the packaged module.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true })
