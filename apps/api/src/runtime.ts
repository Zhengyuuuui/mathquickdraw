// Runtime shims so the same source runs on Cloudflare Workers and on Node.
//
// Imported first by index.ts, before any other module body, so the globals
// exist by the time they are referenced. Everything here is a no-op where the
// platform already provides the API — Workers and Node 19+ never enter a
// branch.
//
// Why this file exists at all: the Worker was originally written for the
// Workers runtime, which always has Web Crypto on globalThis. Node 18 — what
// the self-hosted deployment was running — exposes webcrypto only on
// `node:crypto` and has no global `crypto`, so every HMAC call threw.

const g = globalThis as { crypto?: Crypto }

if (!g.crypto?.subtle) {
  // The specifier is held in a variable so bundlers leave the import alone:
  // on Workers this branch is never taken, and a statically-analysable
  // `import('node:crypto')` would make the Workers build try to resolve a
  // Node built-in it has no business knowing about.
  const specifier = 'node:crypto'
  const nodeCrypto = (await import(/* @vite-ignore */ specifier)) as {
    webcrypto?: Crypto
  }
  if (!nodeCrypto.webcrypto) {
    throw new Error(
      'This runtime has no Web Crypto. Use Node.js 20+ or Cloudflare Workers.',
    )
  }
  g.crypto = nodeCrypto.webcrypto
}

// Marks this as a module so the top-level await above is legal.
export {}
