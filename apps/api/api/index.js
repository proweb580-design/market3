// Vercel Function entry. The app is compiled to ../dist by `nest build` (see vercel.json); this file only forwards to it.
// The import is dynamic on purpose: if loading the compiled app fails (missing module, bad build), the reason is
// logged and returned instead of the function dying with an opaque FUNCTION_INVOCATION_FAILED.
export default async function handler(req, res) {
  let app;
  try {
    app = await import('../dist/serverless.js');
  } catch (error) {
    console.error('API failed to load:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ statusCode: 500, message: 'API failed to load', detail: `${error?.code ?? error?.name}: ${String(error?.message).split('\n')[0].slice(0, 300)}` }));
    return;
  }
  return app.default(req, res);
}
