import './bootstrap';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import App from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './index.css';

// A data router, because the canvas has to hold back navigation while changes are unsaved. The
// application keeps its own <Routes>, under one catch-all route. A data router shows its own error
// screen for a render error below a route, so the app's boundary sits inside the route.
const router = createBrowserRouter([
  {
    path: '*',
    element: (
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    ),
  },
]);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
