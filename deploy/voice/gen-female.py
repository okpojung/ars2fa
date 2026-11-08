import asyncio, subprocess, edge_tts
P = {
 'ars-auth-ok': '인증이 완료되었습니다. 감사합니다.',
 'ars-auth-fail': '인증에 실패했습니다. 다시 시도해 주세요.',
 'ars2fa-invalid': '지금은 사용할 수 없는 인증 번호입니다. 앱이나 화면에서 인증을 다시 요청해 주세요.',
 'ars2fa-greet': '발신 ARS 인증 서비스입니다.',
 'ars2fa-wait': '잠시만 기다려 주세요.',
 'ars2fa-notice': '휴대폰 인증을 하시려면 일번을 누르세요.',
 'ars2fa-ok0': '휴대폰 인증이 완료되었습니다. 감사합니다.',
 'ars2fa-fail0': '휴대폰 인증이 실패했습니다. 다시 이용해 주세요.',
 'ars2fa-pc-guide': 'PC 화면에 보이는 숫자를 휴대폰 키패드로 누르세요.',
 'ars2fa-timeout': '입력 시간이 지났습니다. 처음부터 다시 인증해 주세요.',
}
import sys
ONLY = sys.argv[1:]
async def main():
    for n, t in P.items():
        if ONLY and n not in ONLY: continue
        await edge_tts.Communicate(t, 'ko-KR-SunHiNeural', rate='+8%').save(f'/w/{n}.mp3')
        subprocess.run(['sox', f'/w/{n}.mp3', '-r', '8000', '-c', '1', '-b', '16', f'/w/{n}.wav',
            'silence', '1', '0.05', '0.5%', 'reverse', 'silence', '1', '0.05', '0.5%', 'reverse', 'norm', '-3', 'pad', '0.1', '0.15'], check=True)
        d = subprocess.run(['soxi', '-D', f'/w/{n}.wav'], capture_output=True, text=True).stdout.strip()
        print(n, d + 's')
asyncio.run(main())
