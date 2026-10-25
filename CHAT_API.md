# 채팅 서버 사용법

다른 게임(클라이언트)에서 이 채팅 서버에 붙을 때 필요한 내용을 정리한 문서입니다.
서버는 WebSocket 하나로 동작하며, 메시지는 모두 짧은 텍스트 문자열입니다.

## 1. 접속

| 항목 | 값 |
| --- | --- |
| 주소 | `ws://222.120.115.95:8104/?key=<시크릿 키>` |
| 서브프로토콜 | `echo-protocol` (반드시 지정) |
| 인증 | URL 쿼리의 `key` 값이 서버의 시크릿 키와 같아야 함 |

```js
const ws = new WebSocket('ws://222.120.115.95:8104/?key=' + encodeURIComponent(CHAT_KEY), 'echo-protocol');
```

서버 구성: nginx 가 공개 포트 8104 를 받아 pm2 의 `chat` 프로세스(127.0.0.1:18104)로 넘깁니다.
쿼리 문자열은 그대로 전달됩니다.

키가 없거나 틀리면 서버가 `401 Unauthorized` 로 거절하고, 브라우저에서는 `onerror` → `onclose` 가 바로 호출됩니다.
(브라우저 보안 정책상 401 이라는 이유는 클라이언트 코드에서 볼 수 없습니다.)

> **지금은 전환 기간입니다.** 기존 게임을 위해 `key` 가 아예 없는 접속은 받아 주고 서버 로그에 경고만 남깁니다(틀린 키는 거절).
> 모든 게임이 키를 보내게 되면 `chat.js` 의 `REQUIRE_KEY` 를 `true` 로 바꾸고 `pm2 restart chat` 하면 키 없는 접속도 거절됩니다.
> 새 게임은 처음부터 키를 넣어 주세요.

## 2. 시크릿 키

- 키는 서버 폴더의 `secret.key` 파일에 들어 있습니다. 이 파일은 `.gitignore` 에 등록되어 git 에 올라가지 않습니다.
- 서버는 env `CHAT_SECRET` 이 있으면 그 값을, 없으면 `secret.key` 를 씁니다. **둘 다 없으면 서버가 시작하지 않습니다.**
- 새 서버에 배포할 때는 `secret.key` 를 직접 복사하거나 `CHAT_SECRET` 을 설정해야 합니다.
- 키를 바꾸려면: `openssl rand -hex 32 > secret.key` 후 `pm2 restart chat`, 게임 쪽 키도 같이 교체.
- 키는 URL 에 들어가므로 nginx access log(`/usr/local/var/log/nginx/chat.access.log`)에 그대로 남습니다. 로그를 남에게 공유할 때 주의하세요.
- 게임 코드에서도 키를 git 에 올리지 않는 설정 파일에 두는 것을 권장합니다.

> 참고: 브라우저 게임이라면 키가 클라이언트 JS 에 들어가므로, 개발자 도구를 여는 사람은 볼 수 있습니다.
> 이 키는 "아무 사이트나 이 서버에 붙지 못하게 막는" 용도이지, 사용자 인증 수단은 아닙니다.

## 3. 클라이언트 → 서버 메시지

메시지의 첫 글자가 종류(코드)입니다.

| 코드 | 형식 | 설명 |
| --- | --- | --- |
| `0` | `0<방이름>_<유저이름>` | 방 입장. 방이 없으면 새로 만듭니다. 이미 다른 방에 있으면 그 방에서 먼저 나갑니다. |
| `1` | `1<아무거나>_<내용>` | 채팅 전송. **첫 번째 `_` 뒤가 내용**이고, 앞부분은 무시됩니다(현재 입장한 방으로 보냄). 보통 `1<방이름>_<내용>` 으로 보냅니다. |
| `2` | `2` | 퇴장. 서버가 연결을 끊습니다. |

주의:
- 방 이름에는 `_` 를 넣지 마세요. 첫 번째 `_` 를 기준으로 방 이름과 유저 이름을 나눕니다. 유저 이름에는 `_` 가 들어가도 됩니다.
- 입장(`0`) 전에 보낸 채팅(`1`)은 무시됩니다.
- 형식이 잘못된 메시지는 응답 없이 무시됩니다.

## 4. 서버 → 클라이언트 메시지

| 코드 | 형식 | 언제 |
| --- | --- | --- |
| `0` | `0<유저이름>` | 누군가 방에 들어옴 (자기 자신 포함) |
| `1` | `1<유저이름>:<내용>` | 채팅 |
| `2` | `2<유저이름>` | 누군가 방에서 나감 (연결이 끊긴 경우 포함) |

- 입장하면 먼저 그 방의 **최근 채팅 기록(최대 100개)** 이 `1...` 형식으로 오고, 그다음 자기 입장 알림 `0<내이름>` 이 옵니다.
- 채팅 `1` 은 보낸 사람 자신에게도 옵니다. 그러니 화면에는 서버가 보내준 것만 그리면 됩니다.
- 유저 이름에 `:` 가 있으면 내용과 구분이 어려우므로 **첫 번째 `:` 앞을 이름**으로 쓰고, 이름에는 `:` 를 쓰지 않는 것을 권장합니다.

## 5. 방과 기록

- 모두 나가도 방의 채팅 기록은 남습니다.
- 30일 동안 아무도 들어오지 않은 방은 기록과 함께 삭제됩니다.
- 기록은 메모리에만 있으므로 서버를 재시작하면 모두 사라집니다.

## 6. 예제 (브라우저 JS)

```js
const CHAT_URL = 'ws://222.120.115.95:8104/';
const CHAT_KEY = '...'; // 서버의 secret.key 값

function connectChat(roomName, userName, onEvent) {
  const ws = new WebSocket(CHAT_URL + '?key=' + encodeURIComponent(CHAT_KEY), 'echo-protocol');

  ws.onopen = () => ws.send('0' + roomName + '_' + userName);

  ws.onmessage = (e) => {
    const code = e.data[0];
    const body = e.data.substring(1);
    if (code === '0') {
      onEvent({ type: 'join', user: body });
    } else if (code === '1') {
      const i = body.indexOf(':');
      onEvent({ type: 'chat', user: body.substring(0, i), text: body.substring(i + 1) });
    } else if (code === '2') {
      onEvent({ type: 'leave', user: body });
    }
  };

  ws.onclose = () => onEvent({ type: 'disconnected' }); // 키가 틀린 경우도 여기로 옴

  return {
    send: (text) => ws.send('1' + roomName + '_' + text),
    quit: () => ws.send('2'),
  };
}

// 사용
const chat = connectChat('lobby', 'alice', (ev) => console.log(ev));
// chat.send('안녕하세요');
// chat.quit();
```
