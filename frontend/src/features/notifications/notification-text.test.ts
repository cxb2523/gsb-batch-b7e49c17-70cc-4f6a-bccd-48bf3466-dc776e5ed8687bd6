import { describe, it, expect } from 'vitest';
import { describeNotification } from './notification-text';
import type { Notification } from './schemas';

function notification(kind: string, data: Record<string, unknown>): Notification {
  return {
    id: 'n1',
    kind,
    workspaceId: 'w1',
    data,
    readAt: null,
    createdAt: '2026-10-28T10:00:00.000Z',
  };
}

describe('describeNotification', () => {
  it('says who joined and sends an administrator to where access is granted', () => {
    const view = describeNotification(
      notification('invitation_accepted', {
        workspaceName: 'Acme',
        personName: 'Ivy',
        projectsWaiting: 2,
      }),
    );

    expect(view.text).toBe('Ivy joined Acme. 2 projects are waiting for you to grant access.');
    expect(view.href).toBe('/w/w1/management');
  });

  it('uses the singular for one project, and says nothing about access when none wait', () => {
    expect(
      describeNotification(
        notification('invitation_accepted', {
          workspaceName: 'Acme',
          personName: 'Ivy',
          projectsWaiting: 1,
        }),
      ).text,
    ).toBe('Ivy joined Acme. 1 project is waiting for you to grant access.');

    expect(
      describeNotification(
        notification('invitation_accepted', {
          workspaceName: 'Acme',
          personName: 'Ivy',
          projectsWaiting: 0,
        }),
      ).text,
    ).toBe('Ivy joined Acme.');
  });

  it('tells a person they can open a project, and links to it', () => {
    const view = describeNotification(
      notification('access_granted', {
        workspaceName: 'Acme',
        projectId: 'p1',
        projectName: 'Roadmap',
      }),
    );

    expect(view.text).toBe('You now have access to Roadmap in Acme.');
    expect(view.href).toBe('/w/w1?project=p1');
  });

  it('tells a person their new role', () => {
    const view = describeNotification(
      notification('role_changed', { workspaceName: 'Acme', role: 'viewer' }),
    );

    expect(view.text).toBe('Your role in Acme is now viewer.');
    expect(view.href).toBe('/w/w1');
  });

  it('tells a person their new role in one project, calling admin the project admin', () => {
    const details = { workspaceName: 'Acme', projectId: 'p1', projectName: 'Roadmap' };

    const admin = describeNotification(
      notification('project_role_changed', { ...details, role: 'admin' }),
    );
    const viewer = describeNotification(
      notification('project_role_changed', { ...details, role: 'viewer' }),
    );

    expect(admin.text).toBe('Your role in Roadmap (Acme) is now project admin.');
    expect(admin.href).toBe('/w/w1?project=p1');
    expect(viewer.text).toBe('Your role in Roadmap (Acme) is now viewer.');
  });

  it('tells a person they were removed from a project, and sends them to the workspace they are still in', () => {
    const view = describeNotification(
      notification('removed_from_project', { workspaceName: 'Acme', projectName: 'Roadmap' }),
    );

    expect(view).toEqual({ text: 'You were removed from Roadmap in Acme.', href: '/w/w1' });
  });

  it('tells a removed person, with nowhere to go', () => {
    const view = describeNotification(
      notification('removed_from_workspace', { workspaceName: 'Acme' }),
    );

    expect(view).toEqual({ text: 'You were removed from Acme.', href: null });
  });

  it.each([
    'invitation_accepted',
    'access_granted',
    'role_changed',
    'project_role_changed',
    'removed_from_project',
  ])('falls back to a plain sentence when the details of %s are not what was expected', (kind) => {
    const view = describeNotification(notification(kind, { workspaceName: 42 }));

    expect(view).toEqual({
      text: 'Something changed in one of your workspaces.',
      href: '/w/w1',
    });
  });

  it('does not link a removal whose details are missing', () => {
    expect(describeNotification(notification('removed_from_workspace', {})).href).toBeNull();
  });

  it('shows a kind this version does not know as a plain sentence', () => {
    expect(describeNotification(notification('something_new', {}))).toEqual({
      text: 'Something changed in one of your workspaces.',
      href: '/w/w1',
    });
  });
});
