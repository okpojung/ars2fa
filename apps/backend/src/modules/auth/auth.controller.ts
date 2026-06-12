import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthenticatedRequest, JwtAuthGuard } from '../../common/auth.guard';
import { AuthService } from './auth.service';
import { LoginDto, SignupDto } from './auth.dto';

@ApiTags('auth')
@Controller('api')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('auth/signup')
  signup(@Body() dto: SignupDto) {
    return this.authService.signup(dto);
  }

  @Post('auth/login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('admin/auth/login')
  adminLogin(@Body() dto: LoginDto) {
    return this.authService.adminLogin(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) {
    return { principal: request.user };
  }

  @UseGuards(JwtAuthGuard)
  @Get('admin/me')
  adminMe(@Req() request: AuthenticatedRequest) {
    return { principal: request.user };
  }

  @Post('auth/logout')
  logout(@Req() _request: Request) {
    return { ok: true };
  }
}
