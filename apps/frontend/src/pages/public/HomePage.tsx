import { Button, Col, Row, Tabs } from 'antd';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../shared/auth/authStore';
import './site.css';

const FEATURES: [string, string][] = [
  ['번호를 보여주지 않는 1회용 0507', '인증할 때마다 1,000개 번호 중 하나를 무작위로 30초만 빌려줍니다. 앱이 바로 발신하고 화면에는 번호를 표시하지 않아, 미리 걸어 두는 가로채기를 막습니다.'],
  ['통신사가 확인한 발신번호', '전화번호를 입력받지 않습니다. 통신사 발신 기록으로 실제로 건 휴대폰 번호를 확인하므로 발신번호 조작·숨김 전화는 인증되지 않습니다.'],
  ['한 번 걸면 끝', '전화가 연결되는 순간 그 번호는 인증에서 빠집니다. 같은 번호로 두 번째 전화가 오거나, 다른 사람이 먼저 걸면 인증은 실패합니다.'],
  ['피싱 방지 안내', '통화 첫머리에 서비스 이름과 함께 "본인이 요청하지 않았다면 끊으세요"를 안내합니다. 1번 누르기 확인은 서비스별로 켜고 끌 수 있습니다.'],
  ['PC 인증도 휴대폰 한 대로', 'PC 화면의 QR을 찍어 전화를 걸고, PC에 뜬 숫자를 휴대폰 키패드로 누릅니다. 숫자를 듣지 않아도 되므로 청각장애인도 쓸 수 있습니다.'],
  ['위조 앱 차단', 'Android Play Integrity, iOS App Attest로 정품 앱에서 온 요청인지 확인합니다. 서비스별로 기록만 하거나 차단할 수 있습니다.'],
];

const APP_STEPS = ['앱에서 [ARS 인증] 버튼을 누릅니다.', '앱이 1회용 인증 번호로 바로 전화를 겁니다 (번호는 화면에 나오지 않습니다).', '안내를 듣고 (설정에 따라 1번을 누르고) 전화를 끊습니다.', '통신사가 확인한 휴대폰 번호가 인증 결과로 앱에 전달됩니다.'];
const PC_STEPS = ['PC에서 휴대폰 번호를 입력하고 인증을 시작합니다.', '휴대폰 카메라로 QR을 찍고 [전화걸기]를 누릅니다.', '전화가 연결되면 PC 화면에 인증번호가 나타납니다.', '그 숫자를 휴대폰 키패드로 누르면 인증이 끝납니다 (15초 안에).'];
const ONBOARD = [['회원 가입', '이메일로 가입합니다.'], ['API 신청', '서비스·앱 정보(패키지명/번들 ID)를 등록하고 제출합니다.'], ['심사·승인', '승인되면 API Key가 만들어집니다.'], ['연동', '콘솔에서 API Key를 받아 SDK 또는 API로 연동합니다.']];

export function HomePage() {
  const principal = useAuthStore((s) => s.principal);
  const consoleLink = principal?.kind === 'user' ? '/console' : '/login';
  return (
    <div className="site">
      <header className="site-nav">
        <Link to="/" className="site-logo">ARS2FA</Link>
        <nav>
          <a href="#features">특징</a>
          <a href="#how">이용 방법</a>
          <Link to="/docs">개발자 가이드</Link>
          <Link to={consoleLink}>{principal?.kind === 'user' ? '콘솔' : '로그인'}</Link>
          <Link to="/signup"><Button type="primary" size="small">API 신청하기</Button></Link>
        </nav>
      </header>

      <section className="site-hero">
        <div className="site-wrap">
          <p className="site-eyebrow">발신 ARS 휴대폰 인증</p>
          <h1>번호 입력 없이,<br />전화 한 통으로 끝나는 휴대폰 인증</h1>
          <p className="site-lead">
            사용자가 직접 거는 전화를 통신사 기록으로 확인합니다. 문자 인증번호를 입력할 필요가 없고,
            발신번호 조작과 번호 가로채기를 구조적으로 막습니다.
          </p>
          <div className="site-cta">
            <Link to="/signup"><Button type="primary" size="large">API 신청하기</Button></Link>
            <Link to="/docs"><Button size="large">개발자 가이드</Button></Link>
          </div>
        </div>
      </section>

      <section id="features" className="site-section">
        <div className="site-wrap">
          <h2>왜 ARS2FA인가요</h2>
          <Row gutter={[24, 24]}>
            {FEATURES.map(([t, d]) => (
              <Col xs={24} md={12} lg={8} key={t}>
                <div className="site-card"><h3>{t}</h3><p>{d}</p></div>
              </Col>
            ))}
          </Row>
        </div>
      </section>

      <section id="how" className="site-section site-alt">
        <div className="site-wrap">
          <h2>이용 방법</h2>
          <Tabs centered size="large" items={[
            { key: 'app', label: '앱에서 인증', children: <ol className="site-steps">{APP_STEPS.map((s) => <li key={s}>{s}</li>)}</ol> },
            { key: 'pc', label: 'PC에서 인증', children: <ol className="site-steps">{PC_STEPS.map((s) => <li key={s}>{s}</li>)}</ol> },
          ]} />
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap">
          <h2>도입 절차</h2>
          <Row gutter={[24, 24]}>
            {ONBOARD.map(([t, d], i) => (
              <Col xs={24} sm={12} lg={6} key={t}>
                <div className="site-card site-step"><span>{i + 1}</span><h3>{t}</h3><p>{d}</p></div>
              </Col>
            ))}
          </Row>
          <div className="site-cta" style={{ justifyContent: 'center', marginTop: 32 }}>
            <Link to="/signup"><Button type="primary" size="large">지금 신청하기</Button></Link>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="site-wrap">
          <div>
            <b>ARS2FA</b> · (주)이지트론<br />
            문의 <a href="tel:0507-0090-1105">0507-0090-1105</a> · <a href="mailto:baro@baro.me">baro@baro.me</a>
          </div>
          <div><Link to="/docs">개발자 가이드</Link> · <Link to="/login">고객 로그인</Link></div>
        </div>
      </footer>
    </div>
  );
}
