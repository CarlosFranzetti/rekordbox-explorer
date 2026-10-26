/**
 * Just enough of a React test harness to mount a component and look at the DOM.
 *
 * @testing-library/react is deliberately not a dependency. This is the small part
 * of it the component tests here actually use: mount, flush effects, clean up.
 */
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';

// Without this React warns that state updates are not wrapped in act().
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

export function render(ui: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  // act() also runs the effects, so state set in useEffect (useIsMobile, for
  // one) has landed by the time this returns.
  act(() => {
    root.render(ui);
  });
  mounted.push({ root, container });
  return { container };
}

export function cleanup() {
  for (const { root, container } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
}
