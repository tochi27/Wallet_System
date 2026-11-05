interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_CURRENCY?: string
  // The live demo site: shows the shared demo login and the "don't upload a real ID" notice
  readonly VITE_DEMO_MODE?: string
  readonly VITE_DEMO_EMAIL?: string
  readonly VITE_DEMO_PASSWORD?: string
  readonly VITE_DEMO_PIN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
