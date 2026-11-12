import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Headers,
  Query,
  Req,
  Res,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { BoardsService } from './boards.service.js';
import { Throttle } from '@nestjs/throttler';
import { CreateBoardDto, UpdateBoardDto } from './dto/board.dto.js';
import { PaginationQuerySchema } from '../common/dto/pagination.dto.js';
import { Access, CurrentAccess } from '../access/decorators.js';
import type { Access as AccessContext } from '../access/access.types.js';
import type { Request, Response } from 'express';

const MAX_PAYLOAD_BYTES = 15 * 1024 * 1024; // 15MB
const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB
const FILE_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Reads an uploaded body into one buffer, refusing it as soon as it passes `maxBytes`. The upload
 * is binary, so no body parser consumes the stream: it is read here, and what comes out is always
 * a real Buffer, never a value taken from `req.body`.
 */
async function readBody(req: Request, maxBytes: number, tooLargeMessage: string): Promise<Buffer> {
  let totalBytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += piece.length;
    if (totalBytes > maxBytes) {
      throw new PayloadTooLargeException(tooLargeMessage);
    }
    chunks.push(piece);
  }
  return Buffer.concat(chunks, totalBytes);
}

@Controller('api/boards')
export class BoardsController {
  constructor(private readonly boardsService: BoardsService) {}

  @Post()
  @Access({ scope: 'project', from: 'body', param: 'projectId', can: ['create', 'Board'] })
  async create(@CurrentAccess() access: AccessContext, @Body() body: CreateBoardDto) {
    return this.boardsService.create(
      access,
      body.id,
      body.title,
      body.encryptedBoardKey,
      body.projectKeyVersion,
    );
  }

  @Get()
  @Access({ scope: 'workspace' })
  async findAll(
    @CurrentAccess() access: AccessContext,
    @Query('projectId') projectId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort') sort?: string,
  ) {
    const pagination = PaginationQuerySchema.parse({ page, limit });
    return this.boardsService.findAll(access, {
      pagination,
      ...(projectId ? { projectId } : {}),
      ...(search ? { search } : {}),
      ...(sort ? { sort } : {}),
    });
  }

  @Get(':id')
  @Access({ scope: 'board', can: ['read', 'Board'] })
  async findOne(@CurrentAccess() access: AccessContext) {
    return this.boardsService.findOne(access);
  }

  @Get(':id/payload')
  @Access({ scope: 'board', can: ['read', 'Board'] })
  async getPayload(@CurrentAccess() access: AccessContext, @Res() res: Response) {
    const { buffer, revision } = await this.boardsService.getPayload(access);
    res.setHeader('x-board-revision', String(revision));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Post(':id/public-share')
  @Access({ scope: 'board', can: ['share', 'Board'] })
  async enablePublicShare(@CurrentAccess() access: AccessContext) {
    return this.boardsService.enablePublicShare(access);
  }

  @Delete(':id/public-share')
  @Access({ scope: 'board', can: ['share', 'Board'] })
  async disablePublicShare(@CurrentAccess() access: AccessContext) {
    return this.boardsService.disablePublicShare(access);
  }

  @Post(':id/public-share/rotate')
  @Access({ scope: 'board', can: ['share', 'Board'] })
  async rotatePublicShareToken(@CurrentAccess() access: AccessContext) {
    return this.boardsService.rotatePublicShareToken(access);
  }

  @Put(':id/payload')
  @Access({ scope: 'board', can: ['update', 'Board'] })
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  async savePayload(
    @CurrentAccess() access: AccessContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('x-board-revision') revisionHeader?: string,
    @Headers('x-board-file-ids') fileIdsHeader?: string,
    @Headers('x-encrypted-board-key') encryptedBoardKey?: string,
  ) {
    const buffer = await readBody(
      req,
      MAX_PAYLOAD_BYTES,
      'Diagram payload exceeds maximum allowable size (15MB)',
    );

    if (
      revisionHeader === undefined ||
      revisionHeader === null ||
      !/^\d+$/.test(revisionHeader.trim())
    ) {
      throw new BadRequestException('Missing or invalid x-board-revision header');
    }
    const clientRevision = parseInt(revisionHeader.trim(), 10);

    let fileIds: string[] | undefined;
    if (fileIdsHeader !== undefined) {
      const parsed = fileIdsHeader
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      if (parsed.length > 100) {
        throw new BadRequestException('A canvas may reference at most 100 files');
      }
      for (const id of parsed) {
        if (!FILE_ID_REGEX.test(id)) {
          throw new BadRequestException('Invalid file ID format');
        }
      }
      fileIds = parsed;
    }

    if (buffer.length === 0) {
      throw new BadRequestException('Empty encrypted payload');
    }

    // Minimum length is 1 + 4 + 4 + 12 + 16 = 37 bytes
    if (buffer[0] !== 0x01 || buffer.length < 37) {
      throw new BadRequestException(
        'Encrypted payload must use the v1 board-payload format (format byte 0x01)',
      );
    }

    const updated = await this.boardsService.savePayload(
      access,
      buffer,
      clientRevision,
      encryptedBoardKey,
      fileIds,
    );
    res.setHeader('x-board-revision', String(updated.revision));
    return {
      success: true,
      hasPayload: updated.hasPayload,
      revision: updated.revision,
      updatedAt: updated.updatedAt,
    };
  }

  @Put(':id/files/:fileId')
  @Access({ scope: 'board', can: ['update', 'Board'] })
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  async saveFile(
    @CurrentAccess() access: AccessContext,
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ) {
    if (!fileId || !FILE_ID_REGEX.test(fileId)) {
      throw new BadRequestException('Invalid file ID format');
    }

    const buffer = await readBody(req, MAX_FILE_BYTES, 'File exceeds 8MB limit');

    // Validate v1 file header: length >= 33 bytes (1 format + 4 keyVersion + 12 IV + 16 tag), byte 0 === 0x01
    if (buffer.length < 33 || buffer[0] !== 0x01) {
      throw new BadRequestException('Invalid file envelope format (format byte 0x01)');
    }

    return this.boardsService.saveFile(access, fileId, buffer);
  }

  @Get(':id/files/:fileId')
  @Access({ scope: 'board', can: ['read', 'Board'] })
  async getFile(
    @CurrentAccess() access: AccessContext,
    @Param('fileId') fileId: string,
    @Res() res: Response,
  ) {
    if (!fileId || !FILE_ID_REGEX.test(fileId)) {
      throw new BadRequestException('Invalid file ID format');
    }

    const buffer = await this.boardsService.getFile(access, fileId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Patch(':id')
  @Access({ scope: 'board', can: ['update', 'Board'] })
  async update(@CurrentAccess() access: AccessContext, @Body() body: UpdateBoardDto) {
    return this.boardsService.update(access, body);
  }

  @Delete(':id')
  @Access({ scope: 'board', can: ['delete', 'Board'] })
  async delete(@CurrentAccess() access: AccessContext) {
    return this.boardsService.delete(access);
  }
}
