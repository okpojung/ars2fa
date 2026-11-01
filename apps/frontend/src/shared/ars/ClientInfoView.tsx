import { Descriptions, Tag, Typography } from 'antd';

type Info = Record<string, any> | null | undefined;

function Block({ title, v }: { title: string; v: Info }) {
  if (!v) return <Descriptions size="small" bordered column={1} title={title}><Descriptions.Item label="정보">없음</Descriptions.Item></Descriptions>;
  return (
    <Descriptions size="small" bordered column={1} title={title}>
      <Descriptions.Item label="IP 주소"><Typography.Text code>{v.ip ?? '-'}</Typography.Text></Descriptions.Item>
      <Descriptions.Item label="기기">{v.device ?? '-'} {v.deviceType && <Tag>{({ mobile: '휴대폰', tablet: '태블릿', desktop: 'PC' } as Record<string, string>)[v.deviceType] ?? v.deviceType}</Tag>}</Descriptions.Item>
      <Descriptions.Item label="운영체제">{v.os ?? '-'}{v.platformVersion ? ` (${v.platformVersion})` : ''}</Descriptions.Item>
      <Descriptions.Item label="브라우저">{v.browser ?? '-'}</Descriptions.Item>
      <Descriptions.Item label="화면 / 언어 / 시간대">{[v.screen, v.lang, v.tz].filter(Boolean).join(' · ') || '-'}</Descriptions.Item>
      <Descriptions.Item label="기록 시각">{v.at ? new Date(v.at).toLocaleString('ko-KR') : '-'}</Descriptions.Item>
      {v.ua && <Descriptions.Item label="User-Agent"><Typography.Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>{v.ua}</Typography.Text></Descriptions.Item>}
    </Descriptions>
  );
}

/** What was collected during an authentication: the requesting browser/app and the phone that opened the QR page. */
export function ClientInfoView({ r }: { r: Record<string, any> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
      <Block title={r.mode === 'PC' ? '요청한 PC·브라우저' : '요청한 앱'} v={r.pcClient} />
      {r.mode === 'PC' && <Block title="QR을 연 휴대폰" v={r.mobileClient} />}
      {r.widgetOrigin && <div><Typography.Text type="secondary">요청 사이트: {r.widgetOrigin}</Typography.Text></div>}
    </div>
  );
}

/** One-line summary for list columns. */
export function clientSummary(r: Record<string, any>) {
  const m = r.mobileClient, p = r.pcClient;
  const parts = [m?.device, m?.browser].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return [p?.device, p?.browser].filter(Boolean).join(' · ') || '-';
}
