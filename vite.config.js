export default {
  server: {
    // Bind IPv4 explicitly. Vite's default `localhost` resolves to ::1 first on
    // macOS, so the dev server listens on [::1] only while the harness probes
    // and navigates 127.0.0.1 — the port never opens from its point of view and
    // every capture dies with "vite failed to start". Pinning the host makes
    // the bind, the probe and the navigation agree.
    host: '127.0.0.1',

    // Capture/profile runs set OW_NO_HMR=1. HMR injects a websocket client and
    // can re-execute modules mid-capture, which is a determinism hazard.
    hmr: process.env.OW_NO_HMR ? false : undefined,
  },
  build: { target: 'es2022' },
};
