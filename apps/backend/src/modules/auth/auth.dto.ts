import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

// 8자 이상, 영문 + 숫자 + 특수문자 각 1개 이상, 공백 없음
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,64}$/;

export class SignupDto {
  @IsEmail()
  email!: string;

  @Matches(PASSWORD_RULE, { message: '비밀번호는 8자 이상, 영문·숫자·특수문자를 모두 포함해야 합니다.' })
  password!: string;

  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @IsOptional()
  @IsString()
  businessNumber?: string;

  @IsString()
  @IsNotEmpty()
  contactName!: string;

  @IsString()
  @IsNotEmpty()
  contactPhone!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
