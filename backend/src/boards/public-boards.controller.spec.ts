import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicBoardsController } from './public-boards.controller.js';

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

    const resMock = {
      setHeader: vi.fn(),
      end: vi.fn(),
    } as any;

    await controller.getPublicPayload('share-token-123', resMock);

    expect(serviceMock.getPublicPayload).toHaveBeenCalledWith('share-token-123');
    expect(resMock.setHeader).toHaveBeenCalledWith('x-board-revision', '3');
    expect(resMock.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
    expect(resMock.setHeader).toHaveBeenCalledWith('Content-Length', mockBuffer.length);
    expect(resMock.end).toHaveBeenCalledWith(mockBuffer);
  });
});
