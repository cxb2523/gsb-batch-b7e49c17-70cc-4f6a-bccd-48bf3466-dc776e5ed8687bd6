import {
  Catch,
  type ExceptionFilter,
  type ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

const PRISMA_ERROR_MAP: Record<string, { status: number; error: string; message: string }> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'Resource already exists',
  },
  P2003: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'Operation conflicts with a related resource',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    error: 'Not Found',
    message: 'Resource not found',
  },
  P2034: {
    status: HttpStatus.CONFLICT,
    error: 'Conflict',
    message: 'Transaction conflict, please retry',
  },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (res.headersSent) {
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload =
        typeof body === 'string'
          ? {
              statusCode: status,
              message: body,
              error: HttpStatus[status] ?? 'Error',
            }
          : body;
      res.status(status).json(payload);
      return;
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      // A NUL character in an id or a text field is something the client sent, not a server fault.
      // PostgreSQL refuses it with a driver-level error that carries no Prisma code of its own.
      if (exception.message.includes('invalid byte sequence for encoding')) {
        res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'The request contains a character that is not allowed',
          error: 'Bad Request',
        });
        return;
      }
      const mapped = PRISMA_ERROR_MAP[exception.code];
      if (mapped) {
        this.logger.warn(
          JSON.stringify({
            event: 'prisma_known_error',
            code: exception.code,
            status: mapped.status,
            method: req?.method,
            path: req?.originalUrl ?? req?.url,
          }),
        );
        res.status(mapped.status).json({
          statusCode: mapped.status,
          message: mapped.message,
          error: mapped.error,
        });
        return;
      }
    }

    const errName = exception instanceof Error ? exception.name : typeof exception;
    const errMessage = exception instanceof Error ? exception.message : String(exception);
    this.logger.error(
      JSON.stringify({
        event: 'unhandled_exception',
        name: errName,
        message: errMessage,
        stack: exception instanceof Error ? exception.stack : undefined,
        method: req?.method,
        path: req?.originalUrl ?? req?.url,
      }),
    );

    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  }
}
