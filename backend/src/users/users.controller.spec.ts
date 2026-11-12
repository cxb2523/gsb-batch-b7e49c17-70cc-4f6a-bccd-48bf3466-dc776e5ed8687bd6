import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsersController } from './users.controller.js';

describe('UsersController', () => {
  let controller: UsersController;
  let usersServiceMock: any;
  let configServiceMock: any;

  beforeEach(() => {
    usersServiceMock = {
      getEncryptionParams: vi.fn(),
      setupEncryption: vi.fn(),
      rotatePassphrase: vi.fn(),
      getPublicKey: vi.fn(),
      updateProfile: vi.fn(),
      getAccounts: vi.fn(),
      unlinkAccount: vi.fn(),
      getOwnedWorkspaces: vi.fn(),
      getUserMetrics: vi.fn(),
      exportUserData: vi.fn(),
      deleteAccount: vi.fn(),
    };
    configServiceMock = {
      get: vi.fn(() => 'development'),
    };
    controller = new UsersController(usersServiceMock, configServiceMock);
  });

  describe('getEncryptionParams', () => {
    it('passes caller user id to usersService.getEncryptionParams', async () => {
      const req: any = { user: { id: 'u1' } };
      const mockParams = {
        hasEncryption: true,
        salt: 'salt-123',
        iterations: 100000,
        encryptedPrivateKey: 'enc-priv-key',
      };
      usersServiceMock.getEncryptionParams.mockResolvedValue(mockParams);

      const result = await controller.getEncryptionParams(req.user);

      expect(result).toEqual(mockParams);
      expect(usersServiceMock.getEncryptionParams).toHaveBeenCalledWith('u1');
    });
  });

  describe('setupEncryption', () => {
    it('passes user id and setup body to usersService.setupEncryption', async () => {
      const req: any = { user: { id: 'u1' } };
      const body = {
        publicKey: 'pub-key-1',
        encryptedPrivateKey: 'enc-priv-key-1',
        salt: 'salt-xyz',
        iterations: 100000,
      };
      usersServiceMock.setupEncryption.mockResolvedValue({ success: true });

      const result = await controller.setupEncryption(req.user, body as any);

      expect(result).toEqual({ success: true });
      expect(usersServiceMock.setupEncryption).toHaveBeenCalledWith('u1', body);
    });
  });

  describe('rotatePassphrase', () => {
    it('passes user id and rotation payload to usersService.rotatePassphrase', async () => {
      const req: any = { user: { id: 'u1' } };
      const body = {
        encryptedPrivateKey: 'new-enc-priv-key',
        salt: 'new-salt',
        iterations: 150000,
      };
      usersServiceMock.rotatePassphrase.mockResolvedValue({ success: true });

      const result = await controller.rotatePassphrase(req.user, body as any);

      expect(result).toEqual({ success: true });
      expect(usersServiceMock.rotatePassphrase).toHaveBeenCalledWith('u1', body);
    });
  });

  describe('getPublicKey', () => {
    it('passes target user id to usersService.getPublicKey without requiring session', async () => {
      usersServiceMock.getPublicKey.mockResolvedValue({ publicKey: 'target-pub-key' });

      const result = await controller.getPublicKey(
        { id: 'requester', name: 'Requester', email: 'requester@local.com' },
        'user-target-id',
      );

      expect(result).toEqual({ publicKey: 'target-pub-key' });
      expect(usersServiceMock.getPublicKey).toHaveBeenCalledWith('user-target-id', 'requester');
    });
  });

  describe('updateProfile', () => {
    it('updates name and image via usersService.updateProfile', async () => {
      const req: any = { user: { id: 'u1' } };
      const body = {
        name: 'Jane Doe',
        image: 'https://example.com/avatar.png',
      };
      const updatedUser = { id: 'u1', name: 'Jane Doe', image: 'https://example.com/avatar.png' };
      usersServiceMock.updateProfile.mockResolvedValue(updatedUser);

      const result = await controller.updateProfile(req.user, body);

      expect(result).toEqual(updatedUser);
      expect(usersServiceMock.updateProfile).toHaveBeenCalledWith('u1', body);
    });
  });

  describe('getAccounts and unlinkAccount', () => {
    it('getAccounts passes user id to usersService.getAccounts', async () => {
      const req: any = { user: { id: 'u1' } };
      const mockAccounts = [{ id: 'acc-1', providerId: 'google' }];
      usersServiceMock.getAccounts.mockResolvedValue(mockAccounts);

      const result = await controller.getAccounts(req.user);

      expect(result).toEqual(mockAccounts);
      expect(usersServiceMock.getAccounts).toHaveBeenCalledWith('u1');
    });

    it('unlinkAccount passes user id and providerId to usersService.unlinkAccount', async () => {
      const req: any = { user: { id: 'u1' } };
      usersServiceMock.unlinkAccount.mockResolvedValue({ success: true });

      const result = await controller.unlinkAccount(req.user, 'github');

      expect(result).toEqual({ success: true });
      expect(usersServiceMock.unlinkAccount).toHaveBeenCalledWith('u1', 'github');
    });
  });

  describe('getOwnedWorkspaces & getUserMetrics', () => {
    it('getOwnedWorkspaces passes user id to usersService.getOwnedWorkspaces', async () => {
      const req: any = { user: { id: 'u1' } };
      const mockWorkspaces = [{ id: 'ws-1', name: 'Personal' }];
      usersServiceMock.getOwnedWorkspaces.mockResolvedValue(mockWorkspaces);

      const result = await controller.getOwnedWorkspaces(req.user);

      expect(result).toEqual(mockWorkspaces);
      expect(usersServiceMock.getOwnedWorkspaces).toHaveBeenCalledWith('u1');
    });

    it('getUserMetrics passes user id to usersService.getUserMetrics', async () => {
      const req: any = { user: { id: 'u1' } };
      const mockMetrics = { workspaceCount: 2, boardCount: 10 };
      usersServiceMock.getUserMetrics.mockResolvedValue(mockMetrics);

      const result = await controller.getUserMetrics(req.user);

      expect(result).toEqual(mockMetrics);
      expect(usersServiceMock.getUserMetrics).toHaveBeenCalledWith('u1');
    });
  });

  describe('exportData', () => {
    it('calls exportUserData, sets attachment headers, and streams formatted JSON', async () => {
      const req: any = { user: { id: 'u1' } };
      const res: any = {
        setHeader: vi.fn(),
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      };
      const exportBundle = { user: { id: 'u1', email: 'user@example.com' }, workspaces: [] };
      usersServiceMock.exportUserData.mockResolvedValue(exportBundle);

      await controller.exportData(req.user, res);

      expect(usersServiceMock.exportUserData).toHaveBeenCalledWith('u1');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringMatching(
          /^attachment; filename="canvhq-data-export-u1-\d{4}-\d{2}-\d{2}\.json"$/,
        ),
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(JSON.stringify(exportBundle, null, 2));
    });
  });

  describe('deleteAccount', () => {
    it('passes confirmation password and user id, clears session cookies, and returns 200', async () => {
      const req: any = { user: { id: 'u1' } };
      const res: any = {
        clearCookie: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const body = { confirmSoleDeletion: true };
      const deleteResult = { success: true, message: 'Account permanently erased' };
      usersServiceMock.deleteAccount.mockResolvedValue(deleteResult);

      await controller.deleteAccount(req.user, res, body);

      expect(usersServiceMock.deleteAccount).toHaveBeenCalledWith('u1', body);
      expect(res.clearCookie).toHaveBeenCalledWith('better-auth.session_token', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
      });
      expect(res.clearCookie).toHaveBeenCalledWith('__Secure-better-auth.session_token', {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(deleteResult);
    });
  });
});
