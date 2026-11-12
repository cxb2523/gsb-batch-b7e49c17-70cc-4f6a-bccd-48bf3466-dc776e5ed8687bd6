import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FeedbackBanner } from './FeedbackBanner';

describe('FeedbackBanner', () => {
  it('renders nothing without feedback', () => {
    const { container } = render(<FeedbackBanner feedback={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces errors as alerts and successes as status', () => {
    const { rerender } = render(<FeedbackBanner feedback={{ tone: 'error', message: 'Broke' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Broke');

    rerender(<FeedbackBanner feedback={{ tone: 'success', message: 'Done' }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Done');
  });
});
