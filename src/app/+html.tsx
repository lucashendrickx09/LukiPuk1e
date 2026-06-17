import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Web-only document shell (ignored on native). This is what makes the PWA feel
// like a real iOS app: viewport-fit=cover enables safe-area insets under the
// notch / Dynamic Island and home indicator, the apple-mobile-web-app meta puts
// it in full-screen standalone mode with a translucent status bar, and the
// manifest + apple-touch-icon give it a proper home-screen icon.
//
// Asset paths are prefixed with the build-time base URL so they resolve both
// locally (root) and on the GitHub project page (/LukiPuk1e/).
const BASE = process.env.STOCKPILE_BASE_URL ?? '';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover"
        />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Stockpile" />
        <meta name="theme-color" content="#0B0F14" />
        <title>Stockpile</title>
        <link rel="apple-touch-icon" href={`${BASE}/app-icon.png`} />
        <link rel="icon" href={`${BASE}/app-icon.png`} />
        <link rel="manifest" href={`${BASE}/manifest.json`} />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: globalCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const globalCss = `
html, body, #root { background-color: #0B0F14; }
body {
  overscroll-behavior-y: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
/* Fill the safe-area regions (notch, home indicator) with the app background
   instead of white when launched standalone. */
@supports (padding: max(0px)) {
  body { background-color: #0B0F14; }
}
`;
