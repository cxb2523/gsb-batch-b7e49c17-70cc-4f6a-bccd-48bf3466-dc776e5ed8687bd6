import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  type ArgumentsHost,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function first<T>(items: readonly T[]): T {
  const [head] = items;
  if (head === undefined) {
    throw new Error('expected at least one item');
  }
  return head;
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let statusMock: ReturnType<typeof vi.fn>;
  let jsonMock: ReturnType<typeof vi.fn>;
  let hostMock: ArgumentsHost;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jsonMock = vi.fn();
    statusMock = vi.fn().mockReturnValue({ json: jsonMock });
    hostMock = {
      switchToHttp: () => ({
        getResponse: () => ({
          headersSent: false,
          status: statusMock,
        }),
        getRequest: () => ({
          method: 'POST',
          originalUrl: '/api/test',
        }),
      }),
    } as unknown as ArgumentsHost;
  });

  it('preserves status and response body for Nest HttpException instances', () => {
    const exception = new NotFoundException('Board not found');
    filter.catch(exception, hostMock);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'Board not found',
      error: 'Not Found',
    });
  });

  it('wraps string HttpException responses into standard statusCode/message/error shape', () => {
    const exception = new HttpException('Custom forbidden text', HttpStatus.FORBIDDEN);
    filter.catch(exception, hostMock);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 403,
      message: 'Custom forbidden text',
      error: 'FORBIDDEN',
    });
  });

  it('preserves structured validation payload on BadRequestException', () => {
    const exception = new BadRequestException({
      statusCode: 400,
      message: ['email must be valid'],
      error: 'Bad Request',
    });
    filter.catch(exception, hostMock);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['email must be valid'],
      error: 'Bad Request',
    });
  });

  it.each([
    {
      code: 'P2002',
      expectedStatus: 409,
      expectedError: 'Conflict',
      expectedMessage: 'Resource already exists',
    },
    {
      code: 'P2003',
      expectedStatus: 409,
      expectedError: 'Conflict',
      expectedMessage: 'Operation conflicts with a related resource',
    },
    {
      code: 'P2025',
      expectedStatus: 404,
      expectedError: 'Not Found',
      expectedMessage: 'Resource not found',
    },
    {
      code: 'P2034',
      expectedStatus: 409,
      expectedError: 'Conflict',
      expectedMessage: 'Transaction conflict, please retry',
    },
  ])(
    'maps Prisma $code to HTTP $expectedStatus without leaking internal metadata',
    ({ code, expectedStatus, expectedError, expectedMessage }) => {
      const prismaErr = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (`organizationId`,`userId`)',
        { code, clientVersion: '7.10.0', meta: { target: ['organizationId', 'userId'] } },
      );

      filter.catch(prismaErr, hostMock);

      expect(statusMock).toHaveBeenCalledWith(expectedStatus);
      expect(jsonMock).toHaveBeenCalledWith({
        statusCode: expectedStatus,
        message: expectedMessage,
        error: expectedError,
      });
    },
  );

  it('maps unknown Prisma error codes and generic Errors to an opaque 500 with one structured log line', () => {
    const errorLogSpy = vi.spyOn(
      (filter as unknown as { logger: { error: () => void } }).logger,
      'error',
    );
    const secretError = new Error('Connection string postgresql://user:secret@db:5432 failed');

    filter.catch(secretError, hostMock);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
    expect(JSON.stringify(first(jsonMock.mock.calls).at(0))).not.toContain('secret');
    expect(errorLogSpy).toHaveBeenCalledTimes(1);
  });

  it('does not write to the response if headers have already been sent (e.g. Better Auth raw handler)', () => {
    const alreadySentHost = {
      switchToHttp: () => ({
        getResponse: () => ({
          headersSent: true,
          status: statusMock,
        }),
        getRequest: () => ({ method: 'GET', originalUrl: '/api/auth/get-session' }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new Error('Post-send error'), alreadySentHost);
    expect(statusMock).not.toHaveBeenCalled();
  });
});
