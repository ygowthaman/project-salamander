import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
// Montserrat, self-hosted rather than pulled from fonts.googleapis.com: the files
// ship in the bundle, so there is no third-party request on first paint and no
// flash of fallback text while it resolves. Only the weights the app actually
// asks for — 400 body, 500/600 the Text `fw` values, 700 Mantine's headings.
// Adding a new `fw` means adding its file here or the browser will synthesise it.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/600.css'
import '@fontsource/montserrat/700.css'
// Lexend Giga, the wordmark's face and nothing else's — one weight, because the
// header uses it at exactly one size. Applied in `AppHeader.module.css`, not in
// `theme.ts`: it is a logotype, not a second body font.
import '@fontsource/lexend-giga/700.css'
import '@mantine/core/styles.css'
import './index.css'
import App from './App.tsx'
import { theme } from './theme.ts'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <App />
    </MantineProvider>
  </StrictMode>,
)
