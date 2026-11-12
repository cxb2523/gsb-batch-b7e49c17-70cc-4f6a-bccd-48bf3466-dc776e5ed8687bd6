import { Controller, Get, Patch, Delete, Post, Put, Body, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { UsersService } from './users.service.js';
import type { EnvConfig } from '../config/env.schema.js';
import {
  SetupEncryptionDto,
  RotatePassphraseDto,
  UpdateProfileDto,
  DeleteAccountDto,
} from './dto/user.dto.js';
import { Access, CurrentUser } from '../access/decorators.js';
import type { AccessUser } from '../access/access.types.js';

@Controller('api/user')
@Access({ scope: 'session' })
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService<EnvConfig, true>,
  ) {}

  @Get('encryption-params')
  async getEncryptionParams(@CurrentUser() user: AccessUser) {
    return this.usersService.getEncryptionParams(user.id);
  }

  @Post('encryption-setup')
  async setupEncryption(@CurrentUser() user: AccessUser, @Body() body: SetupEncryptionDto) {
    return this.usersService.setupEncryption(user.id, body);
  }

  @Put('encryption-passphrase')
  async rotatePassphrase(@CurrentUser() user: AccessUser, @Body() body: RotatePassphraseDto) {
    return this.usersService.rotatePassphrase(user.id, body);
  }

  @Get('public-key/:id')
  async getPublicKey(@CurrentUser() user: AccessUser, @Param('id') id: string) {
    return this.usersService.getPublicKey(id, user.id);
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: AccessUser, @Body() body: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, body);
  }

  @Get('accounts')
  async getAccounts(@CurrentUser() user: AccessUser) {
    return this.usersService.getAccounts(user.id);
  }

  @Delete('accounts/:providerId')
  async unlinkAccount(@CurrentUser() user: AccessUser, @Param('providerId') providerId: string) {
    return this.usersService.unlinkAccount(user.id, providerId);
  }

  @Get('owned-workspaces')
  async getOwnedWorkspaces(@CurrentUser() user: AccessUser) {
    return this.usersService.getOwnedWorkspaces(user.id);
  }

  @Get('metrics')
  async getUserMetrics(@CurrentUser() user: AccessUser) {
    return this.usersService.getUserMetrics(user.id);
  }

  @Get('export-data')
  async exportData(@CurrentUser() user: AccessUser, @Res() res: Response) {
    const exportBundle = await this.usersService.exportUserData(user.id);
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `canvhq-data-export-${user.id}-${dateStr}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(JSON.stringify(exportBundle, null, 2));
  }

  @Post('delete-account')
  async deleteAccount(
    @CurrentUser() user: AccessUser,
    @Res() res: Response,
    @Body() body: DeleteAccountDto,
  ) {
    const result = await this.usersService.deleteAccount(user.id, body);

    // Clear session cookies
    const cookieOpts = {
      path: '/',
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.configService.get('NODE_ENV', { infer: true }) === 'production',
    };
    res.clearCookie('better-auth.session_token', cookieOpts);
    res.clearCookie('__Secure-better-auth.session_token', cookieOpts);

    return res.status(200).json(result);
  }
}
