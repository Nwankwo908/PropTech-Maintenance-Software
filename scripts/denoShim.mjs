if (!globalThis.Deno) globalThis.Deno = { env: { get: (k) => process.env[k] } }
