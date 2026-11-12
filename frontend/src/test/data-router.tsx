import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

const ChildrenContext = createContext<ReactNode>(null);

function CurrentChildren() {
  return useContext(ChildrenContext);
}

/**
 * A data router around whatever is rendered, as the application has: navigation blockers only
 * work under one. The children are handed in through context, so a re-render with new children
 * (a hook test's rerender) reaches the route instead of staying frozen at the first ones.
 */
export function DataRouter({ children, route = '/' }: { children: ReactNode; route?: string }) {
  const router = useMemo(
    () =>
      createMemoryRouter([{ path: '*', element: <CurrentChildren /> }], {
        initialEntries: [route],
      }),
    [route],
  );
  return (
    <ChildrenContext.Provider value={children}>
      <RouterProvider router={router} />
    </ChildrenContext.Provider>
  );
}
