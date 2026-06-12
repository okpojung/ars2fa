import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';

@Injectable()
export class LegacyArsService {
  private readonly enabled = process.env.LEGACY_ARS_ENABLED === 'true';
  private readonly baseUrl =
    process.env.LEGACY_ARS_BASE_URL ?? 'https://barocall.baro.so';

  async install(platform: 'ANDROID' | 'IOS', params: Record<string, unknown>) {
    if (!this.enabled) {
      return {
        return: true,
        appsid: params.appsid,
        appip: '127.0.0.1',
        now: new Date().toISOString(),
        phonenum: '+8270-0000-0000',
        lease_time: new Date(Date.now() + 30_000).toISOString(),
        appuuid: `mock-${randomUUID()}`,
        msg: 'mock install succeeded',
      };
    }

    const path =
      platform === 'IOS'
        ? process.env.LEGACY_ARS_INSTALL_IOS
        : process.env.LEGACY_ARS_INSTALL_ANDROID;
    return this.postForm(path ?? '/install_app.php', params);
  }

  async confirm(platform: 'ANDROID' | 'IOS', params: Record<string, unknown>) {
    if (!this.enabled) {
      return {
        return: true,
        appsid: params.appsid,
        appuuid: params.appuuid,
        appip: '127.0.0.1',
        now: new Date().toISOString(),
        call_count: 1,
        app_cid: '01012345678',
        msg: 'mock confirm succeeded',
        inst_phone_no: '',
        inst_time: '',
        prnts_phone_no: '',
        myapp: '',
      };
    }

    const path =
      platform === 'IOS'
        ? process.env.LEGACY_ARS_CONFIRM_IOS
        : process.env.LEGACY_ARS_CONFIRM_ANDROID;
    return this.postForm(path ?? '/confirm_auth.php', params);
  }

  async recheck(params: Record<string, unknown>) {
    if (!this.enabled) {
      return {
        return: true,
        appuuid: params.appuuid,
        appsid: '',
        appip: '127.0.0.1',
        now: new Date().toISOString(),
        call_count: 1,
        app_cid: params.appphone,
        msg: 'mock recheck succeeded',
        inst_phone_no: '',
        inst_time: '',
        prnts_phone_no: '',
        myapp: '',
      };
    }

    return this.postForm(process.env.LEGACY_ARS_RECHECK ?? '/confirm_auth_recheck.php', params);
  }

  private async postForm(path: string, params: Record<string, unknown>) {
    const response = await axios.post(`${this.baseUrl}${path}`, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });
    return typeof response.data === 'string'
      ? JSON.parse(response.data)
      : response.data;
  }
}
