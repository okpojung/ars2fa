/** Developer guide shown inside the console (menu stays), as an iframe of the public guide page. */
export function ConsoleDocsPage() {
  return (
    <iframe
      title="개발자 가이드"
      src="/docs?embed=1"
      style={{ width: '100%', height: 'calc(100vh - 112px)', border: '1px solid #eef0f4', borderRadius: 8, background: '#fff' }}
    />
  );
}
