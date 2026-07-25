import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Web-only document shell (ignored on native). Makes the PWA feel native:
// viewport-fit=cover enables safe-area insets, the apple meta runs it full-screen
// standalone, and a service worker (registered below) powers real on-device
// notifications. Asset/SW paths use the build-time base URL so they resolve both
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
        <script dangerouslySetInnerHTML={{ __html: bootScript(BASE) }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

// height:100% on the root chain makes the RN root view fill the viewport so the
// tab bar anchors to the bottom edge (no empty bar below it).
const globalCss = `
html, body, #root { height: 100%; background-color: #0B0F14; }
#root { display: flex; flex-direction: column; }
body {
  overscroll-behavior-y: none;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}

/* Make it behave like an app, not a web page.
   Without these, iOS Safari hijacks a long press on any image with its native
   callout menu (Share / Save to Photos / Copy), which stole the drag gesture on
   the catalog tiles. Text selection and native image dragging are suppressed
   for the same reason; inputs opt back in below. */
* {
  -webkit-touch-callout: none;
}
body, #root {
  -webkit-user-select: none;
  user-select: none;
}
img {
  -webkit-user-drag: none;
  user-drag: none;
  -webkit-touch-callout: none;
}
input, textarea, [contenteditable="true"] {
  -webkit-user-select: auto;
  user-select: auto;
  -webkit-touch-callout: default;
}

/* Draggable grid tiles: the touch must reach the tile view, never the <img>,
   and the tile itself must not be text-selectable mid-drag. */
[data-tile="true"] {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
[data-tile="true"] img {
  pointer-events: none;
}
`;

// Exposes the base path to runtime code and registers the notification SW.
function bootScript(base: string): string {
  return `
window.__STOCKPILE_BASE__ = ${JSON.stringify(base)};
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register(${JSON.stringify(base + '/sw.js')}, { scope: ${JSON.stringify(base + '/')} }).catch(function () {});
  });
}
`;
}
