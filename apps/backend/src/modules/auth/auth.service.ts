import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, SignupDto } from './auth.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async signup(dto: SignupDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      throw new ConflictException('Email is already registered');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash: await hash(dto.password, 12),
        companyName: dto.companyName,
        businessNumber: dto.businessNumber,
        contactName: dto.contactName,
        contactPhone: dto.contactPhone,
        status: 'ACTIVE',
      },
      select: this.userSelect(),
    });

    return {
      user,
      accessToken: await this.signUserToken(user),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const safeUser = {
      id: user.id,
      email: user.email,
      companyName: user.companyName,
      contactName: user.contactName,
      status: user.status,
    };

    return {
      user: safeUser,
      accessToken: await this.signUserToken(safeUser),
    };
  }

  async adminLogin(dto: LoginDto) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: dto.email },
    });
    if (!admin || !(await compare(dto.password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid admin email or password');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const safeAdmin = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      status: admin.status,
    };

    return {
      admin: safeAdmin,
      accessToken: await this.jwtService.signAsync({
        id: admin.id,
        email: admin.email,
        kind: 'admin',
        role: admin.role,
      }),
    };
  }

  private async signUserToken(user: { id: string; email: string }) {
    return this.jwtService.signAsync({
      id: user.id,
      email: user.email,
      kind: 'user',
    });
  }

  private userSelect() {
    return {
      id: true,
      email: true,
      companyName: true,
      contactName: true,
      status: true,
    } as const;
  }
}
