import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProfileSectionCard } from './ProfileSectionCard';

describe('ProfileSectionCard', () => {
  it('renders the anchor id, title, badge and content', () => {
    const { container } = render(
      <ProfileSectionCard id="privacy" title="Data" icon={<span />} badge={<em>BADGE</em>}>
        <p>Body</p>
      </ProfileSectionCard>,
    );

    expect(container.querySelector('#privacy')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Data' })).toBeInTheDocument();
    expect(screen.getByText('BADGE')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});
