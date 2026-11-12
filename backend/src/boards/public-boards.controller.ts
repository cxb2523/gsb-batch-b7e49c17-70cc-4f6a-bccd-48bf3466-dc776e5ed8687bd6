import { Controller, Get, Param, Res, BadRequestException } from '@nestjs/common';
import { BoardsService } from './boards.service.js';
import type { Response } from 'express';
import { Public } from '../access/decorators.js';
import { isPublicShareTokenFormat } from './public-share-token.js';

const FILE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

@Public()
@Controller('api/public/boards')
export class PublicBoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Get(':token')
  async getPublicBoard(@Param('token') token: string) {
    this.requireValidToken(token);
    return this.boardsService.getPublicBoard(token);
  }

  @Get(':token/payload')
  async getPublicPayload(@Param('token') token: string, @Res() res: Response) {
    this.requireValidToken(token);
    const { buffer, revision } = await this.boardsService.getPublicPayload(token);
    res.setHeader('x-board-revision', String(revision));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get(':token/files/:fileId')
  async getPublicFile(
    @Param('token') token: string,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    this.requireValidToken(token);
    if (!fileId || !FILE_ID_REGEX.test(fileId)) {
      throw new BadRequestException('Invalid file ID format');
    }

    const buffer = await this.boardsService.getPublicFile(token, fileId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  /** Reject a token that could never have been issued before it reaches the lookup. */
  private requireValidToken(token: string): void {
    if (!isPublicShareTokenFormat(token)) {
      throw new BadRequestException('Invalid share token format');
    }
  }
}
