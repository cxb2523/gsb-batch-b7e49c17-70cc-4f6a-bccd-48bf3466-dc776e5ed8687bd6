import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Response } from 'express';
import { PublicBoardsController } from './public-boards.controller.js';

/** The controller only touches these two members of the Express response. */
function responseStub(): Pick<Response, 'setHeader' | 'end'> {
  return { setHeader: vi.fn(), end: vi.fn() };
}

describe('PublicBoardsController', () => {
  let controller: PublicBoardsController;
  let serviceMock: any;

  beforeEach(() => {
    serviceMock = {
      getPublicBoard: vi.fn(),
      getPublicPayload: vi.fn(),
      getPublicFile: vi.fn(),
    };
    controller = new PublicBoardsController(serviceMock);
  });

  it('getPublicBoard delegates to service without requiring auth', async () => {
    const mockBoard = { id: 'b1', title: 'System Architecture', isPublic: true };
    serviceMock.getPublicBoard.mockResolvedValue(mockBoard);

    const result = await controller.getPublicBoard('share-token-123');
    expect(serviceMock.getPublicBoard).toHaveBeenCalledWith('share-token-123');
    expect(result).toEqual(mockBoard);
  });

  it('getPublicPayload sets octet-stream and revision headers and streams buffer', async () => {
    const mockBuffer = Buffer.from('encrypted-data');
    serviceMock.getPublicPayload.mockResolvedValue({ buffer: mockBuffer, revision: 3 });

    const resMock = responseStub();

    await controller.getPublicPayload('share-token-123', resMock as Response);

    expect(serviceMock.getPublicPayload).toHaveBeenCalledWith('share-token-123');
    expect(vi.mocked(resMock.setHeader)).toHaveBeenCalledWith('x-board-revision', '3');
    expect(vi.mocked(resMock.setHeader)).toHaveBeenCalledWith(
      'Content-Type',
      'application/octet-stream',
    );
    expect(vi.mocked(resMock.setHeader)).toHaveBeenCalledWith('Content-Length', mockBuffer.length);
    expect(vi.mocked(resMock.end)).toHaveBeenCalledWith(mockBuffer);
  });

  it('rejects a malformed token on every public route before calling the service', async () => {
    const res = responseStub() as Response;

    await expect(controller.getPublicBoard('not a token!')).rejects.toThrow(
      'Invalid share token format',
    );
    await expect(controller.getPublicPayload('not a token!', res)).rejects.toThrow(
      'Invalid share token format',
    );
    await expect(controller.getPublicFile('not a token!', 'f1', res)).rejects.toThrow(
      'Invalid share token format',
    );

    expect(serviceMock.getPublicBoard).not.toHaveBeenCalled();
    expect(serviceMock.getPublicPayload).not.toHaveBeenCalled();
    expect(serviceMock.getPublicFile).not.toHaveBeenCalled();
  });
});
