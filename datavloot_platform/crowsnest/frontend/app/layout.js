import './globals.css';

export const metadata = {
  title: "Crows Nest",
  description: 'The datavloot data platform at a glance: pipelines, data quality, SQL and notebooks',
  icons: { icon: '/datavloot-logo.png' },
};

// Applies the branding colours remembered by app/page.js before the first paint.
const applyRememberedBranding = `
  try {
    var v = JSON.parse(localStorage.getItem('cn-branding') || '{}');
    for (var k in v) document.documentElement.style.setProperty(k, v[k]);
  } catch (e) {}
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyRememberedBranding }} />
      </head>
      <body className="min-h-screen bg-surface-1">
        {children}
      </body>
    </html>
  );
}
