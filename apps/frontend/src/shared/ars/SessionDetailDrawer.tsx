import { EyeOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { FAIL_REASON_LABEL } from '../../pages/admin/AdminDashboardPage';
import { ClientInfoView } from './ClientInfoView';

const STATUS: Record<string, [string, string]> = {
  PENDING: ['전화 대기', 'blue'], CALL_CONFIRMED: ['번호 입력 대기', 'gold'], VERIFIED: ['성공', 'green'],
  FAILED: ['실패', 'red'], EXPIRED: ['시간 초과', 'default'], CANCELED: ['취소', 'default'],
};
const dt = (v?: string | null) => (v ? new Date(v).toLocaleString('ko-KR') : '-');
const fmtVn = (vn?: string) => (vn?.length === 12 ? `${vn.slice(0, 4)}-${vn.slice(4, 8)}-${vn.slice(8)}` : vn ?? '-');

/** IP of the browser/app that started the authentication. */
export const requesterIp = (r: Record<string, any>) => r.pcClient?.ip ?? '-';
/** IP of the phone that opened the QR page (PC / web mode). */
export const phoneIp = (r: Record<string, any>) => (r.mode === 'PC' ? r.mobileClient?.ip ?? '-' : '-');

/** Eye icon in a list row: opens the full detail of one authentication. */
export function SessionDetailButton({ r, admin = false }: { r: Record<string, any>; admin?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip title="상세 보기"><Button size="small" type="text" icon={<EyeOutlined />} onClick={() => setOpen(true)} /></Tooltip>
      <Drawer open={open} onClose={() => setOpen(false)} width={760} title="인증 상세">
        <Descriptions size="small" bordered column={2} style={{ marginBottom: 20 }}>
          <Descriptions.Item label="세션 ID" span={2}>
            <Typography.Text code copyable>{r.sessionId}</Typography.Text>
            <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>
              인증 1건의 접수 번호입니다. 고객 서버에서 결과를 조회할 때(<code>/v1/ars/sessions/status</code>, 웹은 <code>/v1/widget/verify</code>)와 문의할 때 사용합니다.
            </Typography.Text></div>
          </Descriptions.Item>
          <Descriptions.Item label="결과">
            <Tag color={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0] ?? r.status}</Tag>
            {r.failReason && <Typography.Text type="secondary">{FAIL_REASON_LABEL[r.failReason] ?? r.failReason}</Typography.Text>}
          </Descriptions.Item>
          <Descriptions.Item label="인증된 휴대폰">{r.callerPhoneMasked ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="요청 시각">{dt(r.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="완료 시각">{dt(r.finishedAt)}</Descriptions.Item>
          <Descriptions.Item label="앱">{r.mobileAppName} <Tag>{r.clientPlatform}</Tag></Descriptions.Item>
          <Descriptions.Item label="방식">{r.mode === 'PC' ? (r.widgetOrigin ? 'PC·웹 (팝업)' : 'PC') : '앱'}</Descriptions.Item>
          <Descriptions.Item label="목적">{r.purpose ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="요청 사이트">{r.widgetOrigin ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="웹·앱 IP"><Typography.Text code>{requesterIp(r)}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="휴대폰 IP"><Typography.Text code>{phoneIp(r)}</Typography.Text></Descriptions.Item>
          {admin && <Descriptions.Item label="0507 번호">{fmtVn(r.vn)}</Descriptions.Item>}
          {admin && <Descriptions.Item label="앱 무결성">{r.integrityVerdict ?? '-'}</Descriptions.Item>}
        </Descriptions>
        <ClientInfoView r={r} />
      </Drawer>
    </>
  );
}
