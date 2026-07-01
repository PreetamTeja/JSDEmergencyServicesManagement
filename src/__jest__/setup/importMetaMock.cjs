// babel-plugin-transform-import-meta rewrites `import.meta.env.*` to
// `process.env.*`, so we set the env vars here for test runs.
process.env.VITE_API_URL = ''
process.env.VITE_VOICE_URL = ''
process.env.VITE_POWERBI_SECURE = 'false'
process.env.VITE_POWERBI_EMBED_URL = ''
